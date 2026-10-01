import 'server-only';
import { appUrl } from './mail';

/**
 * Compose links: open the student's own mail client with everything prefilled,
 * so the email is sent from their real address rather than our domain.
 *
 * The tradeoff versus portal sending (src/lib/outreach.ts) is deliberate and
 * one-directional: this gets far better deliverability into school districts,
 * which filter young sending domains hard, but a mailto URL cannot set
 * Reply-To, so replies land in the student's inbox and the portal never sees
 * them. Neither method is better in general; they are better for different
 * recipients.
 *
 * Because there are no headers, the unsubscribe notice has to live in the body.
 */

/** The 2083-char IE limit is long gone, but OS handlers still truncate. */
const SAFE_URL_LENGTH = 1800;

function footerText(unsubscribeUrl: string): string {
  return [
    '',
    '',
    '---',
    'You received this because we are inviting schools and local businesses to',
    'take part in the I³ Competition, a program for high school students.',
    `To stop receiving these emails: ${unsubscribeUrl}`,
  ].join('\n');
}

export type ComposeLinks = {
  mailto: string;
  gmail: string;
  /** Full body including the footer, so the UI can show exactly what is sent. */
  body: string;
  /** True when a client may truncate the URL and the body should be copied instead. */
  tooLong: boolean;
};

export function composeLinks(opts: {
  to: string;
  subject: string;
  body: string;
  unsubscribeToken: string;
}): ComposeLinks {
  // Human-facing confirmation page, not the one-click POST endpoint: a person
  // reading this in their inbox should land on something they can read.
  const unsubscribeUrl = `${appUrl()}/u/${opts.unsubscribeToken}`;
  const body = opts.body + footerText(unsubscribeUrl);

  const e = encodeURIComponent;
  const mailto = `mailto:${e(opts.to)}?subject=${e(opts.subject)}&body=${e(body)}`;
  const gmail = 'https://mail.google.com/mail/?view=cm&fs=1'
    + `&to=${e(opts.to)}&su=${e(opts.subject)}&body=${e(body)}`;

  return {
    mailto, gmail, body,
    tooLong: mailto.length > SAFE_URL_LENGTH || gmail.length > SAFE_URL_LENGTH,
  };
}
