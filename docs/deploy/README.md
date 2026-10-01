# Deploying Phase 2a email

**None of this is needed for the compose-link path** ("send from your own
email"), which works with no infrastructure whatsoever. Set it up only when you
want automatic reply capture and bounce handling.

Nothing here is needed to run or review the portal. Without `RESEND_API_KEY` the
send path uses the dev transport: it runs end to end and records everything, but
no mail leaves the machine. That is the default so a fresh checkout cannot email
a real teacher by accident.

## 1. Sending domain

Use a **subdomain** — `mail.i3competition.com`. The apex already has forwarding
MX records and taking those over would break existing email.

On the subdomain, publish:

- **SPF**: `v=spf1 include:amazonses.com ~all` (whatever Resend gives you)
- **DKIM**: the CNAME records from the Resend dashboard
- **DMARC**: start at `v=DMARC1; p=none; rua=mailto:dmarc@i3competition.com`,
  then tighten to `p=quarantine` once reports look clean

**Warm up.** A brand-new subdomain sending 200 cold emails on day one gets
filtered. Start at a handful a day and raise `SEND_CAP_PER_DAY` over two weeks.

## 2. Resend

```
RESEND_API_KEY=re_...
RESEND_WEBHOOK_SECRET=whsec_...
MAIL_FROM_DOMAIN=mail.i3competition.com
APP_URL=https://your-portal-url
```

Point a Resend webhook at `POST /api/webhooks/resend` and subscribe to
`email.bounced`, `email.complained` and `email.delivery_delayed`. Signature
verification is Svix, and it **fails closed** — without the secret every event
is rejected with 401.

## 3. Inbound replies

`docs/deploy/inbound-worker.js` is a Cloudflare Email Routing Worker. Email
Routing is free and only needs MX on the subdomain.

1. Add `mail.i3competition.com` to Cloudflare, enable Email Routing.
2. Route catch-all to the Worker.
3. `wrangler secret put INBOUND_WEBHOOK_SECRET` — must match the portal's.
4. `wrangler secret put PORTAL_URL`.

Replies arrive at `r+<thread_token>@mail.i3competition.com`; the portal routes on
that token, not on the From address, because people reply from a different
address more often than you would expect.

If the domain is not on Cloudflare, Postmark inbound works the same way — POST
the parsed message to `/api/inbound` with the HMAC headers.

## 4. The one thing that will bite you

The bounce mapping in `src/lib/webhook.ts`. Only a **provably permanent** failure
may block sending; everything else — transient, undetermined, delayed — must be a
non-blocking `soft_bounce`.

Mapping a transient failure to `hard_bounce` silently deletes a reachable teacher
from recruiting forever. That is Mautic's open
[#9190](https://github.com/mautic/mautic/issues/9190) and the reason the schema
was rebuilt (`docs/ADR-002-mautic-review.md`). The database constraint cannot
save you here, because the webhook is *telling* it the bounce was hard.

If you switch providers, re-read `mapBounce()` against the new provider's bounce
taxonomy before sending anything.

## 5. Verify a real deployment

```bash
pnpm test:webhooks            # against a local dev server
```

Then, against production, send one real email to an address you control, reply to
it, and confirm the reply appears on the thread. Check the message source for
`List-Unsubscribe` and `List-Unsubscribe-Post`, and click Gmail's own
Unsubscribe link — it should opt you out in one click and the contact should
leave the follow-up queue.
