import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const stats = await withUser(user.id, async (c) => {
    const one = async (sql: string, p: unknown[] = []) =>
      Number((await c.query(sql, p)).rows[0]?.n ?? 0);
    return {
      season: (await c.query<{ name: string }>('select name from seasons where is_active')).rows[0]?.name,
      businesses: await one(`select count(*) n from organizations where kind='business'`),
      unclaimed: await one(
        `select count(*) n from organizations o
          where o.kind='business'
            and not exists (select 1 from claims c
                             where c.organization_id=o.id and c.status='active')`),
      ourClaims: user.team_id
        ? await one(`select count(*) n from claims where team_id=$1 and status='active'`, [user.team_id])
        : 0,
      ourThreads: await one('select count(*) n from outreach_threads'),
      openSlots: await one(`select count(*) n from slots where status='open' and starts_at > now()`),
      ourBookings: await one(
        `select count(*) n from bookings b join slots s on s.id=b.slot_id
          where b.cancelled_at is null and s.starts_at > now()`),
    };
  });

  return (
    <>
      <h1>{user.full_name}</h1>
      <p className="hint">{stats.season ?? 'No active season'} · signed in as {user.role}
        {user.team_name ? ` on ${user.team_name}` : ''}</p>

      {user.role === 'student' && !user.team_id && (
        <p className="err">You are not on a team for the active season. An admin needs to add you.</p>
      )}

      <h2>At a glance</h2>
      <table>
        <tbody>
          <tr><th>Businesses in registry</th><td className="num">{stats.businesses}</td>
              <td><Link href="/businesses">open registry</Link></td></tr>
          <tr><th>Unclaimed and available</th><td className="num">{stats.unclaimed}</td><td /></tr>
          {user.role === 'student' && <>
            <tr><th>Businesses your team holds</th><td className="num">{stats.ourClaims}</td><td /></tr>
            <tr><th>Your outreach threads</th><td className="num">{stats.ourThreads}</td>
                <td><Link href="/outreach">open outreach</Link></td></tr>
          </>}
          <tr><th>Open mentor slots</th><td className="num">{stats.openSlots}</td>
              <td><Link href="/mentors">book a mentor</Link></td></tr>
          <tr><th>Upcoming bookings you can see</th><td className="num">{stats.ourBookings}</td>
              <td><Link href="/bookings">open bookings</Link></td></tr>
        </tbody>
      </table>
      <p className="hint">
        Every number above is filtered by database row-level security, not by this
        page. Sign in as another team to confirm the outreach counts change.
      </p>
    </>
  );
}
