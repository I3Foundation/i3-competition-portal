import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Webhook authentication.
 *
 * Both verifiers fail CLOSED: if the secret is not configured, the request is
 * rejected. An unauthenticated webhook endpoint that writes suppressions is a
 * way for anyone on the internet to unsubscribe your whole list, so "allow when
 * unconfigured" is not an acceptable default even in development.
 */

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Svix signature scheme, which Resend uses.
 *
 * Signed content is `{svix-id}.{svix-timestamp}.{raw body}`, HMAC-SHA256 with
 * the base64 secret that follows the `whsec_` prefix. The signature header may
 * carry several space-separated versioned values (`v1,<sig> v1,<sig>`) during
 * secret rotation, so any match is accepted.
 */
export function verifySvix(
  rawBody: string,
  headers: Headers,
  secretEnv = process.env.RESEND_WEBHOOK_SECRET,
): { ok: true } | { ok: false; why: string } {
  if (!secretEnv) return { ok: false, why: 'RESEND_WEBHOOK_SECRET not configured' };

  const id = headers.get('svix-id');
  const ts = headers.get('svix-timestamp');
  const sig = headers.get('svix-signature');
  if (!id || !ts || !sig) return { ok: false, why: 'missing svix headers' };

  // Replay window. Without this a captured payload is valid forever.
  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return { ok: false, why: 'timestamp outside 5m window' };

  const secret = Buffer.from(secretEnv.replace(/^whsec_/, ''), 'base64');
  const expected = createHmac('sha256', secret)
    .update(`${id}.${ts}.${rawBody}`)
    .digest('base64');

  const offered = sig.split(' ').map((p) => p.split(',').slice(1).join(','));
  return offered.some((o) => safeEqual(o, expected))
    ? { ok: true }
    : { ok: false, why: 'signature mismatch' };
}

/**
 * Inbound mail relay. This contract is ours on both ends -- a Cloudflare Email
 * Routing Worker (free; see docs/SCOPE.md) forwards the parsed message here --
 * so it is a plain HMAC over the raw body with a timestamp, not Svix.
 */
export function verifyInbound(
  rawBody: string,
  headers: Headers,
  secretEnv = process.env.INBOUND_WEBHOOK_SECRET,
): { ok: true } | { ok: false; why: string } {
  if (!secretEnv) return { ok: false, why: 'INBOUND_WEBHOOK_SECRET not configured' };

  const ts = headers.get('x-i3-timestamp');
  const sig = headers.get('x-i3-signature');
  if (!ts || !sig) return { ok: false, why: 'missing x-i3-timestamp / x-i3-signature' };

  const age = Math.abs(Date.now() / 1000 - Number(ts));
  if (!Number.isFinite(age) || age > 300) return { ok: false, why: 'timestamp outside 5m window' };

  const expected = createHmac('sha256', secretEnv)
    .update(`${ts}.${rawBody}`)
    .digest('hex');

  return safeEqual(sig, expected) ? { ok: true } : { ok: false, why: 'signature mismatch' };
}

/** Pulls the thread token out of `r+<token>@domain`, from any of the to fields. */
export function threadTokenFrom(...addresses: (string | null | undefined)[]): string | null {
  for (const a of addresses) {
    if (!a) continue;
    const m = /r\+([0-9a-f]{8,64})@/i.exec(a);
    if (m) return m[1].toLowerCase();
  }
  return null;
}

/**
 * Maps a provider bounce to our suppression vocabulary.
 *
 * This mapping is the single most consequential line of Phase 2a. Treating a
 * transient failure as permanent is Mautic's open bug #9190 and silently
 * deletes a reachable teacher from recruiting forever, so anything not provably
 * permanent becomes a non-blocking soft bounce.
 *
 * 'Undetermined' deliberately maps to soft: when the provider cannot tell, the
 * safe error is to keep trying, not to suppress.
 */
export function mapBounce(
  eventType: string,
  bounceType?: string | null,
): { reason: 'hard_bounce' | 'soft_bounce' | 'unsubscribed'; blocks: boolean } | null {
  if (eventType === 'email.complained') {
    // A spam complaint is an opt-out. Honouring it is not optional.
    return { reason: 'unsubscribed', blocks: true };
  }
  if (eventType === 'email.delivery_delayed') {
    return { reason: 'soft_bounce', blocks: false };
  }
  if (eventType !== 'email.bounced') return null;

  return /^perm/i.test(bounceType ?? '')
    ? { reason: 'hard_bounce', blocks: true }
    : { reason: 'soft_bounce', blocks: false };
}
