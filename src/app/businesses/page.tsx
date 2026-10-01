import Link from 'next/link';
import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { currentUser } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Row = {
  id: string; name: string; owner_name: string | null; email: string | null;
  phone: string | null; category: string | null; address: string | null;
  claim_team_id: string | null; claim_team_name: string | null;
  claimed_on: string | null; thread_id: string | null; contact_id: string | null;
  similar_to: string | null;
};

export default async function Businesses(
  { searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> },
) {
  const user = await currentUser();
  if (!user) redirect('/login');
  const { msg, err } = await searchParams;

  const rows = await withUser(user.id, async (c) =>
    (await c.query<Row>(
      `select o.id, o.name::text as name, ct.full_name as owner_name,
              ct.email::text as email, ct.phone, o.category, o.address,
              c.team_id as claim_team_id, t.name as claim_team_name,
              to_char(c.claimed_at,'Mon DD') as claimed_on,
              (select ot.id from outreach_threads ot
                where ot.contact_id = ct.id limit 1) as thread_id,
              ct.id as contact_id,
              -- Soft duplicate detection. Exact email duplicates are blocked by
              -- the database; near-identical names only get flagged, because
              -- two genuinely different shops can share a name.
              (select string_agg(o2.name::text, ', ') from organizations o2
                where o2.id <> o.id and o2.season_id = o.season_id
                  and o2.kind = 'business'
                  and similarity(o2.name::text, o.name::text) > 0.45) as similar_to
         from organizations o
         left join contacts ct
           on ct.organization_id = o.id and ct.kind = 'business_owner'
         left join claims c on c.organization_id = o.id and c.status = 'active'
         left join teams t on t.id = c.team_id
        where o.kind = 'business'
          and o.season_id = (select id from seasons where is_active)
        order by o.name`,
    )).rows,
  );

  async function claim(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u?.team_id) redirect('/businesses?err=' + encodeURIComponent('You are not on a team.'));
    const businessId = String(formData.get('id'));
    try {
      await withUser(u.id, (c) =>
        c.query(`insert into claims (organization_id, team_id, claimed_by) values ($1,$2,$3)`,
          [businessId, u.team_id, u.id]));
    } catch (e: unknown) {
      // 23505 = the partial unique index fired: someone claimed it first.
      const code = (e as { code?: string }).code;
      redirect('/businesses?err=' + encodeURIComponent(
        code === '23505'
          ? 'Another team claimed that business first. The registry has refreshed.'
          : 'Could not claim that business.'));
    }
    redirect('/businesses?msg=' + encodeURIComponent('Claimed.'));
  }

  async function release(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    await withUser(u.id, (c) =>
      c.query(`update claims set status='released', released_at=now()
                where organization_id=$1 and status='active'`, [String(formData.get('id'))]));
    redirect('/businesses?msg=' + encodeURIComponent('Released back to the pool.'));
  }

  async function add(formData: FormData) {
    'use server';
    const u = await currentUser();
    if (!u) redirect('/login');
    const get = (k: string) => {
      const v = String(formData.get(k) ?? '').trim();
      return v === '' ? null : v;
    };
    const name = get('name');
    if (!name) redirect('/businesses?err=' + encodeURIComponent('Name is required.'));
    try {
      await withUser(u.id, async (c) => {
        const { rows } = await c.query<{ id: string }>(
          `insert into organizations (season_id, kind, name, category, address, added_by)
           values ((select id from seasons where is_active),'business',$1,$2,$3,$4)
           returning id`,
          [name, get('category'), get('address'), u.id]);
        await c.query(
          `insert into contacts (organization_id, season_id, kind, full_name, email,
                                 phone, role_title, added_by)
           values ($1,(select id from seasons where is_active),'business_owner',
                   $2,$3,$4,'Owner',$5)`,
          [rows[0].id, get('owner_name'), get('email'), get('phone'), u.id]);
      });
    } catch (e: unknown) {
      const code = (e as { code?: string }).code;
      redirect('/businesses?err=' + encodeURIComponent(
        code === '23505'
          ? 'That business name or email is already in the registry.'
          : 'Could not add that business.'));
    }
    redirect('/businesses?msg=' + encodeURIComponent('Added to registry.'));
  }

  const unclaimed = rows.filter((r) => !r.claim_team_id).length;

  return (
    <>
      <h1>Business registry</h1>
      <p className="hint">
        Shared across every team this season. Claim a business before you contact
        it — one team at a time, enforced by the database, so two teams cannot
        both claim the same shop even by clicking at the same instant.
      </p>
      {err && <p className="err">{err}</p>}
      {msg && <p className="hint"><strong>{msg}</strong></p>}
      <p className="hint">{rows.length} businesses · {unclaimed} unclaimed</p>

      <table>
        <thead>
          <tr>
            <th>Business</th><th>Contact</th><th>Category</th>
            <th>Held by</th><th>Action</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const mine = r.claim_team_id && r.claim_team_id === user.team_id;
            return (
              <tr key={r.id} className={mine ? 'mine' : undefined}>
                <td>
                  {r.name}
                  {r.owner_name && <><br /><span className="hint">{r.owner_name}</span></>}
                  {r.similar_to && (
                    <><br /><span className="hint">⚠ similar name already in registry: {r.similar_to}</span></>
                  )}
                </td>
                <td>
                  {r.email ?? <span className="empty">no email</span>}
                  {r.phone && <><br />{r.phone}</>}
                </td>
                <td>{r.category ?? <span className="empty">—</span>}</td>
                <td>
                  {r.claim_team_name
                    ? <>{r.claim_team_name}{r.claimed_on && <><br /><span className="hint">since {r.claimed_on}</span></>}</>
                    : <span className="empty">unclaimed</span>}
                </td>
                <td>
                  {!r.claim_team_id && user.team_id && (
                    <form className="inline" action={claim}>
                      <input type="hidden" name="id" value={r.id} />
                      <button>Claim</button>
                    </form>
                  )}
                  {(mine || user.role === 'admin') && r.claim_team_id && (
                    <form className="inline" action={release}>
                      <input type="hidden" name="id" value={r.id} />
                      <button>Release</button>
                    </form>
                  )}
                  {mine && r.contact_id && (r.thread_id
                    ? <> <Link href={`/outreach/${r.thread_id}`}>thread</Link></>
                    : <> <Link href={`/outreach/new?contact=${r.contact_id}`}>log contact</Link></>)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <h2>Add a business</h2>
      <p className="hint">
        Duplicate email addresses are rejected outright. Similar names are only
        flagged, since two real businesses can legitimately share one.
      </p>
      <form action={add}>
        <fieldset>
          <legend>New business</legend>
          <div className="grid">
            <label>Name*<br /><input name="name" required /></label>
            <label>Owner<br /><input name="owner_name" /></label>
            <label>Email<br /><input name="email" type="email" /></label>
            <label>Phone<br /><input name="phone" /></label>
            <label>Category<br /><input name="category" /></label>
            <label>Address<br /><input name="address" /></label>
          </div>
          <p><button>Add to registry</button></p>
        </fieldset>
      </form>
    </>
  );
}
