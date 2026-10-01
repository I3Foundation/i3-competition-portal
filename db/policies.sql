-- Row Level Security. This file is the authorization model for the whole app.
--
-- ADR-001 chose Postgres specifically so these rules are enforced by the
-- database on every query, rather than by a filter a developer has to remember
-- to write. Nothing here should ever be duplicated in application code.

create schema if not exists app;

-- ---------------------------------------------------------------------------
-- THE SUPABASE SWAP POINT.
-- Locally the current user arrives as a per-request session variable set in
-- src/lib/db.ts. On Supabase, replace this function body with:
--     select auth.uid()
-- Nothing else in this file changes.
-- ---------------------------------------------------------------------------
create or replace function app.current_user_id() returns uuid
  language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

-- security definer so these can read profiles/team_members without tripping the
-- policies defined on those same tables (which would recurse infinitely).
create or replace function app.is_admin() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                  where id = app.current_user_id() and role = 'admin')
$$;

create or replace function app.is_mentor() returns boolean
  language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles
                  where id = app.current_user_id() and role = 'mentor')
$$;

-- The caller's team in the currently active season, or null.
create or replace function app.my_team_id() returns uuid
  language sql stable security definer set search_path = public as $$
  select tm.team_id
    from team_members tm
    join seasons s on s.id = tm.season_id and s.is_active
   where tm.profile_id = app.current_user_id()
   limit 1
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. A table with RLS on and no policy denies everything,
-- which is the correct default for anything added later and forgotten.
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array[
    'seasons','profiles','teams','team_members','organizations','contacts',
    'suppressions','contact_events','claims','email_templates',
    'outreach_threads','messages','classifications','send_log',
    'mentor_profiles','availability_rules','availability_exceptions',
    'slots','bookings','notifications'
  ] loop
    execute format('alter table %I enable row level security', t);
    execute format('alter table %I force row level security', t);
  end loop;
end $$;

-- ------------------------------------------------------------------ rosters

-- Names are visible to everyone signed in: team lists, mentor directory,
-- "claimed by Team B" labels all need them.
create policy profiles_read   on profiles     for select using (true);
create policy profiles_admin  on profiles     for all    using (app.is_admin()) with check (app.is_admin());
create policy profiles_self   on profiles     for update using (id = app.current_user_id())
                                                     with check (id = app.current_user_id());

create policy seasons_read    on seasons      for select using (true);
create policy seasons_admin   on seasons      for all    using (app.is_admin()) with check (app.is_admin());

create policy teams_read      on teams        for select using (true);
create policy teams_admin     on teams        for all    using (app.is_admin()) with check (app.is_admin());

create policy members_read    on team_members for select using (true);
create policy members_admin   on team_members for all    using (app.is_admin()) with check (app.is_admin());

-- ----------------------------------------------------------------- outreach

-- Recruiting (schools + teachers) is organiser work. Students have no business
-- seeing which teachers the foundation is emailing, so the whole school side is
-- admin-only -- expressed as a kind check rather than a separate table.
-- Signed-in check is explicit: without it a session with no app.user_id set
-- (an unauthenticated request, or a bug that forgets to set it) could read the
-- whole business registry.
create policy orgs_read on organizations for select
  using ((kind = 'business' and app.current_user_id() is not null) or app.is_admin());

create policy orgs_add on organizations for insert with check (
  app.is_admin() or (kind = 'business' and app.current_user_id() is not null));

-- Only the team currently holding the claim may edit a business record.
create policy orgs_edit on organizations for update using (
  app.is_admin() or exists (
    select 1 from claims c
     where c.organization_id = organizations.id and c.status = 'active'
       and c.team_id = app.my_team_id()));

create policy orgs_admin on organizations for all
  using (app.is_admin()) with check (app.is_admin());

-- Contacts inherit their organisation's visibility.
create policy contacts_read on contacts for select using (
  app.is_admin() or (app.current_user_id() is not null and exists (
    select 1 from organizations o
     where o.id = contacts.organization_id and o.kind = 'business')));

create policy contacts_add on contacts for insert with check (
  app.is_admin() or (
    kind = 'business_owner' and app.current_user_id() is not null
    and exists (select 1 from organizations o
                 where o.id = organization_id and o.kind = 'business')));

create policy contacts_edit on contacts for update using (
  app.is_admin() or exists (
    select 1 from claims c
     where c.organization_id = contacts.organization_id and c.status = 'active'
       and c.team_id = app.my_team_id()));

create policy contacts_admin on contacts for all
  using (app.is_admin()) with check (app.is_admin());

-- Suppressions inherit their contact's visibility: admins see all, a team sees
-- those for a business it currently holds. Students never see teacher rows.
create policy suppressions_read on suppressions for select using (
  app.is_admin() or exists (
    select 1 from contacts ct
      join claims c on c.organization_id = ct.organization_id and c.status = 'active'
     where ct.id = suppressions.contact_id and c.team_id = app.my_team_id()));

create policy suppressions_add on suppressions for insert with check (
  app.is_admin() or exists (
    select 1 from contacts ct
      join claims c on c.organization_id = ct.organization_id and c.status = 'active'
     where ct.id = contact_id and c.team_id = app.my_team_id()));

-- Lifting is the ONLY permitted mutation, and only by an admin. There is no
-- delete policy, so with force row level security the history cannot be erased
-- -- and the unsubscribe_is_final constraint still blocks lifting an opt-out
-- even here.
create policy suppressions_lift on suppressions for update
  using (app.is_admin()) with check (app.is_admin());

-- Append-only timeline: select and insert only. No update or delete policy
-- means RLS denies both outright, for admins included.
create policy events_read on contact_events for select using (
  app.is_admin() or exists (
    select 1 from contacts ct
      join organizations o on o.id = ct.organization_id
     where ct.id = contact_events.contact_id and o.kind = 'business'
       and app.current_user_id() is not null));

create policy events_add on contact_events for insert
  with check (app.current_user_id() is not null or app.is_admin());

-- Who holds which business is public to the cohort; that visibility IS dedupe.
create policy claims_read   on claims for select using (app.current_user_id() is not null);
create policy claims_insert on claims for insert with check (team_id = app.my_team_id() or app.is_admin());
create policy claims_update on claims for update using (team_id = app.my_team_id() or app.is_admin());

-- Message CONTENT is private to the owning team. Recruiting threads carry a
-- null team_id, so they match only for admins -- students never see them.
create policy threads_own on outreach_threads for all
  using      ((team_id is not null and team_id = app.my_team_id()) or app.is_admin())
  with check ((team_id is not null and team_id = app.my_team_id()) or app.is_admin());

create policy messages_own on messages for all
  using (exists (select 1 from outreach_threads t
                  where t.id = messages.thread_id
                    and ((t.team_id is not null and t.team_id = app.my_team_id())
                         or app.is_admin())));

create policy classifications_own on classifications for all
  using (exists (select 1 from messages m
                   join outreach_threads t on t.id = m.thread_id
                  where m.id = classifications.message_id
                    and ((t.team_id is not null and t.team_id = app.my_team_id())
                         or app.is_admin())));

create policy sendlog_own on send_log for all
  using ((team_id is not null and team_id = app.my_team_id()) or app.is_admin())
  with check ((team_id is not null and team_id = app.my_team_id()) or app.is_admin());

-- --------------------------------------------------------------- scheduling

create policy mentors_read  on mentor_profiles for select using (true);
create policy mentors_write on mentor_profiles for all
  using      (profile_id = app.current_user_id() or app.is_admin())
  with check (profile_id = app.current_user_id() or app.is_admin());

create policy rules_read  on availability_rules for select using (true);
create policy rules_write on availability_rules for all
  using      (mentor_id = app.current_user_id() or app.is_admin())
  with check (mentor_id = app.current_user_id() or app.is_admin());

create policy exc_read  on availability_exceptions for select using (true);
create policy exc_write on availability_exceptions for all
  using      (mentor_id = app.current_user_id() or app.is_admin())
  with check (mentor_id = app.current_user_id() or app.is_admin());

-- Teams need to see open slots to book them.
create policy slots_read  on slots for select using (true);
create policy slots_write on slots for all
  using      (mentor_id = app.current_user_id() or app.is_admin())
  with check (mentor_id = app.current_user_id() or app.is_admin());

-- A booking is visible to the team that made it and the mentor being booked.
create policy bookings_read on bookings for select using (
  team_id = app.my_team_id() or app.is_admin()
  or exists (select 1 from slots s where s.id = bookings.slot_id
              and s.mentor_id = app.current_user_id())
);
create policy bookings_write on bookings for insert with check (team_id = app.my_team_id() or app.is_admin());
create policy bookings_cancel on bookings for update using (team_id = app.my_team_id() or app.is_admin());

create policy notifications_admin on notifications for all using (app.is_admin()) with check (app.is_admin());

-- Templates are readable by anyone signed in (students compose from them) and
-- editable only by admins.
create policy templates_read  on email_templates for select
  using (app.current_user_id() is not null);
create policy templates_admin on email_templates for all
  using (app.is_admin()) with check (app.is_admin());

-- webhook_deliveries holds raw provider payloads, including full inbound email
-- bodies. RLS is enabled with NO policy, so i3_app cannot read or write it at
-- all; the handlers go through app.record_webhook() / app.mark_webhook_handled(),
-- which are security definer. That keeps the table unreachable from any
-- user-session query even by accident.
alter table webhook_deliveries enable row level security;
alter table webhook_deliveries force row level security;

-- ---------------------------------------------------------------------------
-- Application role. Critically NOT a superuser and NOT the table owner --
-- both of those bypass RLS entirely, which would silently void this whole file.
-- ---------------------------------------------------------------------------
do $$ begin
  if not exists (select 1 from pg_roles where rolname = 'i3_app') then
    create role i3_app login password 'apppw';
  end if;
end $$;

grant usage on schema public, app to i3_app;
grant select, insert, update, delete on all tables in schema public to i3_app;
grant usage, select on all sequences in schema public to i3_app;
grant execute on all functions in schema app to i3_app;
alter default privileges in schema public grant select, insert, update, delete on tables to i3_app;
