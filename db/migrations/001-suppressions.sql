-- Migration 001: contacts.email_status -> suppressions table
--
-- Only needed if you already have data worth keeping. If you do not,
-- `pnpm db:reset` rebuilds from schema.sql and you can ignore this file.
--
-- Run as the table owner (postgres), not as i3_app:
--   docker cp db/migrations/001-suppressions.sql i3-portal-db:/m.sql
--   docker exec -i i3-portal-db psql -U postgres -d i3 -v ON_ERROR_STOP=1 -f /m.sql
--
-- Idempotent: safe to run twice.

begin;

-- 1. New types (no-ops if schema.sql already created them).
do $$ begin
  create type suppress_channel as enum ('email', 'phone');
exception when duplicate_object then null; end $$;

do $$ begin
  create type suppress_reason as enum
    ('unsubscribed','hard_bounce','soft_bounce','invalid_address','manual');
exception when duplicate_object then null; end $$;

-- 2. Tables.
create table if not exists suppressions (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  channel     suppress_channel not null default 'email',
  reason      suppress_reason not null,
  blocks      boolean not null,
  comment     text,
  source      text,
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  lifted_at   timestamptz,
  lifted_by   uuid references profiles(id) on delete set null,
  constraint unsubscribe_is_final
    check (not (reason = 'unsubscribed' and lifted_at is not null)),
  constraint blocks_matches_reason check (
    (reason = 'soft_bounce'                   and not blocks) or
    (reason in ('unsubscribed','hard_bounce') and blocks)     or
    (reason in ('invalid_address','manual'))
  )
);

create index if not exists suppressions_contact
  on suppressions (contact_id, channel) where lifted_at is null;

create table if not exists contact_events (
  id          bigserial primary key,
  contact_id  uuid not null references contacts(id) on delete cascade,
  kind        text not null,
  actor_id    uuid references profiles(id) on delete set null,
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index if not exists contact_events_contact
  on contact_events (contact_id, created_at desc);

-- 3. Opt-out token.
alter table contacts add column if not exists unsubscribe_token text
  default encode(gen_random_bytes(16), 'hex');
update contacts set unsubscribe_token = encode(gen_random_bytes(16), 'hex')
 where unsubscribe_token is null;
alter table contacts alter column unsubscribe_token set not null;
do $$ begin
  alter table contacts add constraint contacts_unsubscribe_token_key
    unique (unsubscribe_token);
exception when duplicate_table or duplicate_object then null; end $$;

-- 4. Carry the old column across, if it is still there.
--
-- NOTE on intent: the old 'bounced' value could not distinguish a dead address
-- from a full mailbox, so it is migrated as hard_bounce (blocking) to preserve
-- existing behaviour. Review those rows afterwards -- some were probably soft
-- bounces that should never have been suppressed:
--   select c.full_name, c.email from suppressions s
--     join contacts c on c.id = s.contact_id
--    where s.reason = 'hard_bounce' and s.source = 'migration-001';
do $$ begin
  if exists (select 1 from information_schema.columns
              where table_name='contacts' and column_name='email_status') then

    insert into suppressions (contact_id, channel, reason, blocks, comment, source)
    select c.id, 'email',
           case c.email_status::text
             when 'bounced'    then 'hard_bounce'::suppress_reason
             when 'unsendable' then 'invalid_address'::suppress_reason
           end,
           true,
           'Migrated from contacts.email_status = ' || c.email_status::text,
           'migration-001'
      from contacts c
     where c.email_status::text in ('bounced','unsendable')
       and not exists (select 1 from suppressions s
                        where s.contact_id = c.id and s.channel = 'email');

    insert into contact_events (contact_id, kind, detail)
    select contact_id, 'suppressed',
           jsonb_build_object('reason', reason::text, 'source','migration-001')
      from suppressions where source = 'migration-001';

    alter table contacts drop column email_status;
  end if;
end $$;

drop type if exists email_status;

-- 5. Grants for the app role.
grant select, insert, update, delete on suppressions, contact_events to i3_app;
grant usage, select on all sequences in schema public to i3_app;

commit;

-- Policies and functions are NOT created here: re-apply db/policies.sql and
-- db/functions.sql after this migration, both of which are idempotent.
