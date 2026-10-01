-- Integrity guarantees. Every test except #2 must raise a constraint violation;
-- an insert that SUCCEEDS where the label says "must FAIL" is a regression.
\set ON_ERROR_STOP 0

\echo '--- TEST 1: two teams claim the same business (2nd must FAIL) ---'
insert into claims (organization_id, team_id)
  values ('0b000000-0000-0000-0000-000000000006','7ea50000-0000-0000-0000-000000000001');
insert into claims (organization_id, team_id)
  values ('0b000000-0000-0000-0000-000000000006','7ea50000-0000-0000-0000-000000000002');

\echo '--- TEST 2: after release, another team CAN claim (must SUCCEED) ---'
update claims set status='released', released_at=now()
 where organization_id='0b000000-0000-0000-0000-000000000006' and status='active';
insert into claims (organization_id, team_id)
  values ('0b000000-0000-0000-0000-000000000006','7ea50000-0000-0000-0000-000000000002');

\echo '--- TEST 3: duplicate contact email in one season (must FAIL) ---'
insert into contacts (organization_id, season_id, kind, full_name, email)
  values ('0c000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001',
          'teacher','Impostor','ralvarez@brookfield.example');

\echo '--- TEST 3b: case-variant email also collides (must FAIL) ---'
insert into contacts (organization_id, season_id, kind, full_name, email)
  values ('0c000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001',
          'teacher','Impostor','RALVAREZ@Brookfield.Example');

\echo '--- TEST 3c: same school name re-added in different casing (must FAIL) ---'
insert into organizations (season_id, kind, name)
  values ('5ea50000-0000-0000-0000-000000000001','school','brookfield charter school');

\echo '--- TEST 4: student on two teams in one season (must FAIL) ---'
insert into team_members (team_id, profile_id, season_id)
  values ('7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000005',
          '5ea50000-0000-0000-0000-000000000001');

\echo '--- TEST 4b: contact season_id contradicting its organisation (must FAIL) ---'
insert into contacts (organization_id, season_id, kind, full_name, email)
  values ('0c000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-999999999999',
          'teacher','Wrong Season','wrong@brookfield.example');

\echo '--- TEST 5: two teams book the same slot (2nd must FAIL) ---'
insert into bookings (slot_id, team_id, booked_by)
  select id,'7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005'
    from slots where status='open' order by starts_at limit 1;
insert into bookings (slot_id, team_id, booked_by)
  select slot_id,'7ea50000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000b'
    from bookings order by created_at desc limit 1;

\echo '--- TEST 6: two active seasons (must FAIL) ---'
insert into seasons (name, starts_on, ends_on, is_active)
  values ('Spring 2027','2027-01-10','2027-05-10',true);

\echo '--- TEST 7: duplicate reminder for one booking (must FAIL) ---'
insert into notifications (booking_id, kind) select id,'reminder_24h' from bookings limit 1;
insert into notifications (booking_id, kind) select id,'reminder_24h' from bookings limit 1;

\echo '--- TEST 8: deleting a school cascades to its teachers (must report 0) ---'
insert into organizations (id, season_id, kind, name)
  values ('0c000000-0000-0000-0000-0000000000ff','5ea50000-0000-0000-0000-000000000001','school','Doomed High');
insert into contacts (organization_id, season_id, kind, full_name, email)
  values ('0c000000-0000-0000-0000-0000000000ff','5ea50000-0000-0000-0000-000000000001',
          'teacher','Temp','temp@doomed.example');
delete from organizations where id='0c000000-0000-0000-0000-0000000000ff';
select 'orphaned contacts after cascade: ' || count(*) || '  (must be 0)'
  from contacts where organization_id='0c000000-0000-0000-0000-0000000000ff';

-- ===================== SUPPRESSION (migration 001 onward) ==================

\echo '--- TEST 9: lifting an unsubscribe (must FAIL) ---'
update suppressions set lifted_at=now()
 where reason='unsubscribed';

\echo '--- TEST 10: soft_bounce that blocks (must FAIL) ---'
insert into suppressions (contact_id, channel, reason, blocks)
  values ('cc000000-0000-0000-0000-000000000001','email','soft_bounce',true);

\echo '--- TEST 11: unsubscribe that does not block (must FAIL) ---'
insert into suppressions (contact_id, channel, reason, blocks)
  values ('cc000000-0000-0000-0000-000000000001','email','unsubscribed',false);

\echo '--- TEST 12: hard_bounce that does not block (must FAIL) ---'
insert into suppressions (contact_id, channel, reason, blocks)
  values ('cc000000-0000-0000-0000-000000000001','email','hard_bounce',false);

\echo '--- TEST 13: soft_bounce NOT blocking is allowed (must SUCCEED) ---'
insert into suppressions (contact_id, channel, reason, blocks)
  values ('cc000000-0000-0000-0000-000000000001','email','soft_bounce',false);

\echo '--- TEST 14: deleting a contact cascades suppressions + events ---'
insert into organizations (id, season_id, kind, name)
  values ('0c000000-0000-0000-0000-0000000000fe','5ea50000-0000-0000-0000-000000000001','school','Cascade High');
insert into contacts (id, organization_id, season_id, kind, full_name, email)
  values ('cc000000-0000-0000-0000-0000000000fe','0c000000-0000-0000-0000-0000000000fe',
          '5ea50000-0000-0000-0000-000000000001','teacher','Doomed','doomed@cascade.example');
insert into suppressions (contact_id, channel, reason, blocks)
  values ('cc000000-0000-0000-0000-0000000000fe','email','hard_bounce',true);
insert into contact_events (contact_id, kind) values ('cc000000-0000-0000-0000-0000000000fe','imported');
delete from contacts where id='cc000000-0000-0000-0000-0000000000fe';
select 'orphaned suppressions: ' || count(*) || '  (must be 0)'
  from suppressions where contact_id='cc000000-0000-0000-0000-0000000000fe';
select 'orphaned events:       ' || count(*) || '  (must be 0)'
  from contact_events where contact_id='cc000000-0000-0000-0000-0000000000fe';

-- ========================= PHASE 2a (email) ================================

\echo '--- TEST 15: outbound provider ids may repeat (index is inbound-only) ---'
-- The unique index exists for inbound replay dedupe. Constraining outbound too
-- coupled the send path to the provider never reusing an id, and a collision
-- rolled back the transaction that records a send -- stranding a message as
-- queued AFTER the mail had gone out. Both of these must SUCCEED.
insert into messages (thread_id, direction, from_email, to_email, provider_message_id)
  values ('c0000000-0000-0000-0000-000000000001','outbound','a@x.example','b@y.example','dup-provider-id');
insert into messages (thread_id, direction, from_email, to_email, provider_message_id)
  values ('c0000000-0000-0000-0000-000000000001','outbound','a@x.example','b@y.example','dup-provider-id');

\echo '--- TEST 16: inbound provider ids must NOT repeat (must FAIL) ---'
insert into messages (thread_id, direction, from_email, to_email, provider_message_id)
  values ('c0000000-0000-0000-0000-000000000001','inbound','b@y.example','a@x.example','dup-inbound-id');
insert into messages (thread_id, direction, from_email, to_email, provider_message_id)
  values ('c0000000-0000-0000-0000-000000000001','inbound','b@y.example','a@x.example','dup-inbound-id');

\echo '--- TEST 17: one webhook delivery recorded once (must FAIL on repeat) ---'
insert into webhook_deliveries (provider, event_id, event_type, payload)
  values ('resend','evt_dup','email.bounced','{}');
insert into webhook_deliveries (provider, event_id, event_type, payload)
  values ('resend','evt_dup','email.bounced','{}');

\echo '--- TEST 18: a template name is unique per season and flow (must FAIL) ---'
insert into email_templates (season_id, kind, name, subject, body_text)
  values ('5ea50000-0000-0000-0000-000000000001','teacher','First invitation','x','y');
