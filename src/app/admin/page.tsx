import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type TeamRow = {
  id: string; name: string; school: string | null; members: number;
  claims: number; threads: number; replies: number; bookings: number;
};
type StatusRow = { status: string; n: number };
type Person = { id: string; full_name: string; email: string; role: string; team_name: string | null };

export default async function Admin(
  { searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'admin') redirect('/');
  const { msg, err } = await searchParams;

  const data = await withUser(user.id, async (c) => ({
    teams: (await c.query<TeamRow>(
      `select t.id, t.name, t.school,
              (select count(*) from team_members m where m.team_id=t.id) as members,
              (select count(*) from claims cl where cl.team_id=t.id and cl.status='active') as claims,
              (select count(*) from outreach_threads ot where ot.team_id=t.id) as threads,
              (select count(*) from outreach_threads ot
                where ot.team_id=t.id and ot.status in ('replied','interested')) as replies,
              (select count(*) from bookings bk where bk.team_id=t.id and bk.cancelled_at is null) as bookings
         from teams t
        where t.season_id = (select id from seasons where is_active)
        order by t.name`)).rows,
    statuses: (await c.query<StatusRow>(
      `select status, count(*)::int as n from outreach_threads
        where team_id is not null group by status order by status`)).rows,
    unclaimed: Number((await c.query(
      `select count(*) n from organizations o
        where o.kind='business'
          and not exists (select 1 from claims c
                           where c.organization_id=o.id and c.status='active')`)).rows[0].n),
    recruiting: (await c.query<{ schools: number; teachers: number; replied: number; dead: number; queue: number }>(
      `select
         (select count(*) from organizations where kind='school')::int as schools,
         (select count(*) from contacts where kind='teacher')::int as teachers,
         (select count(*) from contacts c
           where c.kind='teacher' and exists (
             select 1 from outreach_threads t
              where t.contact_id=c.id and t.status in ('replied','interested')))::int as replied,
         (select count(*) from contacts
           where kind='teacher' and app.is_suppressed(id,'email'))::int as dead,
         (select count(*) from contacts c
           left join lateral (select status, last_activity_at from outreach_threads t
                               where t.contact_id=c.id order by t.last_activity_at desc limit 1) t on true
           where c.kind='teacher' and not app.is_suppressed(c.id,'email')
             and (t.status is null or (t.status in ('sent','no_response')
                  and t.last_activity_at < now() - interval '7 days')))::int as queue`)).rows[0],
    people: (await c.query<Person>(
      `select p.id, p.full_name, p.email, p.role, t.name as team_name
         from profiles p
         left join team_members tm on tm.profile_id=p.id
         left join teams t on t.id=tm.team_id
        order by case p.role when 'admin' then 0 when 'mentor' then 1 else 2 end, p.full_name`)).rows,
  }));

  async function addTeam(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const name = String(formData.get('name') ?? '').trim();
    if (!name) redirect('/admin?err=' + encodeURIComponent('Team name required.'));
    try {
      await withUser(u.id, (c) => c.query(
        `insert into teams (season_id, name, school, team_email)
         values ((select id from seasons where is_active),$1,$2,$3)`,
        [name, String(formData.get('school') ?? '').trim() || null,
         String(formData.get('team_email') ?? '').trim() || null]));
    } catch {
      redirect('/admin?err=' + encodeURIComponent('A team with that name already exists this season.'));
    }
    redirect('/admin?msg=' + encodeURIComponent('Team added.'));
  }

  async function assign(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const profileId = String(formData.get('profile_id'));
    const teamId = String(formData.get('team_id'));
    try {
      await withUser(u.id, (c) => c.query(
        `insert into team_members (team_id, profile_id, season_id)
         values ($1,$2,(select season_id from teams where id=$1))`, [teamId, profileId]));
    } catch (e: unknown) {
      // unique(profile_id, season_id): already on a team this season.
      const code = (e as { code?: string }).code;
      redirect('/admin?err=' + encodeURIComponent(
        code === '23505'
          ? 'That student is already on a team this season. Remove them first.'
          : 'Could not assign.'));
    }
    redirect('/admin?msg=' + encodeURIComponent('Assigned.'));
  }

  const unassigned = data.people.filter((p) => p.role === 'student' && !p.team_name);

  return (
    <>
      <h1>Admin</h1>
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint"><strong>{msg}</strong></p>}

      <h2>Team coverage</h2>
      <p className="hint">
        The number to watch early in a season is claims per team — a team at zero
        has not started outreach. {data.unclaimed} businesses are unclaimed.
      </p>
      <table>
        <thead>
          <tr><th>Team</th><th>Members</th><th>Claims</th><th>Threads</th>
              <th>Replies / interested</th><th>Mentor sessions</th></tr>
        </thead>
        <tbody>
          {data.teams.map((t) => (
            <tr key={t.id}>
              <td>{t.name}{t.school && <><br /><span className="hint">{t.school}</span></>}</td>
              <td className="num">{t.members}</td>
              <td className="num">{t.claims}</td>
              <td className="num">{t.threads}</td>
              <td className="num">{t.replies}</td>
              <td className="num">{t.bookings}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <h2>Recruiting</h2>
      <p className="hint">
        Schools contacted to bring teams in. <a href="/recruiting">Open the recruiting tracker →</a>
      </p>
      <table>
        <tbody>
          <tr><th>Schools in list</th><td className="num">{data.recruiting.schools}</td></tr>
          <tr><th>Teachers in list</th><td className="num">{data.recruiting.teachers}</td></tr>
          <tr><th>Replied</th><td className="num">{data.recruiting.replied}</td></tr>
          <tr><th>Can&apos;t contact (bad address or opted out)</th>
              <td className="num">{data.recruiting.dead}</td></tr>
          <tr><th>Waiting on follow-up (7d)</th><td className="num">{data.recruiting.queue}</td></tr>
        </tbody>
      </table>

      <h2>Team outreach by status</h2>
      <table>
        <thead><tr><th>Status</th><th>Threads</th></tr></thead>
        <tbody>
          {data.statuses.map((s) => (
            <tr key={s.status}><td>{s.status}</td><td className="num">{s.n}</td></tr>
          ))}
        </tbody>
      </table>

      <h2>People</h2>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Team</th></tr></thead>
        <tbody>
          {data.people.map((p) => (
            <tr key={p.id}>
              <td>{p.full_name}<br /><span className="hint">{p.email}</span></td>
              <td>{p.role}</td>
              <td>{p.team_name ?? <span className="empty">unassigned</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {unassigned.length > 0 && (
        <form action={assign}>
          <fieldset>
            <legend>Assign a student to a team</legend>
            <select name="profile_id">
              {unassigned.map((p) => <option key={p.id} value={p.id}>{p.full_name}</option>)}
            </select>{' '}
            <select name="team_id">
              {data.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>{' '}
            <button>Assign</button>
          </fieldset>
        </form>
      )}

      <form action={addTeam}>
        <fieldset>
          <legend>Add a team</legend>
          <div className="grid">
            <label>Name*<br /><input name="name" required /></label>
            <label>School<br /><input name="school" /></label>
            <label>Team email<br /><input name="team_email" type="email" /></label>
          </div>
          <p><button>Add team</button></p>
        </fieldset>
      </form>
    </>
  );
}
