/**
 * Cloudflare Email Routing Worker -- inbound mail relay for the I³ Portal.
 *
 * Cloudflare Email Routing is free and gives us MX control on a SUBDOMAIN
 * (mail.i3competition.com), leaving the apex's existing forwarding untouched.
 *
 * Deploy:
 *   1. Add mail.i3competition.com to Cloudflare and enable Email Routing on it.
 *   2. Route "catch-all" to this Worker.
 *   3. wrangler secret put INBOUND_WEBHOOK_SECRET   (same value as the portal)
 *   4. wrangler secret put PORTAL_URL               (https://portal.example)
 *
 * The portal verifies an HMAC over `{timestamp}.{body}` and rejects anything
 * older than five minutes, so this secret must match and the clock must be
 * roughly right.
 */

export default {
  async email(message, env, ctx) {
    const raw = await new Response(message.raw).text();

    // Minimal parse. The portal only needs the recipient (to find the thread
    // token), the sender, the subject and the text body.
    const headerBlock = raw.split(/\r?\n\r?\n/)[0] ?? '';
    const header = (name) => {
      const m = new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(headerBlock);
      return m ? m[1].trim() : null;
    };

    const body = JSON.stringify({
      to: message.to,                       // r+<token>@mail.i3competition.com
      envelopeTo: header('To'),
      from: message.from,
      subject: header('Subject'),
      // Strip quoted history so the portal shows the actual reply, not the
      // whole thread pasted back at us.
      text: stripQuoted(raw.split(/\r?\n\r?\n/).slice(1).join('\n\n')),
      messageId: header('Message-ID') ?? `cf-${Date.now()}`,
    });

    const ts = Math.floor(Date.now() / 1000).toString();
    const sig = await hmacHex(env.INBOUND_WEBHOOK_SECRET, `${ts}.${body}`);

    const res = await fetch(`${env.PORTAL_URL}/api/inbound`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-i3-timestamp': ts,
        'x-i3-signature': sig,
      },
      body,
    });

    // Non-2xx means the portal could not record it. Reject so the sending MTA
    // retries rather than the reply being lost silently.
    if (!res.ok) {
      message.setReject(`portal returned ${res.status}`);
    }
  },
};

function stripQuoted(text) {
  const lines = (text || '').split(/\r?\n/);
  const cut = lines.findIndex((l) =>
    /^>/.test(l) || /^On .+ wrote:$/.test(l.trim()) || /^-{2,}\s*Original Message/i.test(l));
  return (cut > 0 ? lines.slice(0, cut) : lines).join('\n').trim().slice(0, 20000);
}

async function hmacHex(secret, data) {
  const key = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
