import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { withUser } from './db';

const COOKIE = 'i3_session';

/**
 * DEV AUTH. Deliberately simple: a signed cookie holding a profile id, plus a
 * user picker at /login. There is no password and no email round-trip, because
 * the point of this build is fast feedback on functionality.
 *
 * Phase 0 proper replaces this with Supabase magic-link auth. The only thing
 * the rest of the app depends on is `currentUser()`, so that swap is contained
 * to this file plus app.current_user_id() in db/policies.sql.
 */
function sign(value: string): string {
  const secret = process.env.SESSION_SECRET ?? 'dev-secret-change-me';
  return createHmac('sha256', secret).update(value).digest('hex');
}

function verify(raw: string | undefined): string | null {
  if (!raw) return null;
  const [id, sig] = raw.split('.');
  if (!id || !sig) return null;
  const expected = sign(id);
  // Length check first: timingSafeEqual throws on mismatched buffer lengths.
  if (sig.length !== expected.length) return null;
  if (!timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  return id;
}

export async function sessionUserId(): Promise<string | null> {
  return verify((await cookies()).get(COOKIE)?.value);
}

export async function signIn(profileId: string) {
  (await cookies()).set(COOKIE, `${profileId}.${sign(profileId)}`, {
    httpOnly: true, sameSite: 'lax', path: '/',
  });
}

export async function signOut() {
  (await cookies()).delete(COOKIE);
}

export type CurrentUser = {
  id: string; email: string; full_name: string;
  role: 'student' | 'mentor' | 'admin';
  team_id: string | null; team_name: string | null;
};

export async function currentUser(): Promise<CurrentUser | null> {
  const id = await sessionUserId();
  if (!id) return null;
  return withUser(id, async (c) => {
    const { rows } = await c.query<CurrentUser>(
      `select p.id, p.email, p.full_name, p.role,
              tm.team_id, t.name as team_name
         from profiles p
         left join team_members tm on tm.profile_id = p.id
         left join teams t on t.id = tm.team_id
         left join seasons s on s.id = tm.season_id and s.is_active
        where p.id = $1`,
      [id],
    );
    return rows[0] ?? null;
  });
}

/** Current user or throw. For pages that are already behind a sign-in check. */
export async function requireUser(): Promise<CurrentUser> {
  const u = await currentUser();
  if (!u) throw new Error('not signed in');
  return u;
}
