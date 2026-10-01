# I³ Competition Portal — Scope

Single-tenant web app for the I³ Competition (9–12th graders paired with
underrepresented small-business owners; 14–16 week season; mentor-coached).

Three jobs in one portal:

1. **Recruiting** — organisers contact *teachers at schools* to bring teams in.
2. **Partnering** — student teams contact *owners at businesses* to pair up.
3. **Mentor office hours** — mentors publish availability, teams book slots.

Recruiting and partnering are the same shape — a contact at an organisation, a
thread, a status — so they share `organizations` + `contacts` with a `kind`.
They differ in who runs them: recruiting is organiser work off one shared list,
partnering is team work with exclusive claims.

---

## Decisions locked

| Question | Decision | Why |
|---|---|---|
| Outreach email transport | **Portal sends it** | Replies are only observable if we own the Reply-To. Also gives us deliverability control and per-team send throttling. |
| Google Workspace | **None** — domain + forwarding only | Everything self-contained; no Google dependency. |
| Meeting links | **Mentor-supplied link per mentor** | No Workspace ⇒ no clean programmatic Meet. Avoids building a Zoom pool allocator until a real need is confirmed. Field is pluggable. |
| Build order | **Both tracks, thin slices** | Whole season runs on the portal in v1; neither track goes deep. |
| Recruiting owner | **Organiser team (admins)** | One shared list, no per-team claims. Students cannot see it at all. |
| Recruiting statuses | **Replied yes/no + bad-address flag** | Matches the spreadsheet it replaces, plus the one state the sheet lacked. |

## Stack

- **Next.js (App Router) on Vercel** — one deploy, API routes cover the webhooks.
- **Supabase** — Postgres + magic-link auth + RLS. Free tier covers this scale.
- **Resend** — outbound transactional + outreach email.
- **Cloudflare Email Routing → Worker → webhook** — inbound replies. Free.
  Fallback if the domain isn't on Cloudflare: Postmark inbound.
- **Claude Haiku 4.5** — inbound reply triage.

Running cost at this scale: roughly $0–25/mo. The AI triage is cents per season —
a few hundred replies at a few hundred tokens each. **Cost should not shape this
decision**; whether we can see the replies at all is the actual constraint.

---

## The three things that matter most

### 0. Suppression is a table, and soft bounces do not suppress

The spreadsheet recorded "Unable to send" in free-text Notes, which nothing could
act on. The first fix was a `contacts.email_status` column — which turned out to
reproduce an open bug in Mautic ([#9190](https://github.com/mautic/mautic/issues/9190)):
a single mutable column cannot distinguish a dead address from a full mailbox, so
one temporary failure removed a teacher from recruiting permanently and silently.

Suppression is now its own append-only table (`suppressions`), following
Mautic's `lead_donotcontact`:

- **History.** Reason, channel, timestamp and author are kept. Nothing is
  overwritten, so an unsubscribe is not lost when an address is later corrected.
- **Per-channel.** An address can be dead while the phone still works.
- **Hard vs soft.** `soft_bounce` rows have `blocks = false` and the contact
  stays in the follow-up queue. The `blocks_matches_reason` check constraint
  makes the bug *unrepresentable*, not merely avoided.
- **Unsubscribes are final.** `unsubscribe_is_final` forbids lifting one. Nobody
  can un-unsubscribe a teacher through the UI or a stray `UPDATE`.

`app.is_suppressed(contact, channel)` is the single source of truth, used by the
follow-up queue, the school rollup, the admin dashboard, and (in Phase 2a) the
send path.

### 0b. Opt-out is a legal requirement, not a feature

Cold email to teachers and business owners needs a working opt-out under
CAN-SPAM. Every contact carries an unguessable `unsubscribe_token`; `/u/<token>`
is public and sessionless.

Two details that are easy to get wrong and are deliberate here:

- **The GET does not unsubscribe.** Corporate mail gateways and spam scanners
  follow every URL in an email; a GET-triggered opt-out would empty the list the
  first time a scanner swept an inbox. The GET renders a confirmation; only a
  POST writes.
- **The page cannot read contact data.** It has no session, so RLS hides
  `contacts` entirely. Authorization is the token, consumed inside a
  `security definer` function that writes one suppression row and can do nothing
  else. A leaked token discloses no personal information.

### 1. Dedupe is the headline feature

With a dozen teams cold-emailing local businesses, two teams *will* hit the same
bakery. That's embarrassing and it burns the lead. The shared business registry
with exclusive claims is the highest-value thing here — higher than anything in
scheduling. It is the thing a spreadsheet handles worst.

Exclusivity is enforced by a **partial unique index in Postgres**, not by
application code, so two simultaneous claims cannot both win.

Claims carry an `expires_at`. A team that claims 30 businesses and contacts none
of them is hoarding leads; expiry releases them back to the pool automatically.

### 1b. Two ways to send, because they fail differently

Portal sending and compose links are both offered on every contact, chosen per
recipient rather than globally.

| | Portal send | Compose link |
|---|---|---|
| From | our domain, student's name as display name | the student's real address |
| Deliverability into school districts | weaker (young domain, cold mail) | much better |
| Replies captured automatically | **yes** | no — they go to the student's inbox |
| Bounces feed suppression | yes | no |
| `List-Unsubscribe` one-click | yes | no (footer link only) |
| Confirmed sent | yes | student asserts it |
| Infrastructure | DNS, SPF/DKIM/DMARC, Resend, warm-up | none |

Neither is better in general. District mail filters are strict enough that a
three-week-old subdomain may not reach the inbox at all, and perfect tracking of
mail that landed in spam is worth less than loose tracking of mail that arrived.
Equally, compose links walk straight back into the problem this project exists to
solve — manually asking students whether anyone replied.

So both ship, each labelled with what it costs, and the season's own numbers can
settle it. Messages sent this way carry `delivery = 'external'`: we hold the body
the student composed, but delivery is genuinely unknown to us, and recording it
as `delivered` would be a lie.

**The opt-out applies to both.** `recordExternalSend()` checks
`app.is_suppressed()` exactly as the portal send path does, and the compose links
are withheld entirely for a suppressed contact. Enforcing an unsubscribe only on
our own sends would make the unsubscribe button decorative.

### 2. Reply-To tokens are the whole outreach mechanic

Outbound mail goes out as:

```
From:     Jordan Rivera (I³ Competition) <outreach@mail.i3competition.com>
Reply-To: r+<thread_token>@mail.i3competition.com
```

The student's name is the display name, so it still reads as a person. The reply
lands on our MX, the webhook parses `<thread_token>`, and we attach the message
to the thread, flip status to `replied`, classify it, and forward a copy to the
student so they aren't cut out of their own conversation.

**Use a subdomain (`mail.i3competition.com`) for sending and receiving.** The
apex domain already has forwarding MX records; taking those over would break
existing email. The subdomain gets its own MX/SPF/DKIM/DMARC and touches nothing.

### 3. Deliverability is a real risk, not a footnote

Teenagers bulk-sending cold email to stale addresses will tank a sending domain's
reputation fast, and you won't find out until response rates are mysteriously
zero. Mitigations, all in scope for Phase 2a:

- Validate every registry address (syntax + MX lookup) before it's sendable.
- Per-team daily send cap.
- Hard-bounce handling: mark the business address dead, don't retry.
- Warm the subdomain up gradually rather than blasting on day one.
- DMARC on the sending subdomain from the start.

---

## Privacy model

Students see **which** businesses are claimed and by which team — that's what
makes dedupe work. They do **not** see other teams' message contents or notes.

| Table | Student (own team) | Student (other teams) | Mentor | Admin |
|---|---|---|---|---|
| `businesses` | read | read | read | all |
| `claims` | write own | read (team name only) | read | all |
| `outreach_threads` / `messages` | read/write own | none | none | all |
| `slots` | read | read | write own | all |
| `bookings` | write own | none | read own slots | all |

Enforced with Supabase RLS, not client-side filtering.

---

## Phases

Each phase ships something usable and has a concrete pass/fail check.

**Phase 0 — Foundation** (~1 day)
Next.js + Supabase, magic-link auth, seasons/profiles/teams/roles, admin roster CRUD.
→ *verify:* admin creates a season, adds a team, invites a student; student logs in
and sees only their own team.

**Phase 1a — Outreach, manual** (~2 days) — *done*
Business registry, claim/release, manual status updates, team + admin coverage
views. Recruiting tracker with follow-up queue, school rollup, and spreadsheet
import.
→ *verify:* two concurrent claims on one business — exactly one succeeds. Admin
dashboard shows businesses-per-team and unclaimed count.

**Phase 1b — Scheduling, manual links** (~2 days)
Mentor weekly availability + one-off exceptions, rolling slot generation, team books
a slot, confirmation email both sides, 24h reminder.
→ *verify:* two teams booking one slot — exactly one succeeds. Confirmation and
reminder both land in a real inbox.

**Phase 2a — Portal-sent outreach** — *done*
Template compose, send via Resend with per-thread Reply-To, inbound webhook, thread
view, auto status transition, copy forwarded to student, bounce handling, send caps.

Required when this lands:
- Every send calls `app.is_suppressed(contact,'email')` first. No exceptions.
- Outbound headers carry `List-Unsubscribe: <https://…/u/TOKEN>` and
  `List-Unsubscribe-Post: List-Unsubscribe=One-Click`, plus a visible footer link.
- The bounce webhook must map the provider's soft/transient codes to
  `soft_bounce` and only permanent failures to `hard_bounce`. Getting this
  mapping wrong re-introduces the bug the schema was redesigned to prevent.
→ *verify:* send to a live test address, reply from it, see the reply appear in the
thread and the status flip without anyone touching a button.

**Phase 2b — AI triage** (~half day)
Haiku labels inbound: `interested` / `declined` / `question` / `auto_reply` /
`out_of_office` / `bounce`.
→ *verify:* labels agree with human judgment on a sample of real replies.

**Phase 3 — only if needed**
Zoom account pool allocator (only on confirmed need), stale-claim nudges, season
analytics, mentor load balancing.

Roughly two weeks of focused work to end of Phase 2b.

---

## Borrowed from Mautic, and rejected from Mautic

Reviewed `mautic/mautic` (~40k commits, PHP/Symfony) as the mature reference.
It is a *mass-marketing* platform; this is high-touch outreach to a few hundred
named people, so most of its surface would make this worse. See
`docs/ADR-002-mautic-review.md`.

**Borrowed:** suppression as a first-class table with channel and reason; the
per-contact activity timeline; opt-out as a core concern.

**Rejected:** open/click tracking (pixels hurt deliverability, and a nonprofit
silently tracking whether teachers opened an email is a reputational risk —
replies are the real signal); materialized segment membership rebuilt by cron,
which creates Mautic's *segments → campaign membership → actions* ordering
footgun and staleness bugs ([#13088](https://github.com/mautic/mautic/issues/13088))
— our queue is computed on read and cannot go stale; visual campaign builder;
lead scoring; plugin architecture; EAV custom fields.

**Deferred, not rejected:** multi-step follow-up sequences, saved segments.

## Explicitly out of scope for v1

- Judging / final presentation scoring
- Student-facing curriculum or resource library
- Public-facing marketing pages (stays on the existing site)
- Multi-tenant / other competitions
- Mobile apps
