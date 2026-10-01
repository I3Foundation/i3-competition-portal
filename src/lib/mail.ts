import 'server-only';

/**
 * Outbound mail. One interface, two transports:
 *
 *   RESEND_API_KEY set  -> real sends through Resend
 *   otherwise           -> 'dev' transport: records the message, sends nothing
 *
 * The dev transport is not a stub to be replaced later. It is what makes the
 * whole send path -- suppression gate, caps, headers, threading, inbound
 * routing -- testable without DNS, a verified domain, or an API key, and it is
 * the default so a fresh checkout cannot email a real teacher by accident.
 */

export type Outbound = {
  to: string;
  subject: string;
  text: string;
  /** Display name shown to the recipient, e.g. "Jordan Rivera (I³ Competition)". */
  fromName: string;
  /** Per-thread address replies come back to: r+<token>@<domain>. */
  replyTo: string;
  /** One-click opt-out target for the List-Unsubscribe header. */
  unsubscribeUrl: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string; transport: 'resend' | 'dev' }
  | { ok: false; error: string; transport: 'resend' | 'dev' };

export function mailDomain(): string {
  // A subdomain by default: the apex already has forwarding MX records and
  // taking those over would break existing email.
  return process.env.MAIL_FROM_DOMAIN ?? 'mail.i3competition.com';
}

export function appUrl(): string {
  return (process.env.APP_URL ?? 'http://localhost:3100').replace(/\/$/, '');
}

export function transportName(): 'resend' | 'dev' {
  return process.env.RESEND_API_KEY ? 'resend' : 'dev';
}

/** Address replies to this thread must come back to, so we can route them. */
export function replyToFor(replyToken: string): string {
  return `r+${replyToken}@${mailDomain()}`;
}

/**
 * RFC 8058 one-click target. Deliberately the API route, not the confirmation
 * page: mail clients POST here, and only a POST unsubscribes anyone.
 */
export function unsubscribeUrlFor(token: string): string {
  return `${appUrl()}/api/u/${token}`;
}

function footer(unsubscribeUrl: string): string {
  return [
    '',
    '',
    '---',
    'You received this because we are inviting schools and local businesses to',
    'take part in the I³ Competition, a program for high school students.',
    `To stop receiving these emails: ${unsubscribeUrl.replace('/api/u/', '/u/')}`,
  ].join('\n');
}

export async function sendMail(msg: Outbound): Promise<SendResult> {
  const from = `${msg.fromName} <outreach@${mailDomain()}>`;
  const text = msg.text + footer(msg.unsubscribeUrl);

  // RFC 8058: both headers must be present for one-click to be offered, and
  // the URL must accept POST. Without List-Unsubscribe-Post, Gmail shows a
  // mailto-style flow instead and some providers show nothing.
  const headers: Record<string, string> = {
    'List-Unsubscribe': `<${msg.unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };

  if (!process.env.RESEND_API_KEY) {
    // Dev transport. A stable synthetic id keeps provider_message_id unique so
    // the inbound dedupe path behaves exactly as it will in production.
    const id = `dev-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
    console.log(
      `[mail:dev] would send to=${msg.to} subject="${msg.subject}" `
      + `reply-to=${msg.replyTo} unsubscribe=${msg.unsubscribeUrl}`,
    );
    return { ok: true, providerMessageId: id, transport: 'dev' };
  }

  try {
    // Overridable so the send path can be pointed at a mock in tests, or at a
    // staging relay, without touching this code.
    const base = process.env.RESEND_BASE_URL ?? 'https://api.resend.com';
    const res = await fetch(`${base}/emails`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from,
        to: [msg.to],
        subject: msg.subject,
        text,
        reply_to: msg.replyTo,
        headers,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `resend ${res.status}: ${body.slice(0, 300)}`, transport: 'resend' };
    }
    const json = (await res.json()) as { id?: string };
    return { ok: true, providerMessageId: json.id ?? `resend-${Date.now()}`, transport: 'resend' };
  } catch (e) {
    return { ok: false, error: `resend request failed: ${String(e).slice(0, 300)}`, transport: 'resend' };
  }
}

/**
 * Best greeting for a name that real lists actually contain.
 *
 * Naively taking the first whitespace token produces "Hi Mr.," for "Mr. H" and
 * "Hi L.," for "L. Whitfield" -- both of which would go out to a teacher. So
 * the whole name is kept whenever the first token is a title or an initial, and
 * only a genuine given name is shortened.
 */
export function greetingName(full?: string | null): string {
  const name = (full ?? '').trim();
  if (!name) return 'there';

  const first = name.split(/\s+/)[0];
  const isTitle = /^(mr|mrs|ms|mx|dr|prof|professor|coach|rev|sr|sra)\.?$/i.test(first);
  const isInitial = /^[A-Za-z]\.?$/.test(first);

  return isTitle || isInitial ? name : first;
}

/** Fills {{first_name}}, {{org_name}}, {{sender_name}} in a template. */
export function renderTemplate(
  body: string,
  vars: { first_name?: string | null; org_name?: string | null; sender_name?: string | null },
): string {
  return body
    .replace(/\{\{\s*first_name\s*\}\}/g, greetingName(vars.first_name))
    .replace(/\{\{\s*org_name\s*\}\}/g, vars.org_name ?? 'your organisation')
    .replace(/\{\{\s*sender_name\s*\}\}/g, vars.sender_name ?? 'the I³ team');
}
