import { NextResponse } from 'next/server';
import { withUser } from '@/lib/db';

/**
 * RFC 8058 one-click unsubscribe. This is the URL in the List-Unsubscribe
 * header; mail clients POST here when someone clicks "Unsubscribe" in Gmail or
 * Outlook's own UI.
 *
 * POST-only by design. Scanners and link prefetchers issue GETs, so keeping the
 * mutation on POST is what stops a scanner sweep from emptying the list.
 */
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  // No session: app.unsubscribe_by_token is security definer and token-scoped.
  await withUser(null, (c) =>
    c.query('select app.unsubscribe_by_token($1,$2)', [token, 'one-click (RFC 8058)']));

  // Always 200. Telling a mail client that a token was unknown achieves
  // nothing and leaks whether it exists.
  return new NextResponse(null, { status: 200 });
}

/** A GET is a human (or a scanner). Send humans to the confirmation page. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;
  return NextResponse.redirect(
    new URL(`/u/${token}`, process.env.APP_URL ?? 'http://localhost:3100'), 303);
}
