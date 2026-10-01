# ADR-002: What we take from Mautic, and what we refuse

**Status:** accepted · **Date:** 2026-10-01

## Context

[Mautic](https://github.com/mautic/mautic) is the largest open-source marketing
automation project — roughly 40,000 commits of PHP/Symfony, ~10.7k stars. Before
building more of our own outreach CRM we reviewed it to find what it had already
solved, on the assumption that a decade of production use encodes lessons we
would otherwise learn the hard way.

It does. It also turned out to be a different product category.

## The categorical difference

Mautic is built for **mass marketing**: anonymous visitor tracking, landing
pages, form builders, lead scoring, a visual campaign builder, bulk sends to
large lists. Its primitives assume a marketer optimising conversion across
thousands of contacts.

This portal is built for **high-touch relationship outreach**: a few hundred
named teachers and local business owners, semi-personal emails, a human deciding
who deserves a nudge this week. The scarce resource is not list size, it is the
organiser's attention.

Adopting Mautic's surface would therefore make this product worse, not better.
Most of what follows is a refusal.

## What we took

### 1. Suppression as a first-class table

Mautic stores suppression in `lead_donotcontact` — `lead_id`, `channel`,
`channel_id`, `reason` (UNSUBSCRIBED / BOUNCED), `date_added`, `comments`.

We had `contacts.email_status`, a single mutable enum. Reviewing Mautic showed
three things that column could not do, and we adopted the table shape for all
three: **history** (a column overwrite destroys when, why and by whom), **per
channel** (an address can be dead while the phone works), and **hard vs soft**.

### 2. The soft-bounce lesson, learned from their open bug

Mautic issue [#9190](https://github.com/mautic/mautic/issues/9190) — "soft bounce
goes to lead_donotcontact" — is the most valuable thing this review produced,
because we had independently shipped it. A full mailbox is not a dead address,
but `email_status='bounced'` was terminal and the follow-up queue filtered it
out, so one temporary failure deleted a teacher from recruiting silently and
forever.

Our `suppressions.blocks` column is tied to `reason` by a check constraint:

```sql
constraint blocks_matches_reason check (
  (reason = 'soft_bounce'                   and not blocks) or
  (reason in ('unsubscribed','hard_bounce') and blocks)     or
  (reason in ('invalid_address','manual'))
)
```

The distinction Mautic enforces in application code — imperfectly, hence the bug
— we enforce in the database, so a blocking soft bounce cannot be inserted at
all. `db/rls-tests.sql` carries a permanent regression test.

### 3. Unsubscribes are irreversible

`unsubscribe_is_final` forbids setting `lifted_at` on an `unsubscribed` row. An
opt-out is the recipient's decision; no admin click and no stray `UPDATE` can
reverse it. Mautic treats opt-out as sacred by convention; we make it a
constraint.

### 4. The per-contact activity timeline

Mautic's timeline is its best interface idea: one place answering "what actually
happened with this person?" Our `contact_events` is the reduced version —
append-only, with no UPDATE or DELETE policy, so under `force row level security`
the history cannot be rewritten even by an admin.

## What we refused

### Open and click tracking

Mautic's tracking pixels and link rewriting are table stakes for marketers. We
will not ship them:

- Remote images and rewritten URLs both hurt deliverability, especially from a
  young sending domain.
- A youth-focused nonprofit silently recording whether individual teachers opened
  an email is a reputational risk that outweighs the insight.
- **Replies are the actual signal**, and Phase 2a captures those directly.

### Materialized segment membership

Mautic rebuilds `lead_lists_leads` on a cron. That forces a hard ordering —
segments must rebuild, then campaign membership, then campaign actions — and the
staleness bugs that follow ([#13088](https://github.com/mautic/mautic/issues/13088)).
Our follow-up queue is a single query computed on read. At a few hundred contacts
this is faster, simpler, and *cannot go stale*. This is a deliberate divergence,
not an oversight: it should stay this way until the row count makes it hurt.

### Also refused

Visual campaign builder, lead scoring/points, plugin architecture, landing pages
and form builder, EAV custom fields (our domain is known; typed columns are
better).

## Deferred, not refused

Multi-step follow-up sequences (Mautic's campaign idea reduced to a step number
and a delay — most replies come from follow-ups, not first contact) and saved
segments. Revisit after the compliance work has been used for a season.

## Where this design is already stronger

Worth recording, because these are not Mautic weaknesses so much as things it
never needed:

- **Per-team row-level security.** Mautic is single-organisation with permissions
  checked in application code. Our privacy boundary — a student seeing *that* a
  business is claimed but none of the other team's correspondence — is enforced
  by Postgres on every query.
- **Atomic exclusive claims.** Mautic has a lead `owner` field; it is not
  exclusive. Our `claims_one_active_per_org` partial unique index makes two teams
  claiming one business impossible even under simultaneous clicks.
- **Domain fit.** Seasons, teams, mentors, slots and bookings have no Mautic
  equivalent. Building this on Mautic would mean fighting it.

## Consequences

- `contacts.email_status` is gone. `db/migrations/001-suppressions.sql` carries
  existing data across.
- `app.is_suppressed()` is the single sendability gate. Phase 2a must call it on
  every send, and its bounce webhook must map provider soft/transient codes to
  `soft_bounce` — a wrong mapping re-introduces #9190.
- We own an opt-out surface (`/u/<token>`) and the deliverability duties that
  come with sending at all.
