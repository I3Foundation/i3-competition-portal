-- I³ Competition Portal — schema (Supabase / Postgres)
-- Phases 0–2. RLS policies live in db/policies.sql.

create extension if not exists "pgcrypto";
create extension if not exists "citext";
create extension if not exists "pg_trgm";

-- ---------------------------------------------------------------- core

-- Everything is scoped to a season so year 2 never pollutes year 1.
-- Cheap to add now, painful to retrofit.
create table seasons (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,              -- 'Spring 2026'
  starts_on   date not null,
  ends_on     date not null,
  is_active   boolean not null default false,
  created_at  timestamptz not null default now()
);

-- Only one season active at a time.
create unique index seasons_one_active on seasons (is_active) where is_active;

create type user_role as enum ('student', 'mentor', 'admin');

-- Mirrors auth.users; Supabase owns authentication, we own everything else.
create table profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       citext not null unique,
  full_name   text not null,
  role        user_role not null default 'student',
  created_at  timestamptz not null default now()
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references seasons(id) on delete cascade,
  name        text not null,
  school      text,
  -- Address outreach mail is CC'd to, so the org keeps a passive copy.
  team_email  citext,
  created_at  timestamptz not null default now(),
  unique (season_id, name)
);

-- Composite target so team_members can carry season_id and still be guaranteed
-- consistent with the team it points at.
alter table teams add constraint teams_id_season_key unique (id, season_id);

create table team_members (
  team_id     uuid not null references teams(id) on delete cascade,
  profile_id  uuid not null references profiles(id) on delete cascade,
  -- Denormalized from teams so the one-team-per-season rule is a plain unique
  -- constraint. An index expression cannot contain a subquery, and this rule is
  -- too important to leave to application code.
  season_id   uuid not null,
  is_lead     boolean not null default false,
  primary key (team_id, profile_id),
  foreign key (team_id, season_id) references teams(id, season_id) on delete cascade,
  unique (profile_id, season_id)
);

-- ---------------------------------------------------------- outreach CRM
--
-- Two outreach flows share one model:
--   recruiting -- organisers contact TEACHERS at SCHOOLS to bring teams in
--   partnering -- student teams contact OWNERS at BUSINESSES to pair up
-- Same shape, different kind. Only the business side uses claims, because only
-- there do competing teams need exclusivity.

create type org_kind     as enum ('school', 'business');
create type contact_kind as enum ('teacher', 'business_owner');

-- Suppression: why we may not contact someone, on which channel.
--
-- This is a TABLE, not a column on contacts, for three reasons learned from
-- Mautic's lead_donotcontact:
--   * history -- a column overwrite destroys when, why and by whom
--   * per-channel -- an address can be dead while the phone still works
--   * hard vs soft -- the distinction a single column cannot express
--
-- Mautic's open bug #9190 is soft bounces landing in permanent suppression. A
-- full mailbox is not a dead address, so soft_bounce rows are recorded but never
-- block; the blocks_matches_reason constraint below makes that unforgeable.
create type suppress_channel as enum ('email', 'phone');

create type suppress_reason as enum (
  'unsubscribed',     -- they asked; permanent and legally binding
  'hard_bounce',      -- address does not exist; permanent
  'soft_bounce',      -- temporary (full mailbox, server down); MUST NOT block
  'invalid_address',  -- never sendable (the spreadsheet's "Unable to send")
  'manual'            -- organiser judgment
);

create table organizations (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references seasons(id) on delete cascade,
  kind        org_kind not null,
  name        citext not null,
  website     text,
  address     text,
  category    text,          -- business: 'Bakery'. school: district or type.
  notes       text,
  added_by    uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- citext, so "Carverton High School East" cannot be entered twice in
  -- different casing. A school and a business may share a name.
  unique (season_id, kind, name)
);

-- Composite target so contacts can carry season_id and stay consistent.
alter table organizations add constraint orgs_id_season_key unique (id, season_id);

create index organizations_name_trgm on organizations using gin ((name::text) gin_trgm_ops);

create table contacts (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  season_id        uuid not null,
  kind             contact_kind not null,
  -- Nullable on purpose: real lists contain "Mr. P" and blanks. Refusing to
  -- store a contact because the name is incomplete would be worse than the gap.
  full_name        text,
  email            citext,
  phone            text,
  role_title       text,     -- 'CS teacher', 'Owner'
  -- Opaque per-contact token for the public opt-out link. Unguessable, so it is
  -- the sole authorization for /u/<token> -- that page has no session.
  unsubscribe_token text not null unique
                     default encode(gen_random_bytes(16), 'hex'),
  notes            text,
  added_by         uuid references profiles(id) on delete set null,
  created_at       timestamptz not null default now(),
  foreign key (organization_id, season_id)
    references organizations(id, season_id) on delete cascade
);

-- One address appears once per season, whoever adds it. This is the dedupe
-- guarantee for the recruiting list.
create unique index contacts_unique_email
  on contacts (season_id, email) where email is not null;
create index contacts_by_org on contacts (organization_id);

create table suppressions (
  id          uuid primary key default gen_random_uuid(),
  contact_id  uuid not null references contacts(id) on delete cascade,
  channel     suppress_channel not null default 'email',
  reason      suppress_reason not null,
  -- Whether this actually stops a send. Derived from reason, not free-form.
  blocks      boolean not null,
  comment     text,
  source      text,        -- 'organiser' | 'webhook' | 'import' | 'recipient'
  created_by  uuid references profiles(id) on delete set null,
  created_at  timestamptz not null default now(),
  -- An organiser may lift a soft bounce or a manual block once resolved.
  lifted_at   timestamptz,
  lifted_by   uuid references profiles(id) on delete set null,

  -- An unsubscribe is the recipient's decision, not ours. Nothing in the UI, and
  -- no stray UPDATE, can reverse it.
  constraint unsubscribe_is_final
    check (not (reason = 'unsubscribed' and lifted_at is not null)),

  -- Keeps `blocks` honest about `reason`. This single constraint is what makes
  -- Mautic's soft-bounce bug unrepresentable here rather than merely avoided.
  constraint blocks_matches_reason check (
    (reason = 'soft_bounce'                      and not blocks) or
    (reason in ('unsubscribed','hard_bounce')    and blocks)     or
    (reason in ('invalid_address','manual'))
  )
);

-- Partial: only live suppressions matter when deciding whether to send.
create index suppressions_contact on suppressions (contact_id, channel)
  where lifted_at is null;

-- Append-only per-contact timeline, so "what actually happened with this
-- teacher?" is answerable. Has no UPDATE or DELETE policy by design.
create table contact_events (
  id          bigserial primary key,
  contact_id  uuid not null references contacts(id) on delete cascade,
  kind        text not null,   -- contacted|replied|suppressed|lifted|imported|claimed|released
  actor_id    uuid references profiles(id) on delete set null,  -- null = system
  detail      jsonb not null default '{}',
  created_at  timestamptz not null default now()
);

create index contact_events_contact on contact_events (contact_id, created_at desc);

create type claim_status as enum ('active', 'released', 'converted', 'expired');

-- Business partnering only. Teacher recruiting is run by one organiser team off
-- a shared list, so there is nothing to divide up and no claim row.
create table claims (
  id               uuid primary key default gen_random_uuid(),
  organization_id  uuid not null references organizations(id) on delete cascade,
  team_id          uuid not null references teams(id) on delete cascade,
  status           claim_status not null default 'active',
  claimed_by       uuid references profiles(id) on delete set null,
  claimed_at       timestamptz not null default now(),
  expires_at       timestamptz not null default (now() + interval '14 days'),
  released_at      timestamptz
);

-- One team at a time, enforced by Postgres rather than by application code.
create unique index claims_one_active_per_org
  on claims (organization_id) where status = 'active';

-- Deliberately close to the spreadsheet's vocabulary. 'sent' with no reply is
-- Reply?=No; 'replied'/'interested'/'declined' are Reply?=Yes; 'bounced' is the
-- state that used to hide in the Notes column.
create type thread_status as enum (
  'draft', 'sent', 'replied', 'interested', 'declined', 'no_response', 'bounced'
);

create table outreach_threads (
  id                uuid primary key default gen_random_uuid(),
  contact_id        uuid not null references contacts(id) on delete cascade,
  -- Null for organiser-run recruiting; set for team-run business outreach.
  team_id           uuid references teams(id) on delete cascade,
  sender_id         uuid not null references profiles(id) on delete restrict,
  reply_token       text not null unique default encode(gen_random_bytes(16), 'hex'),
  subject           text not null,
  status            thread_status not null default 'draft',
  last_activity_at  timestamptz not null default now(),
  created_at        timestamptz not null default now()
);

create index outreach_threads_team on outreach_threads (team_id, last_activity_at desc);
create index outreach_threads_contact on outreach_threads (contact_id);

create type msg_direction as enum ('outbound', 'inbound');

-- 'external' = the student sent it from their own mail client via a compose
-- link. We have the body they composed, but delivery is genuinely unknown to
-- us: no provider, no bounce webhook, no read receipt. Recording it as
-- 'delivered' would be a lie, so it gets its own state.
create type delivery_state as enum
  ('queued', 'delivered', 'failed', 'bounced', 'external');

create table messages (
  id                   uuid primary key default gen_random_uuid(),
  thread_id            uuid not null references outreach_threads(id) on delete cascade,
  direction            msg_direction not null,
  from_email           citext not null,
  to_email             citext not null,
  subject              text,
  body_text            text,
  body_html            text,
  provider_message_id  text,
  -- Outbound delivery outcome. 'queued' only exists while a send is in flight;
  -- a row left queued means the process died mid-send and is safe to retry.
  delivery             delivery_state not null default 'delivered',
  error                text,
  sent_at              timestamptz not null default now()
);

create index messages_thread on messages (thread_id, sent_at);
-- Inbound only. This index exists to make a replayed inbound delivery a no-op;
-- applying it to outbound as well coupled the send path to the provider never
-- reusing an id, and a collision there rolled back the transaction that records
-- a send -- stranding the message as 'queued' after the mail had already gone
-- out. Outbound ids are stored but not constrained.
create unique index messages_provider_id
  on messages (provider_message_id)
  where provider_message_id is not null and direction = 'inbound';

create type reply_label as enum (
  'interested', 'declined', 'question', 'auto_reply', 'out_of_office', 'bounce', 'unclear'
);

create table classifications (
  message_id  uuid primary key references messages(id) on delete cascade,
  label       reply_label not null,
  confidence  real,
  rationale   text,
  model       text not null,
  created_at  timestamptz not null default now()
);

create table send_log (
  id          bigserial primary key,
  team_id     uuid references teams(id) on delete cascade,
  sender_id   uuid references profiles(id) on delete set null,
  sent_at     timestamptz not null default now()
);
create index send_log_team_day on send_log (team_id, sent_at desc);
create index send_log_sender_day on send_log (sender_id, sent_at desc);

-- Editable message templates, so changing the pitch is not a deploy.
-- Placeholders are {{first_name}}, {{org_name}}, {{sender_name}}.
create table email_templates (
  id          uuid primary key default gen_random_uuid(),
  season_id   uuid not null references seasons(id) on delete cascade,
  kind        contact_kind not null,   -- which outreach flow it belongs to
  name        text not null,
  subject     text not null,
  body_text   text not null,
  created_at  timestamptz not null default now(),
  unique (season_id, kind, name)
);

-- Every webhook delivery, recorded before it is acted on. Providers retry on
-- any non-2xx and on their own schedule, so replays are normal rather than
-- exceptional; the unique index makes handling them idempotent, and the stored
-- payload makes a mis-mapped bounce diagnosable after the fact.
create table webhook_deliveries (
  id           bigserial primary key,
  provider     text not null,          -- 'resend' | 'inbound'
  event_id     text not null,
  event_type   text,
  payload      jsonb not null,
  received_at  timestamptz not null default now(),
  handled_at   timestamptz,
  note         text,
  unique (provider, event_id)
);

-- ------------------------------------------------------------ scheduling

create table mentor_profiles (
  profile_id    uuid primary key references profiles(id) on delete cascade,
  bio           text,
  expertise     text[] not null default '{}',
  timezone      text not null default 'America/New_York',
  -- v1: the mentor's own Zoom PMI / Meet room. Swap for a pooled allocator later
  -- without touching the booking flow.
  meeting_link  text
);

-- Recurring weekly availability. Slots are materialized from these.
create table availability_rules (
  id             uuid primary key default gen_random_uuid(),
  mentor_id      uuid not null references profiles(id) on delete cascade,
  season_id      uuid not null references seasons(id) on delete cascade,
  weekday        smallint not null check (weekday between 0 and 6),  -- 0 = Sunday
  start_time     time not null,
  end_time       time not null,
  slot_minutes   smallint not null default 30,
  check (end_time > start_time)
);

-- One-off overrides: "I'm out this Thursday" / "extra hours this week".
create table availability_exceptions (
  id          uuid primary key default gen_random_uuid(),
  mentor_id   uuid not null references profiles(id) on delete cascade,
  on_date     date not null,
  is_blocked  boolean not null default true,
  start_time  time,
  end_time    time
);

create type slot_status as enum ('open', 'booked', 'cancelled');

-- Materialized rather than computed on read: lets us pin a meeting link and an
-- exception result to a specific slot, and makes double-booking a unique index
-- instead of a transaction dance.
create table slots (
  id            uuid primary key default gen_random_uuid(),
  mentor_id     uuid not null references profiles(id) on delete cascade,
  season_id     uuid not null references seasons(id) on delete cascade,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        slot_status not null default 'open',
  meeting_link  text,
  created_at    timestamptz not null default now(),
  unique (mentor_id, starts_at)
);

create index slots_open on slots (season_id, starts_at) where status = 'open';

create table bookings (
  id          uuid primary key default gen_random_uuid(),
  slot_id     uuid not null unique references slots(id) on delete cascade,  -- no double-booking
  team_id     uuid not null references teams(id) on delete cascade,
  booked_by   uuid not null references profiles(id) on delete restrict,
  topic       text,
  cancelled_at timestamptz,
  created_at  timestamptz not null default now()
);

-- Outbound notification ledger, so a retry or redeploy can't double-send
-- a confirmation or a reminder.
create table notifications (
  id          uuid primary key default gen_random_uuid(),
  booking_id  uuid not null references bookings(id) on delete cascade,
  kind        text not null,              -- 'confirmation' | 'reminder_24h'
  sent_at     timestamptz not null default now(),
  unique (booking_id, kind)
);
