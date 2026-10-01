import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';
import { sendOutreach } from '@/lib/outreach';
import { transportName, replyToFor } from '@/lib/mail';

export const dynamic = 'force-dynamic';

const STATUSES = ['draft','sent','replied','interested','declined','no_response','bounced'] as const;

type Thread = {
  id: string; subject: string; status: string; contact_id: string;
  business_name: string; business_email: string | null; sender: string;
  team_name: string | null; reply_token: string; suppressed: boolean;
};
type Msg = {
  id: string; direction: string; from_email: string; to_email: string;
  body_text: string | null; sent_at: string; delivery: string | null;
  error: string | null;
};

export default async function ThreadPage({
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ msg?: string; err?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { id } = await params;
  const { msg, err } = await searchParams;

  const data = await withUser(user.id, async (c) => {
    // Returns nothing for another team's thread -- RLS, not a check here.
    const t = (await c.query<Thread>(
      `select t.id, t.subject, t.status, t.contact_id, t.reply_token,
              o.name::text as business_name, ct.email::text as business_email,
              p.full_name as sender, tm.name as team_name,
              app.is_suppressed(ct.id,'email') as suppressed
         from outreach_threads t
         join contacts ct on ct.id=t.contact_id
         join organizations o on o.id=ct.organization_id
         join profiles p on p.id=t.sender_id
         left join teams tm on tm.id=t.team_id
        where t.id=$1`, [id])).rows[0];
    if (!t) return null;
    const m = (await c.query<Msg>(
      `select id, direction, from_email, to_email, body_text,
              delivery::text as delivery, error,
              to_char(sent_at,'Mon DD, HH24:MI') as sent_at
         from messages where thread_id=$1 order by sent_at`, [id])).rows;
    return { t, m };
  });
  if (!data) notFound();
  const { t, m } = data;

  async function setStatus(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const threadId = String(formData.get('thread_id'));
    await withUser(u.id, (c) =>
      c.query(`update outreach_threads set status=$1, last_activity_at=now() where id=$2`,
        [String(formData.get('status')), threadId]));
    redirect(`/outreach/${threadId}`);
  }

  async function logReplyManually(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const threadId = String(formData.get('thread_id'));
    const body = String(formData.get('body') ?? '').trim();
    if (!body) redirect(`/outreach/${threadId}`);
    await withUser(u.id, async (c) => {
      await c.query(
        `insert into messages (thread_id, direction, from_email, to_email, body_text)
         values ($1,'inbound',
                 coalesce((select ct.email::text from outreach_threads ot
                            join contacts ct on ct.id=ot.contact_id where ot.id=$1),'unknown'),
                 $2,$3)`, [threadId, u.email, body]);
      await c.query(
        `update outreach_threads set status='replied', last_activity_at=now()
          where id=$1 and status in ('draft','sent','no_response')`, [threadId]);
      await c.query(
        `insert into contact_events (contact_id, kind, actor_id, detail)
         select contact_id,'replied',$2,'{"logged_by_hand":true}'::jsonb
           from outreach_threads where id=$1`, [threadId, u.id]);
    });
    redirect(`/outreach/${threadId}?msg=` + encodeURIComponent('Reply recorded.'));
  }

  async function followUp(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const threadId = String(formData.get('thread_id'));
    const result = await sendOutreach({
      actorId: u.id, actorName: u.full_name, actorEmail: u.email,
      contactId: String(formData.get('contact_id')),
      teamId: u.role === 'admin' ? null : u.team_id,
      subject: String(formData.get('subject') ?? '').trim(),
      body: String(formData.get('body') ?? '').trim(),
      threadId,   // same thread, so replies keep landing in one place
    });
    redirect(`/outreach/${threadId}?`
      + (result.ok
          ? 'msg=' + encodeURIComponent(result.transport === 'dev'
              ? 'Follow-up recorded (dev transport — nothing emailed).'
              : 'Follow-up sent.')
          : 'err=' + encodeURIComponent(result.reason)));
  }

  return (
    <>
      <h1>{t.subject}</h1>
      <p className="hint">
        {t.business_name} · {t.business_email ?? 'no email'} · {t.sender}
        {t.team_name ? ` (${t.team_name})` : ' (recruiting)'}
        {' · '}<a href={`/contacts/${t.contact_id}`}>contact timeline</a>
      </p>
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint"><strong>{msg}</strong></p>}
      {m.some((x) => x.delivery === 'external')
        ? (
          <p className="err">
            This thread includes mail sent from a personal account. Those replies
            go to that inbox, <strong>not here</strong> — record them below so the
            team can see them. Anything sent from the portal still lands
            automatically.
          </p>
        )
        : (
          <p className="hint">
            Replies come back to <code>{replyToFor(t.reply_token)}</code> and are
            attached automatically.
          </p>
        )}

      <form action={setStatus}>
        <input type="hidden" name="thread_id" value={t.id} />
        <label>Status{' '}
          <select name="status" defaultValue={t.status}>
            {STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </label>{' '}
        <button>Update</button>
      </form>

      <h2>Messages</h2>
      {m.length === 0 ? <p className="empty">Nothing recorded yet.</p> : (
        <ul className="plain">
          {m.map((x) => (
            <li key={x.id}>
              <strong>
                {x.direction === 'inbound'
                  ? '← reply'
                  : x.delivery === 'external' ? '→ sent from own email' : '→ sent'}
              </strong>
              {' '}<span className="hint">
                {x.sent_at} · {x.from_email} → {x.to_email}
                {x.direction === 'outbound' && x.delivery
                  && !['delivered', 'external'].includes(x.delivery)
                  && ` · ${x.delivery}`}
              </span>
              {x.error && <><br /><span className="err">{x.error}</span></>}
              <br />{x.body_text}
            </li>
          ))}
        </ul>
      )}

      <h2>Send a follow-up</h2>
      <p className="hint">
        Goes out on this same thread, so their reply lands here rather than
        starting a new conversation. Most replies come from a follow-up, not the
        first email.
        {transportName() === 'dev'
          && ' Dev transport is active — nothing will actually be emailed.'}
      </p>
      {t.suppressed
        ? <p className="err">
            This contact is suppressed — unsubscribed, or the address is known
            bad. Sending is blocked.
          </p>
        : (
          <form action={followUp}>
            <input type="hidden" name="thread_id" value={t.id} />
            <input type="hidden" name="contact_id" value={t.contact_id} />
            <p><label>Subject<br />
              <input name="subject" size={70} required defaultValue={`Re: ${t.subject}`} /></label></p>
            <p><textarea name="body" rows={8} cols={80} required
              placeholder="Just following up in case this got buried..." /></p>
            <p><button>Send follow-up</button></p>
          </form>
        )}

      {m.some((x) => x.delivery === 'external') && (
        <>
          <h2>Log a reply you received yourself</h2>
          <p className="hint">
            Only needed for mail sent from a personal account — portal sends
            capture replies on their own.
          </p>
          <form action={logReplyManually}>
            <input type="hidden" name="thread_id" value={t.id} />
            <p><textarea name="body" rows={5} cols={70}
              placeholder="Paste what they wrote back" /></p>
            <p><button>Save reply</button></p>
          </form>
        </>
      )}

      <p><Link href="/outreach">← All outreach</Link></p>
    </>
  );
}
