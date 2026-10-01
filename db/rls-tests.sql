-- Authorization tests. MUST run as i3_app; as postgres every check passes
-- meaninglessly because superusers bypass RLS.
--
-- Run after `pnpm db:reset`. One test must COMMIT (the opt-out path cannot be
-- verified inside a transaction it also writes in), so it uses its own
-- throwaway fixture rather than a seeded contact. That fixture is the only
-- residue the suite leaves.
-- app.user_id must be SET LOCAL inside a transaction or it is a silent no-op.
\set ON_ERROR_STOP 0

\echo '=== Jordan (Northside student) ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000005';
  select 'business registry visible:   ' || count(*) || '  expect 12'
    from organizations where kind='business';
  select 'SCHOOLS LEAKED TO STUDENT:   ' || count(*) || '  expect 0'
    from organizations where kind='school';
  select 'TEACHERS LEAKED TO STUDENT:  ' || count(*) || '  expect 0'
    from contacts where kind='teacher';
  select 'own threads:                 ' || count(*) || '  expect 2' from outreach_threads;
  select 'RECRUITING THREADS LEAKED:   ' || count(*) || '  expect 0'
    from outreach_threads where team_id is null;
commit;

\echo '=== Priya (Lincoln student) -- cross-team privacy ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000008';
  select 'own threads:                 ' || count(*) || '  expect 1' from outreach_threads;
  select 'NORTHSIDE THREADS LEAKED:    ' || count(*) || '  expect 0'
    from outreach_threads where team_id='7ea50000-0000-0000-0000-000000000001';
  select 'NORTHSIDE BODIES LEAKED:     ' || count(*) || '  expect 0'
    from messages where thread_id='c0000000-0000-0000-0000-000000000001';
  select 'sees Northside holds Rosa''s: ' || count(*) || '  expect 1'
    from claims where organization_id='0b000000-0000-0000-0000-000000000001' and status='active';
commit;

\echo '=== student tries to add a school (must FAIL) ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000005';
  insert into organizations (season_id, kind, name)
    values ('5ea50000-0000-0000-0000-000000000001','school','Sneaky High');
rollback;

\echo '=== student tries to add a teacher contact (must FAIL) ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000005';
  insert into contacts (organization_id, season_id, kind, full_name, email)
    values ('0b000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001',
            'teacher','Sneaky','sneaky@x.example');
rollback;

\echo '=== student writes a thread in another team''s name (must FAIL) ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000008';
  insert into outreach_threads (contact_id, team_id, sender_id, subject)
    values ('cb000000-0000-0000-0000-000000000001','7ea50000-0000-0000-0000-000000000001',
            'a0000000-0000-0000-0000-000000000008','spoofed');
rollback;

\echo '=== student writes a RECRUITING thread, team_id null (must FAIL) ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000008';
  insert into outreach_threads (contact_id, team_id, sender_id, subject)
    values ('cb000000-0000-0000-0000-000000000001', null,
            'a0000000-0000-0000-0000-000000000008','sneaking into recruiting');
rollback;

\echo '=== Sam (mentor) -- no outreach or recruiting access ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000002';
  select 'threads visible:             ' || count(*) || '  expect 0' from outreach_threads;
  select 'teachers visible:            ' || count(*) || '  expect 0'
    from contacts where kind='teacher';
commit;

\echo '=== Dana (admin) sees everything ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'schools:                     ' || count(*) || '  expect 6'
    from organizations where kind='school';
  select 'teachers:                    ' || count(*) || '  expect 10'
    from contacts where kind='teacher';
  select 'all threads:                 ' || count(*) || '  expect 11' from outreach_threads;
commit;

\echo '=== signed out ==='
begin;
  set local app.user_id = '';
  select 'organizations visible:       ' || count(*) || '  expect 0' from organizations;
  select 'contacts visible:            ' || count(*) || '  expect 0' from contacts;
  select 'threads visible:             ' || count(*) || '  expect 0' from outreach_threads;
commit;

-- ================= SUPPRESSION / follow-up queue regression ================

\echo '=== REGRESSION (Mautic #9190): a soft bounce must NOT drop a teacher ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';

  -- Isolated fixture: one school, one teacher, contacted 10 days ago.
  insert into organizations (id, season_id, kind, name)
    values ('0c000000-0000-0000-0000-0000000000aa','5ea50000-0000-0000-0000-000000000001',
            'school','Regression High');
  insert into contacts (id, organization_id, season_id, kind, full_name, email)
    values ('cc000000-0000-0000-0000-0000000000aa','0c000000-0000-0000-0000-0000000000aa',
            '5ea50000-0000-0000-0000-000000000001','teacher','Soft Test','soft@regression.example');
  insert into outreach_threads (contact_id, team_id, sender_id, subject, status, last_activity_at)
    values ('cc000000-0000-0000-0000-0000000000aa', null,
            'a0000000-0000-0000-0000-000000000001','t','sent', now() - interval '10 days');

  select 'baseline, in queue:        ' || count(*) || '  expect 1' from contacts c
   where c.id='cc000000-0000-0000-0000-0000000000aa' and not app.is_suppressed(c.id,'email');

  insert into suppressions (contact_id, channel, reason, blocks)
    values ('cc000000-0000-0000-0000-0000000000aa','email','soft_bounce',false);
  select 'after SOFT bounce, in queue: ' || count(*) || '  expect 1  <-- THE BUG' from contacts c
   where c.id='cc000000-0000-0000-0000-0000000000aa' and not app.is_suppressed(c.id,'email');

  insert into suppressions (contact_id, channel, reason, blocks)
    values ('cc000000-0000-0000-0000-0000000000aa','email','hard_bounce',true);
  select 'after HARD bounce, in queue: ' || count(*) || '  expect 0' from contacts c
   where c.id='cc000000-0000-0000-0000-0000000000aa' and not app.is_suppressed(c.id,'email');
rollback;

\echo '=== is_suppressed reads the seeded states correctly ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'D. Ramos  (soft bounce):    ' || app.is_suppressed('cc000000-0000-0000-0000-000000000005') || '  expect f';
  select 'Mr. P     (invalid addr):   ' || app.is_suppressed('cc000000-0000-0000-0000-000000000004') || '  expect t';
  select 'A. Byrne  (unsubscribed):   ' || app.is_suppressed('cc000000-0000-0000-0000-000000000008') || '  expect t';
  select 'R. Alvarez  (clean):          ' || app.is_suppressed('cc000000-0000-0000-0000-000000000001') || '  expect f';
  select 'phone channel for Mr. H:    ' || app.is_suppressed('cc000000-0000-0000-0000-000000000004','phone') || '  expect f';
commit;

\echo '=== a student cannot read teacher suppressions ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000005';
  select 'TEACHER SUPPRESSIONS LEAKED: ' || count(*) || '  expect 0' from suppressions;
commit;

\echo '=== contact_events is append-only, even for an admin ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'events visible: ' || count(*) || '  expect 3' from contact_events;
rollback;

\echo '--- admin UPDATE on contact_events (must affect 0 rows: no policy) ---'
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  update contact_events set kind='tampered';
  select 'rows tampered: ' || count(*) || '  expect 0' from contact_events where kind='tampered';
rollback;

\echo '--- admin DELETE on contact_events (must affect 0 rows: no policy) ---'
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  delete from contact_events;
  select 'events remaining: ' || count(*) || '  expect 3' from contact_events;
rollback;

\echo '=== the opt-out page cannot read contact data at all ==='
-- Worth asserting on its own: a leaked token discloses nothing, because the
-- page has no session and RLS hides contacts entirely. The token is only ever
-- usable as an argument to app.unsubscribe_by_token.
begin;
  set local app.user_id = '';
  select 'contacts readable with no session: ' || count(*) || '  expect 0' from contacts;
commit;

-- So the token must come from the email, not from a query. Capture it as an
-- admin first, exactly as the mail merge would.
--
-- Dedicated fixture: the opt-out assertion has to commit, and committing an
-- unliftable unsubscribe onto a seeded teacher would silently drop them from
-- the follow-up queue for every later test and every manual click-through.
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  insert into organizations (id, season_id, kind, name)
    values ('0c000000-0000-0000-0000-0000000000bb','5ea50000-0000-0000-0000-000000000001',
            'school','ZZ Test Fixture School')
    on conflict (season_id, kind, name) do nothing;
  insert into contacts (id, organization_id, season_id, kind, full_name, email)
    values ('cc000000-0000-0000-0000-0000000000bb','0c000000-0000-0000-0000-0000000000bb',
            '5ea50000-0000-0000-0000-000000000001','teacher',
            'ZZ Optout Fixture','optout-fixture@example.invalid')
    on conflict do nothing;
  select unsubscribe_token as tok
    from contacts where id='cc000000-0000-0000-0000-0000000000bb' \gset
commit;

\echo '=== opt-out works with NO session, and is idempotent ==='
-- Committed, because the verification has to happen as an admin: the function
-- is security definer so the insert succeeds, but a sessionless caller cannot
-- read suppressions back to check -- which is correct, and is why this is
-- asserted in a second transaction rather than the same one.
begin;
  set local app.user_id = '';
  select 'first call:  ' || app.unsubscribe_by_token(:'tok', 'rls test') || '  expect t';
  select 'second call: ' || app.unsubscribe_by_token(:'tok', 'rls test') || '  expect t';
  select 'bogus token: ' || app.unsubscribe_by_token('nope-nope-nope-nope', null) || '  expect f';
commit;

begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'rows written by two calls: ' || count(*) || '  expect 1 (idempotent)'
    from suppressions where contact_id='cc000000-0000-0000-0000-0000000000bb';
  select 'reason/blocks:             ' || reason || '/' || blocks || '  expect unsubscribed/true'
    from suppressions where contact_id='cc000000-0000-0000-0000-0000000000bb';
  select 'now suppressed:            ' || app.is_suppressed('cc000000-0000-0000-0000-0000000000bb') || '  expect t';
  select 'event logged with no actor: ' || count(*) || '  expect 1'
    from contact_events
   where contact_id='cc000000-0000-0000-0000-0000000000bb'
     and kind='suppressed' and actor_id is null;
  -- Guard: the committing test must not have touched a seeded teacher.
  -- R. Alvarez is the one an earlier version of this test wrongly unsubscribed.
  select 'R. Alvarez untouched:        ' || count(*) || '  expect 0'
    from suppressions where contact_id='cc000000-0000-0000-0000-000000000001';
commit;

\echo '=== suppression history survives: two rows for one contact ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  insert into suppressions (contact_id, channel, reason, blocks)
    values ('cc000000-0000-0000-0000-000000000005','email','soft_bounce',false);
  select 'D. Ramos suppression rows: ' || count(*) || '  expect 2 (history kept)'
    from suppressions where contact_id='cc000000-0000-0000-0000-000000000005';
  select 'still emailable:           ' || app.is_suppressed('cc000000-0000-0000-0000-000000000005') || '  expect f';
rollback;

-- ========================= PHASE 2a (email) ================================

\echo '=== bounce mapping: soft must not block, hard must ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';

  -- Transient / full mailbox. The whole point: still reachable.
  select 'transient -> contact: ' || coalesce(
    app.apply_delivery_event(null,'mquinn@westgate.example','soft_bounce',false,'mailbox full')::text,
    'no match') as r;
  select 'after transient, suppressed: ' || app.is_suppressed(id,'email') || '  expect f'
    from contacts where email='mquinn@westgate.example';

  -- Permanent.
  select 'permanent -> contact: ' || coalesce(
    app.apply_delivery_event(null,'mquinn@westgate.example','hard_bounce',true,'no such user')::text,
    'no match') as r;
  select 'after permanent, suppressed: ' || app.is_suppressed(id,'email') || '  expect t'
    from contacts where email='mquinn@westgate.example';
rollback;

\echo '=== a blocking webhook suppression is not duplicated by provider retries ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select app.apply_delivery_event(null,'tiverson@westgate.example','hard_bounce',true,'first') \gset x_
  select app.apply_delivery_event(null,'tiverson@westgate.example','hard_bounce',true,'again') \gset y_
  select 'blocking rows after 2 identical events: ' || count(*) || '  expect 1'
    from suppressions s join contacts c on c.id=s.contact_id
   where c.email='tiverson@westgate.example' and s.blocks;
rollback;

\echo '=== repeat SOFT bounces accumulate (they are the organiser signal) ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select app.apply_delivery_event(null,'mquinn@westgate.example','soft_bounce',false,'one') \gset a_
  select app.apply_delivery_event(null,'mquinn@westgate.example','soft_bounce',false,'two') \gset b_
  select 'soft rows: ' || count(*) || '  expect 2'
    from suppressions s join contacts c on c.id=s.contact_id
   where c.email='mquinn@westgate.example' and s.reason='soft_bounce';
  select 'still emailable: ' || app.is_suppressed(id,'email') || '  expect f'
    from contacts where email='mquinn@westgate.example';
rollback;

\echo '=== a bounce for a contact we no longer have is dropped, not retried ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'unknown recipient -> ' || coalesce(
    app.apply_delivery_event(null,'nobody@nowhere.example','hard_bounce',true,'x')::text,
    'null (correct)') as r;
rollback;

\echo '=== webhook_deliveries is unreachable from the app role ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'rows visible to admin: ' || count(*) || '  expect 0 (RLS, no policy)'
    from webhook_deliveries;
commit;

\echo '=== record_webhook is idempotent and reports duplicates as NULL ==='
begin;
  set local app.user_id = '';
  select 'first:  ' || coalesce(app.record_webhook('resend','evt_rls_1','email.bounced','{}')::text,'null')
         || '  expect an id';
  select 'repeat: ' || coalesce(app.record_webhook('resend','evt_rls_1','email.bounced','{}')::text,'null')
         || '  expect null';
rollback;

-- The token reaches the webhook from the recipient's Reply-To, never from a
-- query -- a sessionless read of outreach_threads returns nothing, by design.
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select reply_token as rtok
    from outreach_threads where id='c0000000-0000-0000-0000-000000000001' \gset
commit;

\echo '=== reply token resolves to the thread owner, with no session ==='
begin;
  set local app.user_id = '';
  select 'threads readable sessionless: ' || count(*) || '  expect 0' from outreach_threads;
  select 'known token -> sender: ' ||
    coalesce(app.thread_sender_by_token(:'rtok')::text,'null') || '  expect a uuid';
  select 'bogus token -> ' ||
    coalesce(app.thread_sender_by_token('nope')::text,'null (correct)');
rollback;

\echo '=== send cap counts per team, and per sender for recruiting ==='
begin;
  set local app.user_id = 'a0000000-0000-0000-0000-000000000001';
  select 'team baseline:   ' || app.sends_last_day('7ea50000-0000-0000-0000-000000000001', null) || '  expect 0';
  insert into send_log (team_id, sender_id)
    values ('7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005');
  select 'after one send:  ' || app.sends_last_day('7ea50000-0000-0000-0000-000000000001', null) || '  expect 1';
  select 'other team:      ' || app.sends_last_day('7ea50000-0000-0000-0000-000000000002', null) || '  expect 0';
  insert into send_log (team_id, sender_id)
    values (null,'a0000000-0000-0000-0000-000000000001');
  select 'organiser count: ' || app.sends_last_day(null,'a0000000-0000-0000-0000-000000000001') || '  expect 1';
rollback;
