# I³ Competition Portal

Outreach CRM + mentor scheduling for the I³ Competition.
Scope in `docs/SCOPE.md`. Decisions: `docs/ADR-001-database.md` (Postgres over
MongoDB), `docs/ADR-002-mautic-review.md` (what we take from Mautic and what we
refuse).

## Run it

```bash
pnpm install
cp .env.local.example .env.local
pnpm db:up          # Postgres in Docker, schema + policies + demo data
pnpm dev            # http://localhost:3100
```

`pnpm db:reset` rebuilds the database from scratch. Requires Docker.

There is no password. `/login` lists every seeded account — pick one and you are
signed in as them. Two things worth trying: open the same page as two different
students (the outreach lists differ because the database filters them, not the
page), and try `/recruiting` as a student (you are redirected, and the underlying
rows are invisible to you even at the SQL level).

| Account | Role | Sees |
|---|---|---|
| Dana Whitfield | admin | everything, plus team coverage |
| Sam Okafor / Rita Chen / Marcus Diallo | mentor | own availability and bookings |
| Jordan Rivera, Amina Khalil, Tyler Brooks | student | Northside Devs |
| Priya Nair, Luis Ortega, Grace Lim | student | Lincoln Labs |
| Devon Hayes, Sofia Marin | student | Eastview Collective |

## The UI is deliberately unstyled

Grayscale, browser-default controls, no design system. It is meant to be
reviewed for behaviour, not appearance. Visual design comes after the flows are
agreed.

## What works now

**Recruiting** (`/recruiting`, admins only) — teachers at schools, replacing the
tracking spreadsheet. A follow-up queue of who to nudge (never contacted, or gone
quiet past N days), excluding addresses that genuinely cannot be reached. A
per-school rollup so you can see which schools are cold rather than just which
rows say "No". Contacted / replied / soft-bounce / can't-send actions inline.
Paste-import straight from Google Sheets, idempotent so re-pasting is safe.

**Suppression** — who may not be contacted, and why. A soft bounce is recorded
but keeps the contact in the queue; a hard bounce or opt-out removes them. History
is append-only, so nothing is lost on a later correction. See
`docs/ADR-002-mautic-review.md` for why this is a table rather than a column.

**Opt-out** (`/u/<token>`) — public, no sign-in. The GET only renders a
confirmation; a POST records it. An unsubscribe can never be lifted, enforced by
a database constraint.

**Contact timeline** (`/contacts/<id>`) — everything that happened to one
contact: suppression history with reasons and authors, plus an append-only event
log that not even an admin can rewrite.

**Partnering** — shared business registry; claim a business before contacting it,
one team at a time; release it back to the pool; add businesses with duplicate
detection; log contacts and replies; status tracking per thread.

**Scheduling** — mentors set recurring weekly hours, publish them as bookable
slots, block individual dates, and store their own meeting link; teams browse
mentors and book; either side can cancel, which reopens the slot.

**Admin** — per-team coverage (claims, threads, replies, sessions), outreach
status breakdown, roster, add teams, assign students.

**Email** (Phase 2a) — compose from an editable template, then pick how it goes
out:

- **From the portal** — sent as *Student Name (I³ Competition)* from our domain.
  Replies come back to a per-thread address and attach themselves automatically;
  bounces and spam complaints arrive by webhook and become suppressions, with
  transient failures recorded as non-blocking. One-click unsubscribe per
  RFC 8058. Daily send cap per team.
- **From your own email** — opens Gmail or the default mail app with everything
  prefilled, sent from the student's real address. Far better odds of reaching a
  school district inbox, but replies land in their inbox rather than the portal,
  so they get logged by hand. Needs no infrastructure at all.

Both are offered on every contact with the tradeoff spelled out, and both are
blocked for a suppressed contact — an opt-out means nobody emails them, not just
the portal.

Without `RESEND_API_KEY` the send path uses a **dev transport**: everything runs
and is recorded, but no mail leaves the machine. That is the default, so a fresh
checkout cannot email a real teacher by accident. See `docs/deploy/README.md`
to go live.

## Not built yet

AI reply triage (2b), confirmation and reminder emails for mentor bookings, real
magic-link auth, multi-step follow-up sequences. `docs/SCOPE.md` has the phasing.

## Tests

```bash
pnpm test:webhooks   # HTTP-level: signatures, replay, routing, opt-out

docker cp db/constraint-tests.sql i3-portal-db:/ && \
  docker exec -i i3-portal-db psql -U postgres -d i3 -f /constraint-tests.sql

docker cp db/rls-tests.sql i3-portal-db:/ && \
  docker exec -i -e PGPASSWORD=apppw i3-portal-db \
    psql -U i3_app -d i3 -h localhost -q -t -A -f /rls-tests.sql
```

The RLS tests **must** run as `i3_app`. As `postgres` they all pass
meaninglessly, because superusers bypass row-level security. Run them after
`pnpm db:reset` — one test has to commit, so it uses a dedicated
`ZZ Optout Fixture` contact and guards that no seeded teacher was touched.

## How authorization works

Every rule lives in `db/policies.sql` and is enforced by Postgres. Pages issue
unfiltered queries — `select * from outreach_threads` returns only the caller's
rows because of RLS, not because the page filtered them. `src/lib/db.ts` opens a
transaction per request and sets `app.user_id`, which every policy reads.

Two things will silently void this whole model:

- connecting as `postgres` instead of `i3_app` (superusers bypass RLS)
- setting `app.user_id` outside a transaction (it becomes a no-op)

## Moving to Supabase

The schema is plain Postgres and already Supabase-shaped. Three changes:

1. Drop `db/00-local-auth-shim.sql`; Supabase provides `auth.users`.
2. In `db/policies.sql`, change `app.current_user_id()` to `select auth.uid()`.
3. Replace `src/lib/session.ts` with Supabase magic-link auth. Nothing else
   imports it beyond `currentUser()`.
