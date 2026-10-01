-- Materializes concrete slots from a mentor's recurring availability rules.
-- Called from the availability page now; a scheduled job will call the same
-- function to keep a rolling window open once the season is running.
--
-- security definer so a mentor can create their own slots without a blanket
-- insert grant; the mentor_id argument is pinned to the caller by the policy
-- check inside.
create or replace function app.generate_slots(p_mentor uuid, p_weeks int default 4)
returns integer
language plpgsql security definer set search_path = public, app as $$
declare
  inserted integer;
begin
  if p_mentor <> app.current_user_id() and not app.is_admin() then
    raise exception 'can only generate your own slots';
  end if;

  with new_slots as (
    insert into slots (mentor_id, season_id, starts_at, ends_at, meeting_link)
    select r.mentor_id, r.season_id, s.slot_start,
           s.slot_start + make_interval(mins => r.slot_minutes), mp.meeting_link
      from availability_rules r
      join mentor_profiles mp on mp.profile_id = r.mentor_id
      cross join lateral (
        select d::date as day
          from generate_series(current_date, current_date + (p_weeks * 7 - 1), '1 day') d
         where extract(dow from d) = r.weekday
      ) days
      cross join lateral generate_series(
        (days.day + r.start_time) at time zone mp.timezone,
        (days.day + r.end_time) at time zone mp.timezone
          - make_interval(mins => r.slot_minutes),
        make_interval(mins => r.slot_minutes)
      ) as s(slot_start)
     where r.mentor_id = p_mentor
       -- Never resurrect a slot the mentor deliberately blocked off.
       and not exists (
         select 1 from availability_exceptions e
          where e.mentor_id = r.mentor_id and e.is_blocked
            and e.on_date = (s.slot_start at time zone mp.timezone)::date)
    on conflict (mentor_id, starts_at) do nothing
    returning 1)
  select count(*) into inserted from new_slots;

  return inserted;
end $$;

grant execute on function app.generate_slots(uuid, int) to i3_app;

-- ---------------------------------------------------------------------------
-- Suppression
-- ---------------------------------------------------------------------------

-- The single source of truth for "may we contact this person on this channel?"
-- Every follow-up query and (in Phase 2a) every send must go through this.
-- Soft bounces are deliberately invisible here: they are recorded but never
-- block, which is the Mautic #9190 behaviour we are not reproducing.
create or replace function app.is_suppressed(
  p_contact uuid,
  p_channel suppress_channel default 'email'
) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from suppressions
     where contact_id = p_contact
       and channel    = p_channel
       and blocks
       and lifted_at is null)
$$;

-- Records a recipient's own opt-out.
--
-- The public opt-out page runs with NO session, so RLS cannot authorize this --
-- the token is the authorization. security definer keeps that narrow: this can
-- write one suppression row for the token's contact and can do nothing else.
--
-- Idempotent: a second call (double submit, or the recipient clicking again
-- months later) returns true without inserting a duplicate.
-- Returns false for an unknown token so the caller can render a neutral page
-- rather than confirming whether the token existed.
create or replace function app.unsubscribe_by_token(
  p_token   text,
  p_comment text default null
) returns boolean
language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
begin
  if p_token is null or length(p_token) < 8 then
    return false;
  end if;

  select id into v_contact from contacts where unsubscribe_token = p_token;
  if v_contact is null then
    return false;
  end if;

  if exists (select 1 from suppressions
              where contact_id = v_contact and channel = 'email'
                and reason = 'unsubscribed') then
    return true;                       -- already opted out; nothing to do
  end if;

  insert into suppressions (contact_id, channel, reason, blocks, comment, source)
  values (v_contact, 'email', 'unsubscribed', true, p_comment, 'recipient');

  -- actor_id stays null: this was the recipient, not a member of staff.
  insert into contact_events (contact_id, kind, detail)
  values (v_contact, 'suppressed',
          jsonb_build_object('reason','unsubscribed','source','recipient'));

  return true;
end $$;

grant execute on function app.is_suppressed(uuid, suppress_channel) to i3_app;
grant execute on function app.unsubscribe_by_token(text, text) to i3_app;

-- ---------------------------------------------------------------------------
-- Webhook intake (Phase 2a)
-- ---------------------------------------------------------------------------

-- Records a provider delivery before anything acts on it, and reports whether
-- this is the first time we have seen it.
--
-- Returns the row id for a new event, or NULL if we already have it. Providers
-- retry on any non-2xx and on their own schedule, so replays are routine; every
-- handler must treat NULL as "already done, acknowledge and stop".
--
-- security definer because webhook_deliveries is under RLS with no policy: the
-- raw payloads include full email bodies and must not be reachable from a
-- user-session query.
create or replace function app.record_webhook(
  p_provider   text,
  p_event_id   text,
  p_event_type text,
  p_payload    jsonb
) returns bigint
language plpgsql security definer set search_path = public as $$
declare
  v_id bigint;
begin
  insert into webhook_deliveries (provider, event_id, event_type, payload)
  values (p_provider, p_event_id, p_event_type, p_payload)
  on conflict (provider, event_id) do nothing
  returning id into v_id;

  return v_id;   -- NULL means duplicate
end $$;

create or replace function app.mark_webhook_handled(p_id bigint, p_note text default null)
returns void
language sql security definer set search_path = public as $$
  update webhook_deliveries set handled_at = now(), note = p_note where id = p_id
$$;

-- How many sends a team (or, for organiser recruiting, one sender) has made in
-- the last 24h. The cap exists so a team cannot torch the sending domain's
-- reputation in one afternoon.
create or replace function app.sends_last_day(
  p_team uuid,
  p_sender uuid
) returns integer
language sql stable security definer set search_path = public as $$
  select count(*)::int from send_log
   where sent_at > now() - interval '1 day'
     and ((p_team is not null and team_id = p_team)
          or (p_team is null and sender_id = p_sender))
$$;

grant execute on function app.record_webhook(text, text, text, jsonb) to i3_app;
grant execute on function app.mark_webhook_handled(bigint, text) to i3_app;
grant execute on function app.sends_last_day(uuid, uuid) to i3_app;

-- Resolves a reply token to the thread's sender, so an inbound webhook with no
-- session can then act AS that sender instead of needing blanket table access.
-- Returns NULL for an unknown token.
create or replace function app.thread_sender_by_token(p_token text)
returns uuid
language sql stable security definer set search_path = public as $$
  select sender_id from outreach_threads where reply_token = p_token
$$;

grant execute on function app.thread_sender_by_token(text) to i3_app;

-- Applies a provider delivery event to the right contact.
--
-- Resolution order matters: the provider message id is authoritative because it
-- identifies the exact send, whereas a recipient address can be shared or
-- stale. Falling back to the address at all is a convenience for providers that
-- omit the id.
--
-- Returns the contact id it acted on, or NULL if nothing matched -- a bounce for
-- a contact we deleted should be recorded and dropped, not retried forever.
--
-- security definer: the webhook has no session, and suppressions is under RLS.
create or replace function app.apply_delivery_event(
  p_provider_id text,
  p_to          text,
  p_reason      suppress_reason,
  p_blocks      boolean,
  p_note        text
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_contact uuid;
  v_message uuid;
begin
  if p_provider_id is not null then
    select m.id, t.contact_id into v_message, v_contact
      from messages m
      join outreach_threads t on t.id = m.thread_id
     where m.provider_message_id = p_provider_id
     limit 1;
  end if;

  if v_contact is null and p_to is not null then
    select id into v_contact from contacts where email = p_to::citext limit 1;
  end if;

  if v_contact is null then
    return null;
  end if;

  if v_message is not null and p_blocks then
    update messages set delivery = 'bounced', error = p_note where id = v_message;
  end if;

  -- A repeat soft bounce is meaningful (it is how an organiser decides an
  -- address is really dead), so soft rows accumulate. A blocking row is
  -- inserted only once, so provider retries cannot pile them up.
  if p_blocks and exists (
    select 1 from suppressions
     where contact_id = v_contact and channel = 'email'
       and reason = p_reason and lifted_at is null) then
    return v_contact;
  end if;

  insert into suppressions (contact_id, channel, reason, blocks, comment, source)
  values (v_contact, 'email', p_reason, p_blocks, p_note, 'webhook');

  insert into contact_events (contact_id, kind, actor_id, detail)
  values (v_contact, 'suppressed', null,
          jsonb_build_object('reason', p_reason::text, 'blocks', p_blocks,
                             'source', 'webhook', 'note', p_note));

  return v_contact;
end $$;

grant execute on function app.apply_delivery_event(text, text, suppress_reason, boolean, text) to i3_app;
