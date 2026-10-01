import { redirect } from 'next/navigation';
import { withUser } from '@/lib/db';

export const dynamic = 'force-dynamic';

/**
 * Public opt-out. No session, not in the nav, reachable only with a token.
 *
 * The GET deliberately does NOT unsubscribe anyone. Corporate mail gateways,
 * spam scanners and link prefetchers follow every URL in an email; a
 * GET-triggered opt-out would quietly unsubscribe the entire list the first time
 * a scanner swept an inbox. So the GET renders a confirmation and only the POST
 * below writes anything.
 *
 * Authorization is the token itself, verified inside
 * app.unsubscribe_by_token() — a security definer function that can write one
 * suppression row for that contact and nothing else. The page never reads
 * contact data, so a leaked token discloses no personal information.
 */
export default async function Unsubscribe({
  params, searchParams,
}: {
  params: Promise<{ token: string }>;
  searchParams: Promise<{ done?: string; bad?: string }>;
}) {
  const { token } = await params;
  const { done, bad } = await searchParams;

  async function optOut(formData: FormData) {
    'use server';
    const t = String(formData.get('token') ?? '');
    const reason = String(formData.get('reason') ?? '').trim() || null;
    // Runs with no user: the function is security definer and token-scoped.
    const ok = await withUser(null, async (c) =>
      (await c.query<{ ok: boolean }>(
        'select app.unsubscribe_by_token($1,$2) as ok', [t, reason])).rows[0].ok);
    redirect(`/u/${encodeURIComponent(t)}?${ok ? 'done=1' : 'bad=1'}`);
  }

  if (done) {
    return (
      <>
        <h1>You&apos;re unsubscribed</h1>
        <p>
          We won&apos;t email you about the I³ Competition again. Nothing further
          is needed from you.
        </p>
        <p className="hint">
          This was recorded permanently — it can&apos;t be undone by us, only by
          you contacting us directly.
        </p>
      </>
    );
  }

  if (bad) {
    return (
      <>
        <h1>That link didn&apos;t work</h1>
        <p>
          We couldn&apos;t match this unsubscribe link. It may have been broken by
          your email client splitting it across lines.
        </p>
        <p className="hint">
          Reply to the email you received and ask to be removed — we&apos;ll do it
          manually.
        </p>
      </>
    );
  }

  return (
    <>
      <h1>Unsubscribe</h1>
      <p>
        Confirm below and the I³ Competition will stop emailing this address.
      </p>
      <form action={optOut}>
        <input type="hidden" name="token" value={token} />
        <p>
          <label>
            Anything you&apos;d like us to know? (optional)<br />
            <input name="reason" size={48} />
          </label>
        </p>
        <p><button>Unsubscribe me</button></p>
      </form>
      <p className="hint">
        We only email teachers and local business owners about taking part in a
        high school student competition. We never sell or share addresses.
      </p>
    </>
  );
}
