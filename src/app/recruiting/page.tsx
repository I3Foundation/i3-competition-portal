import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Queue = {
  id: string; full_name: string | null; email: string | null; role_title: string | null;
  school: string; status: string | null; days: number | null; soft_bounces: number;
};
type School = {
  id: string; name: string; contacts: number; contacted: number;
  replied: number; blocked: number; last: string | null;
};
type Contact = {
  id: string; full_name: string | null; email: string | null; role_title: string | null;
  notes: string | null; school: string; status: string | null; last: string | null;
  blocked_reason: string | null; soft_bounces: number;
};

export default async function Recruiting({
  searchParams,
}: { searchParams: Promise<{ msg?: string; err?: string; days?: string }> }) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  const sp = await searchParams;
  const days = Math.max(1, Number(sp.days ?? 7) || 7);

  const data = await withUser(user.id, async (c) => ({
    // The whole point of the tool: who needs a nudge this week. Contacts whose
    // address is known bad are excluded -- that is what "Unable to send" in the
    // spreadsheet's Notes column could never do.
    queue: (await c.query<Queue>(
      `select c.id, c.full_name, c.email, c.role_title, o.name as school,
              t.status, extract(day from now() - t.last_activity_at)::int as days,
              (select count(*) from suppressions s
                where s.contact_id = c.id and s.reason = 'soft_bounce'
                  and s.lifted_at is null)::int as soft_bounces
         from contacts c
         join organizations o on o.id = c.organization_id
         left join lateral (
           select status, last_activity_at from outreach_threads ot
            where ot.contact_id = c.id order by ot.last_activity_at desc limit 1
         ) t on true
        where c.kind = 'teacher'
          -- One source of truth for sendability. Soft bounces are deliberately
          -- NOT excluded here: a full mailbox is not a dead address.
          and not app.is_suppressed(c.id, 'email')
          and (t.status is null
               or (t.status in ('sent','no_response')
                   and t.last_activity_at < now() - make_interval(days => $1)))
        order by t.last_activity_at nulls first`, [days])).rows,

    schools: (await c.query<School>(
      `select o.id, o.name,
              count(c.id)::int as contacts,
              count(*) filter (where t.status is not null)::int as contacted,
              count(*) filter (where t.status in ('replied','interested'))::int as replied,
              count(*) filter (where app.is_suppressed(c.id,'email'))::int as blocked,
              to_char(max(t.last_activity_at),'Mon DD') as last
         from organizations o
         left join contacts c on c.organization_id = o.id and c.kind='teacher'
         left join lateral (
           select status, last_activity_at from outreach_threads ot
            where ot.contact_id = c.id order by ot.last_activity_at desc limit 1
         ) t on true
        where o.kind = 'school'
        group by o.id, o.name order by o.name`)).rows,

    contacts: (await c.query<Contact>(
      `select c.id, c.full_name, c.email, c.role_title, c.notes,
              o.name as school, t.status,
              to_char(t.last_activity_at,'YYYY-MM-DD') as last,
              (select s.reason::text from suppressions s
                where s.contact_id = c.id and s.channel = 'email'
                  and s.blocks and s.lifted_at is null limit 1) as blocked_reason,
              (select count(*) from suppressions s
                where s.contact_id = c.id and s.reason = 'soft_bounce'
                  and s.lifted_at is null)::int as soft_bounces
         from contacts c
         join organizations o on o.id = c.organization_id
         left join lateral (
           select status, last_activity_at from outreach_threads ot
            where ot.contact_id = c.id order by ot.last_activity_at desc limit 1
         ) t on true
        where c.kind = 'teacher'
        order by o.name, c.full_name nulls last`)).rows,
  }));

  return (
    <>
      <h1>Recruiting</h1>
      <p className="hint">
        Teachers we contact to bring schools into the competition. Replaces the
        tracking spreadsheet. Students cannot see any of this.
        {' '}<strong>Email</strong> sends from the portal and captures the reply;
        {' '}<strong>Mark contacted</strong> just records mail you sent yourself.
      </p>
      {sp.err && <p className="err">{sp.err}</p>}
      {sp.msg && <p className="hint"><strong>{sp.msg}</strong></p>}

      <h2>Needs follow-up</h2>
      <p className="hint">
        Never contacted, or contacted more than {days} days ago with no reply.
        Addresses marked unsendable are excluded — they can never be actioned, so
        listing them just wastes your time.{' '}
        <a href="/recruiting?days=3">3d</a> · <a href="/recruiting?days=7">7d</a> ·{' '}
        <a href="/recruiting?days=14">14d</a>
      </p>
      {data.queue.length === 0
        ? <p className="empty">Nobody is waiting. Everyone has been contacted recently or has replied.</p>
        : (
          <table>
            <thead><tr><th>Teacher</th><th>School</th><th>State</th><th>Actions</th></tr></thead>
            <tbody>
              {data.queue.map((q) => (
                <tr key={q.id}>
                  <td><a href={`/contacts/${q.id}`}>
                        {q.full_name ?? <span className="empty">no name</span>}</a>
                      <br /><span className="hint">{q.email}{q.role_title ? ` · ${q.role_title}` : ''}</span></td>
                  <td>{q.school}</td>
                  <td>{q.status === null
                        ? <strong>never contacted</strong>
                        : <>no reply · {q.days}d ago</>}
                      {q.soft_bounces > 0 && (
                        <><br /><span className="hint">
                          {q.soft_bounces} soft bounce{q.soft_bounces > 1 ? 'es' : ''} — still reachable
                        </span></>)}</td>
                  <td><Actions id={q.id} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

      <h2>By school</h2>
      <p className="hint">
        A flat list of teachers cannot tell you whether a school is actually cold.
        This can.
      </p>
      <table>
        <thead><tr><th>School</th><th>Teachers</th><th>Contacted</th>
                   <th>Replied</th><th>Can&apos;t contact</th><th>Last touch</th></tr></thead>
        <tbody>
          {data.schools.map((s) => (
            <tr key={s.id} className={s.replied > 0 ? 'mine' : undefined}>
              <td>{s.name}</td>
              <td className="num">{s.contacts}</td>
              <td className="num">{s.contacted}</td>
              <td className="num">{s.replied}</td>
              <td className="num">{s.blocked || ''}</td>
              <td>{s.last ?? <span className="empty">never</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>All contacts</h2>
      <table>
        <thead><tr><th>Teacher</th><th>School</th><th>Replied?</th>
                   <th>Last contacted</th><th>Notes</th><th>Actions</th></tr></thead>
        <tbody>
          {data.contacts.map((c) => {
            const blocked = c.blocked_reason !== null;
            const yes = c.status === 'replied' || c.status === 'interested';
            return (
              <tr key={c.id}>
                <td><a href={`/contacts/${c.id}`}>
                      {c.full_name ?? <span className="empty">no name</span>}</a>
                    <br /><span className="hint">{c.email}</span></td>
                <td>{c.school}</td>
                <td>{blocked
                      ? <strong>{c.blocked_reason!.replace(/_/g, ' ')}</strong>
                      : c.status == null ? <span className="empty">—</span>
                      : yes ? 'Yes' : 'No'}
                    {!blocked && c.soft_bounces > 0 && (
                      <><br /><span className="hint">{c.soft_bounces} soft</span></>)}</td>
                <td>{c.last ?? <span className="empty">never</span>}</td>
                <td>{c.notes ?? ''}</td>
                <td>{!blocked && <Actions id={c.id} />}</td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Import from your spreadsheet</h2>
      <p className="hint">
        Paste rows straight from Google Sheets (tab separated), with or without a
        header line. Columns in order: <code>Teacher · Email · School · Reply? ·
        Last contacted · Notes</code>. Notes are read for delivery state:
        &quot;unable to send&quot; or &quot;bad address&quot; imports as a
        permanent block, while &quot;mailbox full&quot; or &quot;soft
        bounce&quot; imports as a soft bounce that stays in the queue. Emails
        already in the registry are skipped, so re-pasting the same sheet is
        safe.
      </p>
      <form action={importRows}>
        <textarea name="tsv" rows={7} cols={90}
          placeholder={'J. Rivera\tjrivera@example.org\tExample High School\tNo\t9/1/2026\t'} />
        <p><button>Import</button></p>
      </form>
    </>
  );
}

function Actions({ id }: { id: string }) {
  return (
    <>
      <a href={`/outreach/new?contact=${id}`} title="Compose and send from the portal">Email</a>{' '}
      <form className="inline" action={logContact}>
        <input type="hidden" name="id" value={id} />
        <button title="You emailed them outside the portal — just record it">Mark contacted</button>
      </form>{' '}
      <form className="inline" action={markReplied}>
        <input type="hidden" name="id" value={id} />
        <button title="They wrote back">Replied</button>
      </form>{' '}
      <form className="inline" action={markSoftBounce}>
        <input type="hidden" name="id" value={id} />
        <button title="Temporary failure — stays in the queue">Soft bounce</button>
      </form>{' '}
      <form className="inline" action={markUnsendable}>
        <input type="hidden" name="id" value={id} />
        <button title="Address is permanently bad — removes from the queue">Can&apos;t send</button>
      </form>
    </>
  );
}

/** Append-only audit of anything that happens to a contact. */
async function logEvent(
  contactId: string, kind: string, userId: string | null, detail: object = {},
) {
  'use server';
  await withUser(userId, (c) =>
    c.query(`insert into contact_events (contact_id, kind, actor_id, detail)
             values ($1,$2,$3,$4)`, [contactId, kind, userId, JSON.stringify(detail)]));
}

/** Creates a thread if none exists, otherwise moves the newest one. */
async function upsertThread(contactId: string, status: string, userId: string, subject: string) {
  'use server';
  await withUser(userId, async (c) => {
    const { rows } = await c.query<{ id: string }>(
      `select id from outreach_threads where contact_id=$1
        order by last_activity_at desc limit 1`, [contactId]);
    if (rows[0]) {
      await c.query(
        `update outreach_threads set status=$1, last_activity_at=now() where id=$2`,
        [status, rows[0].id]);
    } else {
      await c.query(
        `insert into outreach_threads (contact_id, team_id, sender_id, subject, status)
         values ($1, null, $2, $3, $4)`, [contactId, userId, subject, status]);
    }
  });
}

async function logContact(formData: FormData) {
  'use server';
  const u = await currentUser();
  if (u?.role !== 'admin') redirect('/');
  const id = String(formData.get('id'));
  await upsertThread(id, 'sent', u.id, 'I3 Competition invitation');
  await logEvent(id, 'contacted', u.id);
  redirect('/recruiting?msg=' + encodeURIComponent('Marked as contacted today.'));
}

async function markReplied(formData: FormData) {
  'use server';
  const u = await currentUser();
  if (u?.role !== 'admin') redirect('/');
  const id = String(formData.get('id'));
  await upsertThread(id, 'replied', u.id, 'I3 Competition invitation');
  await logEvent(id, 'replied', u.id);
  redirect('/recruiting?msg=' + encodeURIComponent('Marked as replied.'));
}

/**
 * Temporary delivery failure. Recorded for visibility, but blocks=false so the
 * contact STAYS in the follow-up queue. Suppressing on a single soft bounce is
 * Mautic's #9190 bug and the thing this whole table exists to avoid.
 */
async function markSoftBounce(formData: FormData) {
  'use server';
  const u = await currentUser();
  if (u?.role !== 'admin') redirect('/');
  const id = String(formData.get('id'));
  await withUser(u.id, (c) =>
    c.query(`insert into suppressions (contact_id, channel, reason, blocks, source, created_by)
             values ($1,'email','soft_bounce',false,'organiser',$2)`, [id, u.id]));
  await logEvent(id, 'suppressed', u.id, { reason: 'soft_bounce', blocks: false });
  redirect('/recruiting?msg=' + encodeURIComponent(
    'Soft bounce recorded. They remain in the follow-up queue — a full mailbox '
    + 'is not a dead address.'));
}

/** Permanently bad address. Blocks sending; history is kept, not overwritten. */
async function markUnsendable(formData: FormData) {
  'use server';
  const u = await currentUser();
  if (u?.role !== 'admin') redirect('/');
  const id = String(formData.get('id'));
  await withUser(u.id, (c) =>
    c.query(`insert into suppressions (contact_id, channel, reason, blocks, source, created_by)
             values ($1,'email','invalid_address',true,'organiser',$2)`, [id, u.id]));
  await upsertThread(id, 'bounced', u.id, 'I3 Competition invitation');
  await logEvent(id, 'suppressed', u.id, { reason: 'invalid_address', blocks: true });
  redirect('/recruiting?msg=' + encodeURIComponent(
    'Marked unsendable. They will stay out of the follow-up queue.'));
}

async function importRows(formData: FormData) {
  'use server';
  const u = await currentUser();
  if (u?.role !== 'admin') redirect('/');
  const raw = String(formData.get('tsv') ?? '').trim();
  if (!raw) redirect('/recruiting?err=' + encodeURIComponent('Nothing pasted.'));

  const lines = raw.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (/teacher/i.test(lines[0]) && /email/i.test(lines[0])) lines.shift();

  let added = 0, skipped = 0, schools = 0;
  const problems: string[] = [];

  await withUser(u.id, async (c) => {
    for (const line of lines) {
      const [name, email, school, reply, lastContacted, notes] =
        line.split('\t').map((x) => (x ?? '').trim());
      if (!school) { problems.push(`no school: ${line.slice(0, 40)}`); continue; }

      const { rows: orgRows } = await c.query<{ id: string; inserted: boolean }>(
        `with ins as (
           insert into organizations (season_id, kind, name, added_by)
           values ((select id from seasons where is_active),'school',$1,$2)
           on conflict (season_id, kind, name) do nothing
           returning id)
         select id, true as inserted from ins
         union all
         select id, false from organizations
          where kind='school' and name=$1
            and season_id=(select id from seasons where is_active)
          limit 1`, [school, u.id]);
      const org = orgRows[0];
      if (!org) { problems.push(`could not resolve school: ${school}`); continue; }
      if (org.inserted) schools++;

      // Read delivery state out of the free-text Notes column the spreadsheet
      // used. The soft/hard split matters: a spreadsheet saying "mailbox full"
      // must not permanently suppress, so it is imported as a non-blocking
      // soft bounce. Anything clearly terminal blocks.
      const n = notes ?? '';
      const soft = /soft bounce|mailbox full|over quota|try again|temporar/i.test(n);
      const dead = !soft && /unable to send|hard bounce|bounced|invalid|bad address|no such/i.test(n);

      const { rows: cRows } = await c.query<{ id: string }>(
        `insert into contacts (organization_id, season_id, kind, full_name, email,
                               notes, added_by)
         values ($1,(select id from seasons where is_active),'teacher',
                 nullif($2,''), nullif($3,''), nullif($4,''), $5)
         on conflict do nothing
         returning id`,
        [org.id, name ?? '', email ?? '', notes ?? '', u.id]);

      if (!cRows[0]) { skipped++; continue; }
      added++;
      const contactId = cRows[0].id;

      if (soft || dead) {
        await c.query(
          `insert into suppressions (contact_id, channel, reason, blocks, comment,
                                     source, created_by)
           values ($1,'email',$2,$3,$4,'import',$5)`,
          [contactId, soft ? 'soft_bounce' : 'invalid_address', !soft,
           `Imported from spreadsheet notes: ${n.slice(0, 120)}`, u.id]);
      }

      await c.query(
        `insert into contact_events (contact_id, kind, actor_id, detail)
         values ($1,'imported',$2,$3)`,
        [contactId, u.id, JSON.stringify({ school, soft, dead })]);

      const repliedYes = /^y/i.test(reply ?? '');
      const when = lastContacted ? new Date(lastContacted) : null;
      const valid = when && !Number.isNaN(when.getTime());
      if (valid || repliedYes || dead) {
        await c.query(
          `insert into outreach_threads (contact_id, team_id, sender_id, subject,
                                         status, last_activity_at)
           values ($1, null, $2, 'Imported from spreadsheet', $3, coalesce($4::timestamptz, now()))`,
          [contactId, u.id,
           dead ? 'bounced' : repliedYes ? 'replied' : 'sent',
           valid ? when!.toISOString() : null]);
      }
    }
  });

  const note = `Imported ${added} contact(s) across ${schools} new school(s). `
    + `${skipped} already present.`
    + (problems.length ? ` ${problems.length} row(s) skipped: ${problems.slice(0, 3).join('; ')}` : '');
  redirect('/recruiting?msg=' + encodeURIComponent(note));
}
