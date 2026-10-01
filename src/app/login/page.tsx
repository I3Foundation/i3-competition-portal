import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';
import { signIn } from '@/lib/session';

export const dynamic = 'force-dynamic';

type Row = { id: string; full_name: string; email: string; role: string; team_name: string | null };

export default async function LoginPage() {
  // Read with no session: the profiles read policy is `using (true)`, so the
  // picker works while signed out. Nothing private is reachable here.
  const people = await withUser(null, async (c) =>
    (await c.query<Row>(
      `select p.id, p.full_name, p.email, p.role, t.name as team_name
         from profiles p
         left join team_members tm on tm.profile_id = p.id
         left join teams t on t.id = tm.team_id
        order by case p.role when 'admin' then 0 when 'mentor' then 1 else 2 end,
                 t.name nulls first, p.full_name`,
    )).rows,
  );

  async function pick(formData: FormData) {
    'use server';
    await signIn(String(formData.get('id')));
    redirect('/');
  }

  return (
    <>
      <h1>Sign in</h1>
      <p className="hint">
        Development sign-in — pick any account to see the portal as they see it.
        Real magic-link auth replaces this before launch; it is stubbed so you can
        review functionality without email round-trips.
      </p>
      <table>
        <thead><tr><th>Name</th><th>Role</th><th>Team</th><th /></tr></thead>
        <tbody>
          {people.map((p) => (
            <tr key={p.id}>
              <td>{p.full_name}<br /><span className="hint">{p.email}</span></td>
              <td>{p.role}</td>
              <td>{p.team_name ?? <span className="empty">—</span>}</td>
              <td>
                <form action={pick}>
                  <input type="hidden" name="id" value={p.id} />
                  <button>Sign in</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
