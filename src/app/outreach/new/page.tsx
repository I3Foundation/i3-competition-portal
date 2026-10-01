import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { sendOutreach, recordExternalSend, SEND_CAP_PER_DAY } from '@/lib/outreach';
import { renderTemplate, transportName } from '@/lib/mail';
import { composeLinks } from '@/lib/compose';

export const dynamic = 'force-dynamic';

type Target = {
  id: string; name: string; email: string | null; owner_name: string | null;
  suppressed: boolean; org_kind: string; unsubscribe_token: string;
};
type Tmpl = { id: string; name: string; subject: string; body_text: string };

export default async function Compose(
  { searchParams }: { searchParams: Promise<{ contact?: string; tmpl?: string; err?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { contact, tmpl, err } = await searchParams;
  if (!contact) redirect('/businesses');

  const data = await withUser(user.id, async (c) => {
    const target = (await c.query<Target>(
      `select ct.id, o.name::text as name, ct.email::text as email,
              ct.full_name as owner_name, o.kind::text as org_kind,
              ct.unsubscribe_token,
              app.is_suppressed(ct.id,'email') as suppressed
         from contacts ct join organizations o on o.id = ct.organization_id
        where ct.id = $1`, [contact])).rows[0];
    if (!target) return null;
    return {
      target,
      templates: (await c.query<Tmpl>(
        `select id, name, subject, body_text from email_templates
          where kind = (select kind from contacts where id=$1)
            and season_id = (select id from seasons where is_active)
          order by name`, [contact])).rows,
      used: Number((await c.query<{ n: number }>(
        'select app.sends_last_day($1,$2) as n', [user.team_id, user.id])).rows[0].n),
    };
  });
  if (!data) redirect('/businesses');
  const { target, templates, used } = data;

  const chosen = templates.find((t) => t.id === tmpl) ?? templates[0];
  const vars = {
    first_name: target.owner_name, org_name: target.name, sender_name: user.full_name,
  };

  async function send(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const contactId = String(formData.get('contact_id'));
    const result = await sendOutreach({
      actorId: u.id, actorName: u.full_name, actorEmail: u.email,
      contactId,
      teamId: u.role === 'admin' ? null : u.team_id,
      subject: String(formData.get('subject') ?? '').trim(),
      body: String(formData.get('body') ?? '').trim(),
    });
    if (!result.ok) {
      redirect(`/outreach/new?contact=${contactId}&err=${encodeURIComponent(result.reason)}`);
    }
    redirect(`/outreach/${result.threadId}?msg=`
      + encodeURIComponent(result.transport === 'dev'
        ? 'Recorded. RESEND_API_KEY is not set, so nothing was actually emailed.'
        : 'Sent.'));
  }

  async function markSentExternally(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const contactId = String(formData.get('contact_id'));
    const result = await recordExternalSend({
      actorId: u.id, contactId,
      teamId: u.role === 'admin' ? null : u.team_id,
      subject: String(formData.get('subject') ?? '').trim(),
      body: String(formData.get('body') ?? '').trim(),
    });
    if (!result.ok) {
      redirect(`/outreach/new?contact=${contactId}&err=${encodeURIComponent(result.reason)}`);
    }
    redirect(`/outreach/${result.threadId}?msg=`
      + encodeURIComponent('Recorded as sent from your own email. Replies will go '
          + 'to your inbox, not the portal — log them on the thread.'));
  }

  const subject = renderTemplate(chosen?.subject ?? '', vars);
  const bodyText = renderTemplate(chosen?.body_text ?? '', vars);
  const links = target.email && !target.suppressed
    ? composeLinks({
        to: target.email, subject, body: bodyText,
        unsubscribeToken: target.unsubscribe_token,
      })
    : null;

  return (
    <>
      <h1>Email {target.name}</h1>
      <p className="hint">
        To: {target.owner_name ? `${target.owner_name} — ` : ''}
        {target.email ?? <span className="empty">no email on file</span>}
        {' · '}{used}/{SEND_CAP_PER_DAY} sends used today
      </p>
      {err && <p className="err">{err}</p>}

      {target.suppressed && (
        <p className="err">
          This contact is suppressed — they unsubscribed, or the address is known
          bad. Sending is blocked.
        </p>
      )}
      {transportName() === 'dev' && (
        <p className="hint">
          <strong>Dev transport.</strong> The full send path runs and is recorded,
          but no email leaves the machine. Set <code>RESEND_API_KEY</code> to send
          for real.
        </p>
      )}

      {templates.length > 1 && (
        <p className="hint">
          Template:{' '}
          {templates.map((t) => (
            <span key={t.id}>
              {t.id === chosen?.id
                ? <strong>{t.name}</strong>
                : <a href={`/outreach/new?contact=${target.id}&tmpl=${t.id}`}>{t.name}</a>}
              {' · '}
            </span>
          ))}
        </p>
      )}

      <fieldset>
        <legend>Message</legend>
        <form action={send} id="portal-send">
          <input type="hidden" name="contact_id" value={target.id} />
          <p>
            <label>Subject<br />
              <input name="subject" size={70} required defaultValue={subject} /></label>
          </p>
          <p>
            <label>Body<br />
              <textarea name="body" rows={16} cols={80} required
                defaultValue={bodyText} /></label>
          </p>
          <p className="hint">
            An unsubscribe footer is appended either way. Edits here apply to
            whichever option you use below.
          </p>
        </form>
      </fieldset>

      <h2>Option 1 — send from the portal</h2>
      <p className="hint">
        Goes out as <em>{user.full_name} (I³ Competition)</em> from our domain.
        Replies come back to a per-thread address and <strong>appear in this
        portal automatically</strong>, and bounces update the suppression list.
        Weaker deliverability into school districts, which filter young sending
        domains hard.
      </p>
      <p>
        <button form="portal-send" disabled={target.suppressed || !target.email}>
          {target.suppressed || !target.email ? 'Cannot send' : 'Send from portal'}
        </button>
      </p>

      <h2>Option 2 — send from your own email</h2>
      <p className="hint">
        Opens your mail app with this message prefilled, sent from your real
        address. <strong>Much better chance of reaching a school inbox</strong> —
        but replies go to <em>your</em> inbox, not the portal, so you will have to
        log them on the thread yourself.
      </p>
      {links === null
        ? <p className="empty">Unavailable — no address, or the contact is suppressed.</p>
        : (
          <>
            {links.tooLong && (
              <p className="err">
                This message is long enough that some mail apps will truncate the
                link. Copy the body from the box above after your mail app opens.
              </p>
            )}
            <p>
              <a href={links.gmail} target="_blank" rel="noreferrer">Open in Gmail</a>
              {' · '}
              <a href={links.mailto}>Open in default mail app</a>
            </p>
            <p className="hint">
              Those links use the template as shown above. If you edited the text,
              paste your version in once your mail app opens.
            </p>
            <form action={markSentExternally}>
              <input type="hidden" name="contact_id" value={target.id} />
              <input type="hidden" name="subject" value={subject} />
              <input type="hidden" name="body" value={bodyText} />
              <p><button>I sent it — record this</button></p>
            </form>
            <p className="hint">
              The portal cannot see your mail app, so this is you telling it the
              email went out.
            </p>
          </>
        )}
    </>
  );
}
