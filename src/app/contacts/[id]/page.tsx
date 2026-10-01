import Link from 'next/link';
import { notFound, redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Contact = {
  id: string; full_name: string | null; email: string | null; phone: string | null;
  role_title: string | null; kind: string; notes: string | null;
  unsubscribe_token: string; school: string; org_kind: string;
  suppressed: boolean;
};
type Sup = {
  id: string; reason: string; channel: string; blocks: boolean;
  comment: string | null; source: string | null; created_at: string;
  created_by_name: string | null; lifted_at: string | null; lifted_by_name: string | null;
};
type Event = {
  id: string; kind: string; detail: Record<string, unknown>;
  actor: string | null; created_at: string;
};

export default async function ContactPage({
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
    // Returns nothing if RLS says this contact is not visible to the caller.
    const contact = (await c.query<Contact>(
      `select ct.id, ct.full_name, ct.email::text as email, ct.phone, ct.role_title,
              ct.kind::text as kind, ct.notes, ct.unsubscribe_token,
              o.name::text as school, o.kind::text as org_kind,
              app.is_suppressed(ct.id,'email') as suppressed
         from contacts ct
         join organizations o on o.id = ct.organization_id
        where ct.id = $1`, [id])).rows[0];
    if (!contact) return null;

    return {
      contact,
      sups: (await c.query<Sup>(
        `select s.id, s.reason::text as reason, s.channel::text as channel, s.blocks,
                s.comment, s.source,
                to_char(s.created_at,'YYYY-MM-DD HH24:MI') as created_at,
                p.full_name as created_by_name,
                to_char(s.lifted_at,'YYYY-MM-DD HH24:MI') as lifted_at,
                lp.full_name as lifted_by_name
           from suppressions s
           left join profiles p  on p.id  = s.created_by
           left join profiles lp on lp.id = s.lifted_by
          where s.contact_id = $1
          order by s.created_at desc`, [id])).rows,
      events: (await c.query<Event>(
        `select e.id::text as id, e.kind, e.detail, p.full_name as actor,
                to_char(e.created_at,'YYYY-MM-DD HH24:MI') as created_at
           from contact_events e
           left join profiles p on p.id = e.actor_id
          where e.contact_id = $1
          order by e.created_at desc, e.id desc`, [id])).rows,
    };
  });
  if (!data) notFound();
  const { contact, sups, events } = data;

  async function lift(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (u?.role !== 'admin') redirect('/');
    const supId = String(formData.get('sup_id'));
    const contactId = String(formData.get('contact_id'));
    try {
      await withUser(u.id, (c) =>
        c.query(`update suppressions set lifted_at=now(), lifted_by=$2 where id=$1`,
          [supId, u.id]));
    } catch (e: unknown) {
      // 23514 = unsubscribe_is_final. An opt-out is the recipient's call.
      const code = (e as { code?: string }).code;
      redirect(`/contacts/${contactId}?err=` + encodeURIComponent(
        code === '23514'
          ? 'An unsubscribe cannot be lifted. Only the recipient can ask to be re-added.'
          : 'Could not lift that suppression.'));
    }
    await withUser(u.id, (c) =>
      c.query(`insert into contact_events (contact_id, kind, actor_id, detail)
               values ($1,'lifted',$2,$3)`,
        [contactId, u.id, JSON.stringify({ suppression_id: supId })]));
    redirect(`/contacts/${contactId}?msg=` + encodeURIComponent('Suppression lifted.'));
  }

  return (
    <>
      <h1>{contact.full_name ?? <span className="empty">unnamed contact</span>}</h1>
      <p className="hint">
        {contact.school} · {contact.role_title ?? contact.kind.replace('_', ' ')}
        {contact.email ? ` · ${contact.email}` : ''}
        {contact.phone ? ` · ${contact.phone}` : ''}
      </p>
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint"><strong>{msg}</strong></p>}

      <p>
        {contact.suppressed
          ? <strong>We may not email this contact.</strong>
          : 'Emailable.'}
      </p>
      {contact.notes && <p className="hint">Notes: {contact.notes}</p>}

      <h2>Suppression history</h2>
      <p className="hint">
        Append-only. Rows are never overwritten, so the reason and date of every
        block survive — including ones that were later lifted.
      </p>
      {sups.length === 0 ? <p className="empty">No suppressions.</p> : (
        <table>
          <thead><tr><th>Reason</th><th>Blocks?</th><th>When</th>
                     <th>By</th><th>Comment</th><th /></tr></thead>
          <tbody>
            {sups.map((s) => (
              <tr key={s.id} className={s.lifted_at ? undefined : 'mine'}>
                <td>{s.reason.replace(/_/g, ' ')}<br />
                    <span className="hint">{s.channel}{s.source ? ` · ${s.source}` : ''}</span></td>
                <td>{s.blocks ? 'yes' : <span className="hint">no — still reachable</span>}</td>
                <td>{s.created_at}
                    {s.lifted_at && <><br /><span className="hint">lifted {s.lifted_at}</span></>}</td>
                <td>{s.created_by_name ?? <span className="hint">recipient</span>}
                    {s.lifted_by_name && <><br /><span className="hint">by {s.lifted_by_name}</span></>}</td>
                <td>{s.comment ?? ''}</td>
                <td>
                  {user.role === 'admin' && !s.lifted_at && s.reason !== 'unsubscribed' && (
                    <form className="inline" action={lift}>
                      <input type="hidden" name="sup_id" value={s.id} />
                      <input type="hidden" name="contact_id" value={contact.id} />
                      <button>Lift</button>
                    </form>
                  )}
                  {s.reason === 'unsubscribed' && (
                    <span className="hint">cannot be lifted</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2>Timeline</h2>
      {events.length === 0 ? <p className="empty">Nothing recorded.</p> : (
        <ul className="plain">
          {events.map((e) => (
            <li key={e.id}>
              <strong>{e.kind}</strong>{' '}
              <span className="hint">
                {e.created_at} · {e.actor ?? 'system / recipient'}
                {Object.keys(e.detail).length > 0 && ` · ${JSON.stringify(e.detail)}`}
              </span>
            </li>
          ))}
        </ul>
      )}

      {user.role === 'admin' && (
        <>
          <h2>Opt-out link</h2>
          <p className="hint">
            Goes in the <code>List-Unsubscribe</code> header and the footer of
            every email sent to this contact in Phase 2a.
          </p>
          <p><code>/u/{contact.unsubscribe_token}</code></p>
        </>
      )}

      <p>
        <Link href={contact.org_kind === 'school' ? '/recruiting' : '/businesses'}>
          ← Back
        </Link>
      </p>
    </>
  );
}
