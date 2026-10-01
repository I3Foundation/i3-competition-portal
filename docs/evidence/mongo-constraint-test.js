const d = db.getSiblingDB('i3');
d.dropDatabase();

function t(label, expect, fn) {
  let ok = true, err = '';
  try { fn(); } catch (e) { ok = false; err = (e.codeName || e.code || '') + ''; }
  const got = ok ? 'ALLOWED' : 'BLOCKED';
  const pass = (got === expect);
  print(`${pass ? '  PASS' : '  FAIL'}  [${got}]  ${label}${err ? '  (' + err + ')' : ''}`);
}

// ---- indexes: the closest MongoDB equivalents to the Postgres constraints ----
d.claims.createIndex({ business_id: 1 }, {
  unique: true, partialFilterExpression: { status: 'active' }, name: 'one_active_claim' });

d.businesses.createIndex({ season_id: 1, email: 1 }, {
  unique: true,
  partialFilterExpression: { email: { $type: 'string' } },
  collation: { locale: 'en', strength: 2 },     // case-insensitive, ~= citext
  name: 'unique_email_per_season' });

d.team_members.createIndex({ profile_id: 1, season_id: 1 }, { unique: true, name: 'one_team_per_season' });
d.bookings.createIndex({ slot_id: 1 }, { unique: true, name: 'no_double_booking' });
d.seasons.createIndex({ is_active: 1 }, {
  unique: true, partialFilterExpression: { is_active: true }, name: 'one_active_season' });
d.notifications.createIndex({ booking_id: 1, kind: 1 }, { unique: true, name: 'notify_once' });

print('\n=== indexes created OK ===\n');

// ---- fixtures ----
d.seasons.insertOne({ _id: 's1', name: 'Spring 2026', is_active: true });
d.teams.insertMany([{ _id: 'tA', season_id: 's1', name: 'Team A' },
                    { _id: 'tB', season_id: 's1', name: 'Team B' }]);
d.businesses.insertOne({ _id: 'b1', season_id: 's1', name: "Joe's Bakery", email: 'joe@bakery.com' });
d.slots.insertOne({ _id: 'sl1', mentor_id: 'm1', season_id: 's1' });

print('--- TEST 1: two teams claim the same business ---');
d.claims.insertOne({ business_id: 'b1', team_id: 'tA', status: 'active' });
t('2nd claim on same business', 'BLOCKED',
  () => d.claims.insertOne({ business_id: 'b1', team_id: 'tB', status: 'active' }));

print('--- TEST 2: release, then another team claims ---');
d.claims.updateOne({ team_id: 'tA' }, { $set: { status: 'released' } });
t('reclaim after release', 'ALLOWED',
  () => d.claims.insertOne({ business_id: 'b1', team_id: 'tB', status: 'active' }));

print('--- TEST 3: duplicate business email in season ---');
t('exact duplicate email', 'BLOCKED',
  () => d.businesses.insertOne({ season_id: 's1', name: 'Joes Bakery LLC', email: 'joe@bakery.com' }));

print('--- TEST 3b: case-variant email ---');
t('JOE@Bakery.com vs joe@bakery.com', 'BLOCKED',
  () => d.businesses.insertOne({ season_id: 's1', name: 'Joe Bakery', email: 'JOE@Bakery.com' }));

print('--- TEST 4: student on two teams in one season ---');
d.team_members.insertOne({ team_id: 'tA', profile_id: 'p1', season_id: 's1' });
t('same student, 2nd team', 'BLOCKED',
  () => d.team_members.insertOne({ team_id: 'tB', profile_id: 'p1', season_id: 's1' }));

print('--- TEST 4b: member season_id that contradicts its team ---');
t('tB is season s1, member claims s99', 'BLOCKED',
  () => d.team_members.insertOne({ team_id: 'tB', profile_id: 'p2', season_id: 's99' }));

print('--- TEST 5: two teams book the same slot ---');
d.bookings.insertOne({ slot_id: 'sl1', team_id: 'tA' });
t('2nd booking on same slot', 'BLOCKED',
  () => d.bookings.insertOne({ slot_id: 'sl1', team_id: 'tB' }));

print('--- TEST 6: two active seasons ---');
t('2nd is_active season', 'BLOCKED',
  () => d.seasons.insertOne({ _id: 's2', name: 'Fall 2026', is_active: true }));

print('--- TEST 7: duplicate reminder ---');
d.notifications.insertOne({ booking_id: 'bk1', kind: 'reminder_24h' });
t('same reminder twice', 'BLOCKED',
  () => d.notifications.insertOne({ booking_id: 'bk1', kind: 'reminder_24h' }));

print('--- TEST 8: claim pointing at a business that does not exist ---');
t('orphan claim (no FK)', 'BLOCKED',
  () => d.claims.insertOne({ business_id: 'GHOST', team_id: 'tA', status: 'active' }));

print('--- TEST 9: delete the season, do its teams cascade away? ---');
d.seasons.deleteOne({ _id: 's1' });
const orphans = d.teams.countDocuments({ season_id: 's1' });
print(`  ${orphans === 0 ? 'PASS  [CASCADED]' : 'FAIL  [ORPHANED]'}  ${orphans} team(s) still reference deleted season s1`);
