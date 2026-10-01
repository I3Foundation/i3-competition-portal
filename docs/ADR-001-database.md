# ADR-001: Postgres/Supabase over MongoDB

**Status:** accepted · **Date:** 2026-09-23

## Context

The integrity model in `db/schema.sql` is enforced entirely by database
constraints rather than application code. Before committing to Supabase we
tested whether those guarantees survive on MongoDB.

Both were run for real: Postgres 16 and MongoDB 7.0 in Docker, same 9 rules.
MongoDB script preserved at `docs/evidence/mongo-constraint-test.js`.

## Results

| # | Guarantee | Postgres | MongoDB |
|---|---|---|---|
| 1 | One active claim per business | pass | pass — `partialFilterExpression` |
| 2 | Released business returns to pool | pass | pass |
| 3 | No duplicate business email per season | pass | pass — partial unique |
| 3b | Case variants collide | pass | pass — collation strength 2 |
| 4 | One team per student per season | pass | pass — compound unique |
| 4b | Member's season matches their team's | pass — composite FK | **FAIL** — no FKs |
| 5 | No slot double-booking | pass | pass |
| 6 | Exactly one active season | pass | pass |
| 7 | Reminder sends once | pass | pass |
| 8 | No orphan claim pointing at a ghost business | pass | **FAIL** — no FKs |
| 9 | Deleting a season cascades to its teams | pass | **FAIL** — orphans left |

**MongoDB scored 8/11.** Notably better than the "NoSQL can't do integrity"
stereotype: partial unique indexes and index collation cover the entire dedupe
story, which is the portal's headline feature. Uniqueness is genuinely not the
problem. Referential integrity and cascades are.

## Decision

**Postgres via Supabase.** Three reasons, in order of weight.

### 1. Authorization is the real decider, not the constraints

The privacy matrix in `SCOPE.md` — students see *which* businesses are claimed
but never other teams' message contents — is ~30 lines of RLS policy, enforced
by the database. Every query is filtered whether or not the developer remembered
to filter it.

On MongoDB that becomes a manual `team_id` filter on every query in the codebase.
One forgotten filter and a student reads another team's private correspondence
with a local business owner. This app handles minors' communications with real
businesses; that is the wrong place to rely on developer discipline.

### 2. MongoDB no longer ships auth

Atlas App Services — authentication, user management, and data access
permissions — reached end-of-life on **30 September 2025**. There is no built-in
auth or rules layer to fall back on. Supabase gives magic-link auth and RLS in
the same box we're already using for data; MongoDB would mean bolting on Auth.js
(more wiring) or Clerk (another vendor, another bill).

### 3. The domain is relational

Threads → messages → classifications, teams → members → profiles, slots →
bookings. `$lookup` handles this but it is a worse fit than joins, and the
missing cascades mean writing manual cleanup for every delete path.

## Honest counterpoints

- The `messages` collection — email bodies, varying headers, attachment metadata
  — is a natural document fit. But Postgres `jsonb` covers that case well enough
  that it doesn't justify a second database or a different primary one.
- If the team knew MongoDB well and not SQL, velocity could outweigh the above.
  That isn't the situation here.

## Consequences

- Authorization lives in RLS policies (`db/policies.sql`), not app code. Policies
  need their own tests, same as the constraints.
- Schema changes need migrations. Slower early iteration than Mongo; the
  constraint guarantees are the thing we're buying with that.
- If we ever outgrow Supabase, the schema is plain Postgres and moves anywhere.
