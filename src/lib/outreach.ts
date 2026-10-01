import 'server-only';
import { withUser } from './db';
import { sendMail, replyToFor, unsubscribeUrlFor, transportName } from './mail';

export const SEND_CAP_PER_DAY = Number(process.env.SEND_CAP_PER_DAY ?? 40);

export type SendOutcome =
  | { ok: true; threadId: string; transport: 'resend' | 'dev' }
  | { ok: false; reason: string };

// Explicit discriminant: without it TS widens the union returned from the
// transaction and `reserved.err` reads as possibly-undefined.
type Reserved =
  | { kind: 'error'; err: string }
  | { kind: 'ok'; threadId: string; messageId: string; to: string;
      token: string; replyToken: string };

type Target = {
  contact_id: string;
  email: string | null;
  full_name: string | null;
  org_name: string;
  unsubscribe_token: string;
  suppressed: boolean;
};

/**
 * Sends one outreach email and records it.
 *
 * Three guarantees, in this order:
 *
 *  1. Nothing is sent to a suppressed contact. app.is_suppressed() is the only
 *     authority; this function never second-guesses it with its own filter.
 *  2. A team (or an organiser, for recruiting) cannot exceed SEND_CAP_PER_DAY.
 *     Cold email from a young domain is the fastest way to ruin its reputation.
 *  3. The message row is written as 'queued' BEFORE the network call and
 *     updated after. If the process dies mid-send, a row left 'queued' records
 *     that a send may have gone out -- the alternative is an invisible send.
 */
export async function sendOutreach(opts: {
  actorId: string;
  actorName: string;
  actorEmail: string;
  contactId: string;
  teamId: string | null;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<SendOutcome> {
  const { actorId, contactId, teamId } = opts;

  // --- phase 1: check, then reserve -------------------------------------
  const reserved: Reserved = await withUser(actorId, async (c): Promise<Reserved> => {
    const { rows } = await c.query<Target>(
      `select ct.id as contact_id, ct.email::text as email, ct.full_name,
              o.name::text as org_name, ct.unsubscribe_token,
              app.is_suppressed(ct.id,'email') as suppressed
         from contacts ct
         join organizations o on o.id = ct.organization_id
        where ct.id = $1`, [contactId]);
    const t = rows[0];
    if (!t) return { kind: 'error', err: 'That contact is not visible to you.' };
    if (!t.email) return { kind: 'error', err: 'That contact has no email address on file.' };

    // Guarantee 1.
    if (t.suppressed) {
      return { kind: 'error',
               err: 'That contact is suppressed — unsubscribed, or the address is known bad.' };
    }

    // Guarantee 2.
    const { rows: q } = await c.query<{ n: number }>(
      'select app.sends_last_day($1,$2) as n', [teamId, actorId]);
    if (q[0].n >= SEND_CAP_PER_DAY) {
      return { kind: 'error',
               err: `Daily send limit reached (${SEND_CAP_PER_DAY}). This protects `
                  + `the sending domain's reputation — try again tomorrow.` };
    }

    // Reuse the thread on a follow-up so replies keep landing in one place.
    let threadId: string | undefined = opts.threadId;
    if (!threadId) {
      const { rows: tr } = await c.query<{ id: string }>(
        `insert into outreach_threads (contact_id, team_id, sender_id, subject, status)
         values ($1,$2,$3,$4,'draft') returning id`,
        [contactId, teamId, actorId, opts.subject]);
      threadId = tr[0].id;
    }

    const { rows: tok } = await c.query<{ reply_token: string }>(
      'select reply_token from outreach_threads where id = $1', [threadId]);
    if (!tok[0] || !threadId) return { kind: 'error', err: 'Could not open that thread.' };

    // Guarantee 3.
    const { rows: m } = await c.query<{ id: string }>(
      `insert into messages (thread_id, direction, from_email, to_email, subject,
                             body_text, delivery)
       values ($1,'outbound',$2,$3,$4,$5,'queued') returning id`,
      [threadId, `outreach@${process.env.MAIL_FROM_DOMAIN ?? 'mail.i3competition.com'}`,
       t.email, opts.subject, opts.body]);

    return {
      kind: 'ok', threadId, messageId: m[0].id, to: t.email,
      token: t.unsubscribe_token, replyToken: tok[0].reply_token,
    };
  });

  if (reserved.kind === 'error') return { ok: false, reason: reserved.err };

  // --- phase 2: the actual send (outside any transaction) ----------------
  const result = await sendMail({
    to: reserved.to,
    subject: opts.subject,
    text: opts.body,
    fromName: `${opts.actorName} (I³ Competition)`,
    replyTo: replyToFor(reserved.replyToken),
    unsubscribeUrl: unsubscribeUrlFor(reserved.token),
  });

  // --- phase 3: record the outcome ---------------------------------------
  //
  // By this point the mail has either gone out or it has not, and that fact
  // cannot be undone. So a failure to RECORD it must never throw: the mail is
  // already sent, and leaving the row 'queued' while showing the user an error
  // is the one outcome worse than a missing provider id.
  try {
  await withUser(actorId, async (c) => {
    if (result.ok) {
      await c.query(
        `update messages set delivery='delivered', provider_message_id=$2, error=null
          where id=$1`, [reserved.messageId, result.providerMessageId]);
      await c.query(
        `update outreach_threads set status='sent', last_activity_at=now() where id=$1`,
        [reserved.threadId]);
      await c.query(
        'insert into send_log (team_id, sender_id) values ($1,$2)', [teamId, actorId]);
      await c.query(
        `insert into contact_events (contact_id, kind, actor_id, detail)
         values ($1,'contacted',$2,$3)`,
        [contactId, actorId,
         JSON.stringify({ thread_id: reserved.threadId, transport: result.transport })]);
    } else {
      // Not counted against the cap: nothing left the building.
      await c.query(
        `update messages set delivery='failed', error=$2 where id=$1`,
        [reserved.messageId, result.error]);
      await c.query(
        `insert into contact_events (contact_id, kind, actor_id, detail)
         values ($1,'send_failed',$2,$3)`,
        [contactId, actorId, JSON.stringify({ error: result.error })]);
    }
  });
  } catch (e) {
    console.error('[outreach] send succeeded but recording failed', e);
    // Second chance without the provider id, which is the only field that can
    // realistically collide. A row left 'queued' means even this failed, and is
    // the signal to go looking.
    if (result.ok) {
      await withUser(actorId, (c) =>
        c.query(`update messages set delivery='delivered', error=$2 where id=$1`,
          [reserved.messageId,
           `recorded without provider id: ${String(e).slice(0, 200)}`])).catch(() => {});
    }
  }

  return result.ok
    ? { ok: true, threadId: reserved.threadId, transport: result.transport }
    : { ok: false, reason: `Send failed: ${result.error}` };
}

export { transportName };

/**
 * Records a send the student made from their own mail client via a compose
 * link. The portal never saw the message leave, so this is the student
 * asserting they sent it.
 *
 * Still gated on suppression. An opt-out means nobody emails that person --
 * including from a personal account. Enforcing it only on the portal's own
 * sends would make the unsubscribe button decorative, and would be the kind of
 * gap that gets a sending domain and a nonprofit's name in a spam report.
 *
 * Deliberately does NOT write to send_log: the daily cap protects our sending
 * domain's reputation, and these do not touch it. Gmail's own limits apply.
 */
export async function recordExternalSend(opts: {
  actorId: string;
  contactId: string;
  teamId: string | null;
  subject: string;
  body: string;
  threadId?: string;
}): Promise<SendOutcome> {
  type Recorded = { kind: 'error'; err: string } | { kind: 'ok'; threadId: string };

  const result: Recorded = await withUser(opts.actorId, async (c): Promise<Recorded> => {
    const { rows } = await c.query<{ suppressed: boolean; email: string | null }>(
      `select app.is_suppressed(id,'email') as suppressed, email::text as email
         from contacts where id = $1`, [opts.contactId]);
    const t = rows[0];
    if (!t) return { kind: 'error', err: 'That contact is not visible to you.' };
    if (!t.email) {
      return { kind: 'error', err: 'That contact has no email address on file.' };
    }
    if (t.suppressed) {
      return { kind: 'error',
               err: 'That contact is suppressed — unsubscribed, or the address is '
                  + 'known bad. Do not email them from your own account either.' };
    }

    let threadId: string | undefined = opts.threadId;
    if (!threadId) {
      const { rows: tr } = await c.query<{ id: string }>(
        `insert into outreach_threads (contact_id, team_id, sender_id, subject, status)
         values ($1,$2,$3,$4,'draft') returning id`,
        [opts.contactId, opts.teamId, opts.actorId, opts.subject]);
      threadId = tr[0].id;
    }
    if (!threadId) return { kind: 'error', err: 'Could not open that thread.' };

    await c.query(
      `insert into messages (thread_id, direction, from_email, to_email, subject,
                             body_text, delivery)
       values ($1,'outbound',
               (select email::text from profiles where id=$2),
               $3,$4,$5,'external')`,
      [threadId, opts.actorId, t.email, opts.subject, opts.body]);

    await c.query(
      `update outreach_threads set status='sent', last_activity_at=now() where id=$1`,
      [threadId]);

    await c.query(
      `insert into contact_events (contact_id, kind, actor_id, detail)
       values ($1,'contacted',$2,$3)`,
      [opts.contactId, opts.actorId,
       JSON.stringify({ thread_id: threadId, via: 'external', replies_captured: false })]);

    return { kind: 'ok', threadId };
  });

  return result.kind === 'error'
    ? { ok: false, reason: result.err }
    : { ok: true, threadId: result.threadId, transport: 'dev' };
}
