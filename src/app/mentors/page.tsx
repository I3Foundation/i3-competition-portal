import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Mentor = { id: string; full_name: string; bio: string | null; expertise: string[] };
type Slot = { id: string; mentor_id: string; when: string; day: string; tz: string; taken: boolean };

export default async function Mentors(
  { searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { msg, err } = await searchParams;

  const { mentors, slots } = await withUser(user.id, async (c) => ({
    mentors: (await c.query<Mentor>(
      `select p.id, p.full_name, m.bio, m.expertise
         from profiles p join mentor_profiles m on m.profile_id = p.id
        where p.role='mentor' order by p.full_name`)).rows,
    slots: (await c.query<Slot>(
      // Times are rendered in the mentor's own timezone. Formatting the raw
      // timestamptz would use the server's zone (UTC in Docker), showing a
      // 16:00 slot as 20:00.
      `select s.id, s.mentor_id,
              to_char(s.starts_at at time zone mp.timezone,'HH24:MI') as when,
              to_char(s.starts_at at time zone mp.timezone,'Dy Mon DD') as day,
              mp.timezone as tz,
              s.status='booked' as taken
         from slots s
         join mentor_profiles mp on mp.profile_id = s.mentor_id
        where s.starts_at > now()
          and s.starts_at < now() + interval '28 days'
        order by s.starts_at`)).rows,
  }));

  async function book(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u?.team_id) redirect('/mentors?err=' + encodeURIComponent('Only teams can book.'));
    const slotId = String(formData.get('slot_id'));
    const topic = String(formData.get('topic') ?? '').trim() || null;
    try {
      await withUser(u.id, async (c) => {
        await c.query(
          `insert into bookings (slot_id, team_id, booked_by, topic) values ($1,$2,$3,$4)`,
          [slotId, u.team_id, u.id, topic]);
        await c.query(`update slots set status='booked' where id=$1`, [slotId]);
      });
    } catch (e: unknown) {
      // 23505 = unique(slot_id) on bookings: another team got there first.
      const code = (e as { code?: string }).code;
      redirect('/mentors?err=' + encodeURIComponent(
        code === '23505'
          ? 'That slot was just booked by another team. Pick another.'
          : 'Could not book that slot.'));
    }
    redirect('/mentors?msg=' + encodeURIComponent('Booked. Check Our bookings for the link.'));
  }

  return (
    <>
      <h1>Mentors</h1>
      <p className="hint">Next 4 weeks. Booking a slot reserves it for your whole team.</p>
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint"><strong>{msg}</strong></p>}

      {mentors.map((mt) => {
        const mine = slots.filter((s) => s.mentor_id === mt.id);
        const open = mine.filter((s) => !s.taken);
        return (
          <section key={mt.id}>
            <h2>{mt.full_name}</h2>
            <p className="hint">
              {mt.expertise.join(' · ')}{mt.bio ? ` — ${mt.bio}` : ''}
            </p>
            {open.length === 0
              ? <p className="empty">No open slots in the next 4 weeks.</p>
              : (
                <table>
                  <thead><tr><th>Day</th><th>Time</th><th>Topic (optional)</th><th /></tr></thead>
                  <tbody>
                    {open.map((s) => (
                      <tr key={s.id}>
                        <td>{s.day}</td>
                        <td>{s.when}<br /><span className="hint">{s.tz.split('/')[1]?.replace('_',' ')}</span></td>
                        <td>
                          <form className="inline" action={book} id={`f-${s.id}`}>
                            <input type="hidden" name="slot_id" value={s.id} />
                            <input name="topic" size={34} placeholder="What do you want help with?" />
                          </form>
                        </td>
                        <td>
                          {user.team_id
                            ? <button form={`f-${s.id}`}>Book</button>
                            : <span className="empty">no team</span>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            {mine.length > open.length && (
              <p className="hint">{mine.length - open.length} slot(s) already booked.</p>
            )}
          </section>
        );
      })}
    </>
  );
}
