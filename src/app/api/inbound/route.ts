import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';
import { verifyInbound, threadTokenFrom } from '@/lib/webhook';
import { sendMail, unsubscribeUrlFor, replyToFor } from '@/lib/mail';

/**
 * Inbound replies.
 *
 * A reply arrives at r+<thread_token>@mail.<domain>, which is how a reply is
 * attached to the right thread without the recipient doing anything. Routing on
 * the token rather than on the From address matters: people reply from a
 * different address than the one we wrote to more often than you would think.
 */
export async function POST(req: Request) {
  const raw = await req.text();

  const auth = verifyInbound(raw, req.headers);
  if (!auth.ok) {
    // 401, not 400: the relay should retry after the secret is fixed.
    return NextResponse.json({ error: auth.why }, { status: 401 });
  }

  let body: {
    to?: string; envelopeTo?: string; from?: string; subject?: string;
    text?: string; html?: string; messageId?: string;
  };
  try { body = JSON.parse(raw); } catch { return NextResponse.json({ error: 'bad json' }, { status: 400 }); }

  const eventId = body.messageId ?? `inbound-${Date.now()}`;

  // Record before acting. A NULL id means we have seen this delivery already.
  const deliveryId = await withUser(null, async (c) =>
    (await c.query<{ id: string | null }>(
      'select app.record_webhook($1,$2,$3,$4) as id',
      ['inbound', eventId, 'reply', raw])).rows[0].id);

  if (deliveryId === null) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  const token = threadTokenFrom(body.to, body.envelopeTo);
  if (!token) {
    await withUser(null, (c) =>
      c.query('select app.mark_webhook_handled($1,$2)',
        [deliveryId, 'no thread token in recipient address']));
    // 200: retrying will not make a token appear. Stored for inspection.
    return NextResponse.json({ ok: true, routed: false, reason: 'no thread token' });
  }

  // The handler has no session, so RLS hides outreach_threads entirely. Resolve
  // the thread's owner through a security definer function, then do the actual
  // work as that owner -- who is by definition allowed to see their own thread.
  // This keeps the webhook from needing broad table access.
  const senderId = await withUser(null, async (c) =>
    (await c.query<{ id: string | null }>(
      'select app.thread_sender_by_token($1) as id', [token])).rows[0].id);

  if (!senderId) {
    await withUser(null, (c) =>
      c.query('select app.mark_webhook_handled($1,$2)',
        [deliveryId, `unknown thread token ${token}`]));
    return NextResponse.json({ ok: true, routed: false, reason: 'unknown token' });
  }

  return await attach(senderId, token, body, eventId, deliveryId);
}

async function attach(
  senderId: string,
  token: string,
  body: { from?: string; subject?: string; text?: string; html?: string },
  eventId: string,
  deliveryId: string,
) {
  const result = await withUser(senderId, async (c) => {
    const { rows } = await c.query<{
      id: string; contact_id: string; subject: string; team_id: string | null;
      sender_email: string; sender_name: string; unsubscribe_token: string;
      reply_token: string;
    }>(
      `select t.id, t.contact_id, t.subject, t.team_id,
              p.email::text as sender_email, p.full_name as sender_name,
              ct.unsubscribe_token, t.reply_token
         from outreach_threads t
         join profiles p on p.id = t.sender_id
         join contacts ct on ct.id = t.contact_id
        where t.reply_token = $1`, [token]);
    const t = rows[0];
    if (!t) return null;

    // provider_message_id is uniquely indexed, so a replay cannot double-insert
    // even if it slipped past the webhook_deliveries check.
    await c.query(
      `insert into messages (thread_id, direction, from_email, to_email, subject,
                             body_text, body_html, provider_message_id)
       values ($1,'inbound',$2,$3,$4,$5,$6,$7)
       on conflict (provider_message_id)
         where provider_message_id is not null and direction = 'inbound'
       do nothing`,
      [t.id, body.from ?? 'unknown', `r+${token}`, body.subject ?? t.subject,
       body.text ?? null, body.html ?? null, eventId]);

    // Only advance a thread that is still waiting. An organiser who already
    // classified this as interested/declined should not be overwritten by a
    // later "thanks!" landing in the same thread.
    await c.query(
      `update outreach_threads set status='replied', last_activity_at=now()
        where id=$1 and status in ('draft','sent','no_response')`, [t.id]);

    await c.query(
      `insert into contact_events (contact_id, kind, actor_id, detail)
       values ($1,'replied',null,$2)`,
      [t.contact_id, JSON.stringify({ thread_id: t.id, from: body.from ?? null })]);

    return t;
  });

  if (!result) {
    await withUser(null, (c) =>
      c.query('select app.mark_webhook_handled($1,$2)', [deliveryId, 'thread vanished']));
    return NextResponse.json({ ok: true, routed: false });
  }

  // Forward a copy so the student is not cut out of their own conversation.
  if (result.sender_email) {
    await sendMail({
      to: result.sender_email,
      subject: `Reply: ${result.subject}`,
      text: `${body.from ?? 'They'} replied to your outreach:\n\n`
          + `${(body.text ?? '(no text)').slice(0, 4000)}\n\n`
          + `View the thread: ${(process.env.APP_URL ?? 'http://localhost:3100')}/outreach/${result.id}`,
      fromName: 'I³ Portal',
      replyTo: replyToFor(result.reply_token),
      unsubscribeUrl: unsubscribeUrlFor(result.unsubscribe_token),
    });
  }

  await withUser(null, (c) =>
    c.query('select app.mark_webhook_handled($1,$2)', [deliveryId, 'reply attached']));

  return NextResponse.json({ ok: true, routed: true, threadId: result.id });
}
