import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; subject: string; status: string; business_name: string;
  business_email: string | null; sender: string; last: string;
  replies: number; days_quiet: number;
};

export default async function Outreach() {
  const user = await currentUser();
  if (!user) redirect('/login');

  const rows = await withUser(user.id, async (c) =>
    (await c.query<Row>(
      // No team filter in this query on purpose -- RLS applies it. A student on
      // another team running this exact SQL gets their own rows, never these.
      `select t.id, t.subject, t.status, o.name::text as business_name,
              ct.email::text as business_email, p.full_name as sender,
              to_char(t.last_activity_at,'Mon DD') as last,
              (select count(*) from messages m
                where m.thread_id=t.id and m.direction='inbound') as replies,
              extract(day from now() - t.last_activity_at)::int as days_quiet
         from outreach_threads t
         join contacts ct on ct.id = t.contact_id
         join organizations o on o.id = ct.organization_id
         join profiles p on p.id = t.sender_id
        order by t.last_activity_at desc`,
    )).rows,
  );

  const stale = rows.filter((r) => r.status === 'sent' && r.days_quiet >= 7);

  return (
    <>
      <h1>Outreach</h1>
      <p className="hint">
        {user.role === 'admin'
          ? 'All teams. Message contents are visible to admins only.'
          : `${user.team_name ?? 'your team'} only — other teams cannot see these threads.`}
      </p>

      {stale.length > 0 && (
        <p className="err">
          {stale.length} thread{stale.length > 1 ? 's have' : ' has'} been silent
          for a week or more. Consider following up or releasing the claim.
        </p>
      )}

      {rows.length === 0
        ? <p className="empty">No contact logged yet. Claim a business, then log your first contact.</p>
        : (
          <table>
            <thead>
              <tr><th>Business</th><th>Subject</th><th>Sent by</th>
                  <th>Status</th><th>Replies</th><th>Last activity</th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>{r.business_name}<br /><span className="hint">{r.business_email}</span></td>
                  <td><Link href={`/outreach/${r.id}`}>{r.subject}</Link></td>
                  <td>{r.sender}</td>
                  <td>{r.status}</td>
                  <td className="num">{r.replies}</td>
                  <td>{r.last}<br /><span className="hint">{r.days_quiet}d ago</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      <p><Link href="/businesses">Registry →</Link></p>
    </>
  );
}
