import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; when: string; tz: string; mentor: string; team: string;
  topic: string | null; link: string | null; booked_by: string; past: boolean;
};

export default async function Bookings() {
  const user = await currentUser();
  if (!user) redirect('/login');

  // RLS scopes this: a team sees its own, a mentor sees bookings on their slots.
  const rows = await withUser(user.id, async (c) =>
    (await c.query<Row>(
      // Rendered in the mentor's timezone -- see the note in /mentors.
      `select bk.id,
              to_char(s.starts_at at time zone mtz.timezone,'Dy Mon DD, HH24:MI') as when,
              mtz.timezone as tz,
              mp.full_name as mentor, t.name as team, bk.topic,
              s.meeting_link as link, bp.full_name as booked_by,
              s.starts_at < now() as past
         from bookings bk
         join slots s on s.id = bk.slot_id
         join profiles mp on mp.id = s.mentor_id
         join mentor_profiles mtz on mtz.profile_id = s.mentor_id
         join teams t on t.id = bk.team_id
         join profiles bp on bp.id = bk.booked_by
        where bk.cancelled_at is null
        order by s.starts_at`)).rows,
  );

  async function cancel(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const id = String(formData.get('id'));
    await withUser(u.id, async (c) => {
      const { rows } = await c.query<{ slot_id: string }>(
        `update bookings set cancelled_at=now() where id=$1 returning slot_id`, [id]);
      if (rows[0]) await c.query(`update slots set status='open' where id=$1`, [rows[0].slot_id]);
    });
    redirect('/bookings');
  }

  const upcoming = rows.filter((r) => !r.past);
  const past = rows.filter((r) => r.past);

  return (
    <>
      <h1>Bookings</h1>
      <p className="hint">
        {user.role === 'mentor' ? 'Sessions booked with you.' : 'Sessions your team has booked.'}
      </p>

      <h2>Upcoming</h2>
      {upcoming.length === 0 ? <p className="empty">Nothing booked.</p> : (
        <table>
          <thead><tr><th>When</th><th>Mentor</th><th>Team</th><th>Topic</th><th>Link</th><th /></tr></thead>
          <tbody>
            {upcoming.map((r) => (
              <tr key={r.id}>
                <td>{r.when}<br /><span className="hint">{r.tz.split('/')[1]?.replace('_',' ')}</span></td>
                <td>{r.mentor}</td>
                <td>{r.team}<br /><span className="hint">booked by {r.booked_by}</span></td>
                <td>{r.topic ?? <span className="empty">—</span>}</td>
                <td>{r.link ? <a href={r.link}>join</a> : <span className="empty">none set</span>}</td>
                <td>
                  <form className="inline" action={cancel}>
                    <input type="hidden" name="id" value={r.id} />
                    <button>Cancel</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {past.length > 0 && <>
        <h2>Past</h2>
        <table>
          <thead><tr><th>When</th><th>Mentor</th><th>Team</th><th>Topic</th></tr></thead>
          <tbody>
            {past.map((r) => (
              <tr key={r.id}><td>{r.when}</td><td>{r.mentor}</td>
                  <td>{r.team}</td><td>{r.topic ?? '—'}</td></tr>
            ))}
          </tbody>
        </table>
      </>}
    </>
  );
}
