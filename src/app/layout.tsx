import './globals.css';
import Link from 'next/link';
import { currentUser, signOut } from '@/lib/session';
import { redirect } from 'next/navigation';

export const metadata = { title: 'I³ Portal' };
export const dynamic = 'force-dynamic';

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await currentUser();

  async function doSignOut() {
    'use server';
    await signOut();
    redirect('/login');
  }

  return (
    <html lang="en">
      <body>
        <header>
          <strong>I³ Portal</strong>
          {user && (
            <nav>
              <Link href="/">Home</Link>
              {user.role === 'student' && <>
                <Link href="/businesses">Businesses</Link>
                <Link href="/outreach">Outreach</Link>
                <Link href="/mentors">Book a mentor</Link>
                <Link href="/bookings">Our bookings</Link>
              </>}
              {user.role === 'mentor' && <>
                <Link href="/availability">My availability</Link>
                <Link href="/bookings">My bookings</Link>
              </>}
              {user.role === 'admin' && <>
                <Link href="/admin">Admin</Link>
                <Link href="/recruiting">Recruiting</Link>
                <Link href="/businesses">Businesses</Link>
                <Link href="/mentors">Mentors</Link>
              </>}
            </nav>
          )}
          <span className="who">
            {user
              ? <>
                  {user.full_name} · {user.role}
                  {user.team_name ? ` · ${user.team_name}` : ''}
                  {' · '}
                  <form className="inline" action={doSignOut}><button>switch user</button></form>
                </>
              : <Link href="/login">Sign in</Link>}
          </span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
