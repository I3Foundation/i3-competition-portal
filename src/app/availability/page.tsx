import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

const DAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

type Rule = { id: string; weekday: number; start_time: string; end_time: string; slot_minutes: number };
type Exc = { id: string; on_date: string };

export default async function Availability(
  { searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/login');
  if (user.role !== 'mentor' && user.role !== 'admin') redirect('/');
  const { msg, err } = await searchParams;

  const data = await withUser(user.id, async (c) => ({
    profile: (await c.query<{ meeting_link: string | null; timezone: string }>(
      'select meeting_link, timezone from mentor_profiles where profile_id=$1',
      [user.id])).rows[0],
    rules: (await c.query<Rule>(
      `select id, weekday, to_char(start_time,'HH24:MI') as start_time,
              to_char(end_time,'HH24:MI') as end_time, slot_minutes
         from availability_rules where mentor_id=$1 order by weekday, start_time`,
      [user.id])).rows,
    excs: (await c.query<Exc>(
      `select id, to_char(on_date,'YYYY-MM-DD') as on_date
         from availability_exceptions
        where mentor_id=$1 and is_blocked and on_date >= current_date
        order by on_date`, [user.id])).rows,
    open: Number((await c.query(
      `select count(*) n from slots
        where mentor_id=$1 and status='open' and starts_at > now()`, [user.id])).rows[0].n),
  }));

  async function addRule(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const start = String(formData.get('start_time'));
    const end = String(formData.get('end_time'));
    if (end <= start) {
      redirect('/availability?err=' + encodeURIComponent('End time must be after start time.'));
    }
    await withUser(u.id, (c) => c.query(
      `insert into availability_rules (mentor_id, season_id, weekday, start_time, end_time, slot_minutes)
       values ($1,(select id from seasons where is_active),$2,$3,$4,$5)`,
      [u.id, Number(formData.get('weekday')), start, end, Number(formData.get('slot_minutes'))]));
    redirect('/availability?msg=' + encodeURIComponent('Added. Generate slots to publish it.'));
  }

  async function removeRule(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    await withUser(u.id, (c) =>
      c.query('delete from availability_rules where id=$1', [String(formData.get('id'))]));
    redirect('/availability?msg=' + encodeURIComponent(
      'Rule removed. Already-published slots stay until you delete them.'));
  }

  async function blockDate(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const date = String(formData.get('on_date'));
    await withUser(u.id, async (c) => {
      await c.query(
        `insert into availability_exceptions (mentor_id, on_date, is_blocked) values ($1,$2,true)`,
        [u.id, date]);
      // Pull any unbooked slots on that date. Booked ones are left alone --
      // cancelling on a team silently would be worse than the mentor seeing it.
      await c.query(
        `delete from slots
          where mentor_id=$1 and status='open'
            and (starts_at at time zone (select timezone from mentor_profiles
                                          where profile_id=$1))::date = $2::date`,
        [u.id, date]);
    });
    redirect('/availability?msg=' + encodeURIComponent(
      'Date blocked. Open slots removed; anything already booked is untouched.'));
  }

  async function setLink(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const link = String(formData.get('meeting_link') ?? '').trim() || null;
    await withUser(u.id, async (c) => {
      await c.query(
        `insert into mentor_profiles (profile_id, meeting_link) values ($1,$2)
         on conflict (profile_id) do update set meeting_link = excluded.meeting_link`,
        [u.id, link]);
      // Push the new link onto slots nobody has booked yet.
      await c.query(`update slots set meeting_link=$2 where mentor_id=$1 and status='open'`,
        [u.id, link]);
    });
    redirect('/availability?msg=' + encodeURIComponent('Meeting link saved.'));
  }

  async function generate() {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const n = await withUser(u.id, async (c) =>
      (await c.query<{ n: number }>('select app.generate_slots($1,4) as n', [u.id])).rows[0].n);
    redirect('/availability?msg=' + encodeURIComponent(`Published ${n} new slot(s).`));
  }

  return (
    <>
      <h1>My availability</h1>
      <p className="hint">
        Set the hours you repeat each week, then publish them as bookable slots.
        {' '}{data.open} open slot(s) currently published.
      </p>
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint"><strong>{msg}</strong></p>}

      <h2>Meeting link</h2>
      <p className="hint">
        Your own Zoom/Meet room. Attached to every slot you publish — no shared
        account pool to run out of.
      </p>
      <form action={setLink}>
        <input name="meeting_link" size={50} defaultValue={data.profile?.meeting_link ?? ''}
               placeholder="https://zoom.us/j/..." />{' '}
        <button>Save</button>
      </form>

      <h2>Weekly hours</h2>
      {data.rules.length === 0 ? <p className="empty">No hours set.</p> : (
        <table>
          <thead><tr><th>Day</th><th>From</th><th>To</th><th>Slot length</th><th /></tr></thead>
          <tbody>
            {data.rules.map((r) => (
              <tr key={r.id}>
                <td>{DAYS[r.weekday]}</td><td>{r.start_time}</td><td>{r.end_time}</td>
                <td>{r.slot_minutes} min</td>
                <td>
                  <form className="inline" action={removeRule}>
                    <input type="hidden" name="id" value={r.id} />
                    <button>Remove</button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <form action={addRule}>
        <fieldset>
          <legend>Add weekly hours</legend>
          <div className="grid">
            <label>Day<br />
              <select name="weekday" defaultValue="2">
                {DAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}
              </select></label>
            <label>From<br /><input name="start_time" type="time" defaultValue="16:00" required /></label>
            <label>To<br /><input name="end_time" type="time" defaultValue="18:00" required /></label>
            <label>Slot length<br />
              <select name="slot_minutes" defaultValue="30">
                <option value="30">30 min</option><option value="60">60 min</option>
              </select></label>
          </div>
          <p><button>Add</button></p>
        </fieldset>
      </form>

      <h2>Publish slots</h2>
      <p className="hint">Creates bookable slots for the next 4 weeks. Safe to run repeatedly — existing slots are untouched.</p>
      <form action={generate}><button>Generate slots</button></form>

      <h2>Days off</h2>
      {data.excs.length > 0 && (
        <ul className="plain">{data.excs.map((e) => <li key={e.id}>{e.on_date}</li>)}</ul>
      )}
      <form action={blockDate}>
        <input name="on_date" type="date" required />{' '}
        <button>Block this date</button>
      </form>
    </>
  );
}
