# Database

- `schema.sql` — tables, types, indexes. Phases 0–2.
- `constraint-tests.sql` — proves the integrity guarantees actually hold.

## Migrations

`migrations/001-suppressions.sql` moves `contacts.email_status` to the
`suppressions` table. Only needed if you already have data worth keeping —
otherwise `pnpm db:reset` rebuilds from `schema.sql`. It is idempotent, and it
migrates the old ambiguous `bounced` value to `hard_bounce` (blocking) to
preserve existing behaviour; the file explains how to review those rows, since
some were probably soft bounces that should never have suppressed anyone.

Re-apply `policies.sql` and `functions.sql` afterwards. Both are idempotent.

## Running the constraint tests

`schema.sql` references Supabase's `auth.users`, so validating standalone needs a stub:

```bash
docker run --rm -d --name i3pg -e POSTGRES_PASSWORD=pw -p 55432:5432 postgres:16
docker exec i3pg psql -U postgres -c 'create schema auth; create table auth.users (id uuid primary key);'
docker cp db/schema.sql i3pg:/ && docker cp db/constraint-tests.sql i3pg:/
docker exec i3pg psql -U postgres -q -v ON_ERROR_STOP=1 -f /schema.sql
docker exec i3pg psql -U postgres -q -f /constraint-tests.sql
docker rm -f i3pg
```

Every test except #2 is expected to raise a constraint violation. That's the pass
condition — an insert that *succeeds* where the test says "must FAIL" is a
regression. Test #2 (reclaim after release) is the one that must succeed.

## What the database guarantees, so application code doesn't have to

| # | Guarantee | Enforced by |
|---|---|---|
| 1 | One team can hold a business at a time | `claims_one_active_per_org` (partial unique) |
| 2 | A released business returns to the pool | same index, scoped `where status='active'` |
| 3 | No duplicate contact email per season | `contacts_unique_email` (partial unique) |
| 3b | Case variants collide too | `citext` column type |
| 3c | One school cannot be entered twice in different casing | `citext` + `unique (season_id, kind, name)` |
| 4 | A student is on one team per season | `unique (profile_id, season_id)` |
| 4b | A contact's season always matches its organisation's | composite FK to `organizations(id, season_id)` |
| 5 | A slot cannot be double-booked | `unique` on `bookings.slot_id` |
| 6 | Exactly one active season | `seasons_one_active` (partial unique) |
| 7 | A confirmation/reminder sends once | `unique (booking_id, kind)` |
| 8 | Deleting a school removes its teachers | `on delete cascade` |
| 9 | An unsubscribe can never be lifted | `unsubscribe_is_final` check |
| 10 | A soft bounce can never block sending | `blocks_matches_reason` check |
| 11 | A hard bounce / unsubscribe always blocks | `blocks_matches_reason` check |
| 12 | Deleting a contact removes its suppressions and events | `on delete cascade` |
| 13 | The contact timeline cannot be edited or erased | RLS: no UPDATE/DELETE policy |

These are all race-condition-proof because they're database constraints rather
than read-then-write checks in application code. Two students clicking "claim" on
the same bakery at the same instant cannot both win.

## Why suppression is a table

`contacts.email_status` was a single mutable enum. It could not distinguish a
dead address from a full mailbox, so one temporary failure removed a teacher from
the follow-up queue permanently — the same defect as Mautic's open
[#9190](https://github.com/mautic/mautic/issues/9190). It also destroyed history
on every write.

`suppressions` keeps reason, channel, author and timestamp per row, and
`blocks_matches_reason` ties `blocks` to `reason` so a blocking soft bounce
cannot be inserted at all. `app.is_suppressed()` is the only place that decides
whether someone is contactable; the follow-up queue, the school rollup, the admin
dashboard and the Phase 2a send path all call it.

`db/rls-tests.sql` carries a permanent regression test for this: insert a soft
bounce, assert the contact is still queued; insert a hard bounce, assert they are
not.

**The RLS suite must run after `pnpm db:reset`.** One test has to COMMIT — the
opt-out path cannot be verified inside the transaction that writes it — so it
uses a dedicated `ZZ Optout Fixture` contact. That fixture is the only residue it
leaves, and a guard assertion checks no seeded teacher was touched.
