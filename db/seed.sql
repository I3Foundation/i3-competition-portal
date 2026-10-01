-- Demo data so the portal is clickable immediately. Not for production.

insert into seasons (id, name, starts_on, ends_on, is_active) values
  ('5ea50000-0000-0000-0000-000000000001', 'Fall 2026', '2026-09-08', '2026-12-18', true);

-- profiles.id references auth.users(id); locally that table is the shim.
insert into auth.users (id) values
  ('a0000000-0000-0000-0000-000000000001'),('a0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000003'),('a0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000005'),('a0000000-0000-0000-0000-000000000006'),
  ('a0000000-0000-0000-0000-000000000007'),('a0000000-0000-0000-0000-000000000008'),
  ('a0000000-0000-0000-0000-000000000009'),('a0000000-0000-0000-0000-00000000000a'),
  ('a0000000-0000-0000-0000-00000000000b'),('a0000000-0000-0000-0000-00000000000c');

insert into profiles (id, email, full_name, role) values
  ('a0000000-0000-0000-0000-000000000001','admin@i3competition.com','Dana Whitfield','admin'),
  ('a0000000-0000-0000-0000-000000000002','sokafor@example.com','Sam Okafor','mentor'),
  ('a0000000-0000-0000-0000-000000000003','rchen@example.com','Rita Chen','mentor'),
  ('a0000000-0000-0000-0000-000000000004','mdiallo@example.com','Marcus Diallo','mentor'),
  ('a0000000-0000-0000-0000-000000000005','jordan.r@example.edu','Jordan Rivera','student'),
  ('a0000000-0000-0000-0000-000000000006','amina.k@example.edu','Amina Khalil','student'),
  ('a0000000-0000-0000-0000-000000000007','tyler.b@example.edu','Tyler Brooks','student'),
  ('a0000000-0000-0000-0000-000000000008','priya.n@example.edu','Priya Nair','student'),
  ('a0000000-0000-0000-0000-000000000009','luis.o@example.edu','Luis Ortega','student'),
  ('a0000000-0000-0000-0000-00000000000a','grace.l@example.edu','Grace Lim','student'),
  ('a0000000-0000-0000-0000-00000000000b','devon.h@example.edu','Devon Hayes','student'),
  ('a0000000-0000-0000-0000-00000000000c','sofia.m@example.edu','Sofia Marin','student');

insert into teams (id, season_id, name, school, team_email) values
  ('7ea50000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','Northside Devs','Northside High','northside@i3competition.com'),
  ('7ea50000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001','Lincoln Labs','Lincoln High','lincoln@i3competition.com'),
  ('7ea50000-0000-0000-0000-000000000003','5ea50000-0000-0000-0000-000000000001','Eastview Collective','Eastview High','eastview@i3competition.com');

insert into team_members (team_id, profile_id, season_id, is_lead) values
  ('7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005','5ea50000-0000-0000-0000-000000000001',true),
  ('7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006','5ea50000-0000-0000-0000-000000000001',false),
  ('7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000007','5ea50000-0000-0000-0000-000000000001',false),
  ('7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000008','5ea50000-0000-0000-0000-000000000001',true),
  ('7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000009','5ea50000-0000-0000-0000-000000000001',false),
  ('7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-00000000000a','5ea50000-0000-0000-0000-000000000001',false),
  ('7ea50000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000b','5ea50000-0000-0000-0000-000000000001',true),
  ('7ea50000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000c','5ea50000-0000-0000-0000-000000000001',false);

insert into mentor_profiles (profile_id, bio, expertise, meeting_link) values
  ('a0000000-0000-0000-0000-000000000002','15 years in local SEO and small business web presence.','{SEO,"Web Design",Analytics}','https://zoom.us/j/0000000001'),
  ('a0000000-0000-0000-0000-000000000003','Product designer. Focused on UX research and usability testing.','{"UI Design","User Research",Figma}','https://zoom.us/j/0000000002'),
  ('a0000000-0000-0000-0000-000000000004','Growth marketing consultant for restaurants and retail.','{"Social Media",Branding,"Email Marketing"}','https://zoom.us/j/0000000003');

-- ============================== RECRUITING =================================
-- Schools and the teachers we contact to bring teams in. Shaped after the
-- spreadsheet this replaces: teacher, email, school, replied?, last contacted,
-- notes. All addresses use .example, which cannot resolve -- nothing here can
-- accidentally email a real person.

insert into organizations (id, season_id, kind, name, category, added_by) values
  ('0c000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','school','Brookfield Charter School','Charter','a0000000-0000-0000-0000-000000000001'),
  ('0c000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001','school','Carverton High School East','Public','a0000000-0000-0000-0000-000000000001'),
  ('0c000000-0000-0000-0000-000000000003','5ea50000-0000-0000-0000-000000000001','school','Northside High School','Public','a0000000-0000-0000-0000-000000000001'),
  ('0c000000-0000-0000-0000-000000000004','5ea50000-0000-0000-0000-000000000001','school','Eastview High School','Public','a0000000-0000-0000-0000-000000000001'),
  ('0c000000-0000-0000-0000-000000000005','5ea50000-0000-0000-0000-000000000001','school','Riverbend Academy','Private','a0000000-0000-0000-0000-000000000001'),
  ('0c000000-0000-0000-0000-000000000006','5ea50000-0000-0000-0000-000000000001','school','Westgate STEM Magnet','Magnet','a0000000-0000-0000-0000-000000000001');

insert into contacts (id, organization_id, season_id, kind, full_name, email, role_title, notes, added_by) values
  -- three teachers at one school: the grouping a flat sheet cannot show
  ('cc000000-0000-0000-0000-000000000001','0c000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','teacher','R. Alvarez','ralvarez@brookfield.example','CS teacher',null,'a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000002','0c000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','teacher','T. Nakamura','tnakamura@brookfield.example','Business teacher',null,'a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000003','0c000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','teacher',null,'careers@brookfield.example','Careers office','Front desk address, no name given','a0000000-0000-0000-0000-000000000001'),
  -- the "Unable to send" row: now a first-class state, not a note
  ('cc000000-0000-0000-0000-000000000004','0c000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001','teacher','Mr. P','mp.sanders@carverton.example','Teacher','Address bounced on first attempt','a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000005','0c000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001','teacher','D. Ramos','dramos@carverton.example','CTE coordinator',null,'a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000006','0c000000-0000-0000-0000-000000000003','5ea50000-0000-0000-0000-000000000001','teacher','K. Osei','kosei@northside.example','CS teacher','Replied, wants a call','a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000007','0c000000-0000-0000-0000-000000000004','5ea50000-0000-0000-0000-000000000001','teacher','P. Sandoval','psandoval@eastview.example','Robotics club',null,'a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-000000000008','0c000000-0000-0000-0000-000000000005','5ea50000-0000-0000-0000-000000000001','teacher','A. Byrne','abyrne@riverbend.example','Head of technology',null,'a0000000-0000-0000-0000-000000000001'),
  -- never contacted: shows up as "not yet contacted", distinct from "no reply"
  ('cc000000-0000-0000-0000-000000000009','0c000000-0000-0000-0000-000000000006','5ea50000-0000-0000-0000-000000000001','teacher','T. Iverson','tiverson@westgate.example','STEM lead',null,'a0000000-0000-0000-0000-000000000001'),
  ('cc000000-0000-0000-0000-00000000000a','0c000000-0000-0000-0000-000000000006','5ea50000-0000-0000-0000-000000000001','teacher','M. Quinn','mquinn@westgate.example','Counsellor',null,'a0000000-0000-0000-0000-000000000001');

-- The spreadsheet's "Unable to send" row, now a first-class suppression that
-- outlives any single attempt.
insert into suppressions (contact_id, channel, reason, blocks, comment, source, created_by) values
  ('cc000000-0000-0000-0000-000000000004','email','invalid_address',true,
   'Address bounced on first attempt','import','a0000000-0000-0000-0000-000000000001');

-- A SOFT bounce: recorded, visible, and deliberately NOT blocking. D. Ramos
-- must still appear in the follow-up queue. This is the Mautic #9190 case.
insert into suppressions (contact_id, channel, reason, blocks, comment, source, created_by) values
  ('cc000000-0000-0000-0000-000000000005','email','soft_bounce',false,
   'Mailbox full','webhook','a0000000-0000-0000-0000-000000000001');

-- One teacher has opted out. Permanent and unliftable.
insert into suppressions (contact_id, channel, reason, blocks, comment, source) values
  ('cc000000-0000-0000-0000-000000000008','email','unsubscribed',true,
   'Not interested this year','recipient');

insert into contact_events (contact_id, kind, actor_id, detail) values
  ('cc000000-0000-0000-0000-000000000004','suppressed','a0000000-0000-0000-0000-000000000001','{"reason":"invalid_address"}'),
  ('cc000000-0000-0000-0000-000000000005','suppressed','a0000000-0000-0000-0000-000000000001','{"reason":"soft_bounce"}'),
  ('cc000000-0000-0000-0000-000000000008','suppressed',null,'{"reason":"unsubscribed","source":"recipient"}');

-- Recruiting threads carry team_id = null: organiser work, invisible to students.
insert into outreach_threads (id, contact_id, team_id, sender_id, subject, status, last_activity_at) values
  ('c0000000-0000-0000-0000-000000000011','cc000000-0000-0000-0000-000000000001',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - inviting Brookfield Charter','sent',      now() - interval '24 days'),
  ('c0000000-0000-0000-0000-000000000012','cc000000-0000-0000-0000-000000000002',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - inviting Brookfield Charter','sent',      now() - interval '11 days'),
  ('c0000000-0000-0000-0000-000000000013','cc000000-0000-0000-0000-000000000004',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - Carverton East','bounced',            now() - interval '24 days'),
  ('c0000000-0000-0000-0000-000000000014','cc000000-0000-0000-0000-000000000005',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - Carverton East','sent',               now() - interval '3 days'),
  ('c0000000-0000-0000-0000-000000000015','cc000000-0000-0000-0000-000000000006',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - Northside','interested',                 now() - interval '2 days'),
  ('c0000000-0000-0000-0000-000000000016','cc000000-0000-0000-0000-000000000007',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - Eastview','replied',                     now() - interval '6 days'),
  ('c0000000-0000-0000-0000-000000000017','cc000000-0000-0000-0000-000000000008',null,'a0000000-0000-0000-0000-000000000001','I3 Competition - Riverbend','declined',                   now() - interval '9 days');

-- ============================== PARTNERING =================================
-- Businesses that student teams pair with. Same tables, different kind.

insert into organizations (id, season_id, kind, name, category, address, added_by) values
  ('0b000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','business','Rosa''s Panaderia','Bakery','412 W Foster Ave','a0000000-0000-0000-0000-000000000005'),
  ('0b000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001','business','Uptown Cuts Barbershop','Barbershop','1290 N Ashland','a0000000-0000-0000-0000-000000000005'),
  ('0b000000-0000-0000-0000-000000000003','5ea50000-0000-0000-0000-000000000001','business','Green Leaf Grocery','Grocery','88 Devon St','a0000000-0000-0000-0000-000000000008'),
  ('0b000000-0000-0000-0000-000000000004','5ea50000-0000-0000-0000-000000000001','business','Batey Auto Repair','Auto','2201 S Kedzie','a0000000-0000-0000-0000-000000000008'),
  ('0b000000-0000-0000-0000-000000000005','5ea50000-0000-0000-0000-000000000001','business','Lotus Nail Studio','Salon','740 Clark St','a0000000-0000-0000-0000-00000000000b'),
  ('0b000000-0000-0000-0000-000000000006','5ea50000-0000-0000-0000-000000000001','business','Southside Books','Retail','3310 S Halsted','a0000000-0000-0000-0000-00000000000b'),
  ('0b000000-0000-0000-0000-000000000007','5ea50000-0000-0000-0000-000000000001','business','Taqueria El Sol','Restaurant','1615 W 18th St',null),
  ('0b000000-0000-0000-0000-000000000008','5ea50000-0000-0000-0000-000000000001','business','Bright Start Daycare','Childcare','905 E 79th St',null),
  ('0b000000-0000-0000-0000-000000000009','5ea50000-0000-0000-0000-000000000001','business','Pedal Pusher Bikes','Retail','2044 N Milwaukee',null),
  ('0b000000-0000-0000-0000-00000000000a','5ea50000-0000-0000-0000-000000000001','business','Harmony Music Lessons','Education','617 Oak Park Ave',null),
  ('0b000000-0000-0000-0000-00000000000b','5ea50000-0000-0000-0000-000000000001','business','Cornerstone Tailoring','Services','129 S State St',null),
  ('0b000000-0000-0000-0000-00000000000c','5ea50000-0000-0000-0000-000000000001','business','Fresh Fade Studio','Salon','5501 S Lake Park',null);

insert into contacts (id, organization_id, season_id, kind, full_name, email, phone, role_title) values
  ('cb000000-0000-0000-0000-000000000001','0b000000-0000-0000-0000-000000000001','5ea50000-0000-0000-0000-000000000001','business_owner','Rosa Delgado','rosa@rosaspan.example','555-0101','Owner'),
  ('cb000000-0000-0000-0000-000000000002','0b000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001','business_owner','Andre Mills','andre@uptowncuts.example','555-0102','Owner'),
  ('cb000000-0000-0000-0000-000000000003','0b000000-0000-0000-0000-000000000003','5ea50000-0000-0000-0000-000000000001','business_owner','Mei Tan','mei@greenleaf.example','555-0103','Owner'),
  ('cb000000-0000-0000-0000-000000000004','0b000000-0000-0000-0000-000000000004','5ea50000-0000-0000-0000-000000000001','business_owner','Hector Batey','hector@bateyauto.example','555-0104','Owner'),
  ('cb000000-0000-0000-0000-000000000005','0b000000-0000-0000-0000-000000000005','5ea50000-0000-0000-0000-000000000001','business_owner','Kim Tran','kim@lotusnails.example','555-0105','Owner'),
  ('cb000000-0000-0000-0000-000000000006','0b000000-0000-0000-0000-000000000006','5ea50000-0000-0000-0000-000000000001','business_owner','Naomi Price','naomi@southsidebooks.example','555-0106','Owner'),
  ('cb000000-0000-0000-0000-000000000007','0b000000-0000-0000-0000-000000000007','5ea50000-0000-0000-0000-000000000001','business_owner','Javier Nunez','javier@elsol.example','555-0107','Owner'),
  ('cb000000-0000-0000-0000-000000000008','0b000000-0000-0000-0000-000000000008','5ea50000-0000-0000-0000-000000000001','business_owner','Yvonne Adeyemi','yvonne@brightstart.example','555-0108','Owner'),
  ('cb000000-0000-0000-0000-000000000009','0b000000-0000-0000-0000-000000000009','5ea50000-0000-0000-0000-000000000001','business_owner','Cal Nystrom','cal@pedalpusher.example','555-0109','Owner'),
  ('cb000000-0000-0000-0000-00000000000a','0b000000-0000-0000-0000-00000000000a','5ea50000-0000-0000-0000-000000000001','business_owner','Dee Robinson','dee@harmonymusic.example','555-0110','Owner'),
  ('cb000000-0000-0000-0000-00000000000b','0b000000-0000-0000-0000-00000000000b','5ea50000-0000-0000-0000-000000000001','business_owner','Ahmed Siddiqui','ahmed@cornerstonetailor.example','555-0111','Owner'),
  ('cb000000-0000-0000-0000-00000000000c','0b000000-0000-0000-0000-00000000000c','5ea50000-0000-0000-0000-000000000001','business_owner','Trina Okoye','trina@freshfade.example','555-0112','Owner');

insert into claims (organization_id, team_id, claimed_by, status) values
  ('0b000000-0000-0000-0000-000000000001','7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005','active'),
  ('0b000000-0000-0000-0000-000000000002','7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005','active'),
  ('0b000000-0000-0000-0000-000000000003','7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000008','active'),
  ('0b000000-0000-0000-0000-000000000005','7ea50000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000b','active'),
  ('0b000000-0000-0000-0000-000000000004','7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000008','released');

insert into outreach_threads (id, contact_id, team_id, sender_id, subject, status, last_activity_at) values
  ('c0000000-0000-0000-0000-000000000001','cb000000-0000-0000-0000-000000000001','7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000005','Free website help for Rosa''s Panaderia','interested', now() - interval '2 days'),
  ('c0000000-0000-0000-0000-000000000002','cb000000-0000-0000-0000-000000000002','7ea50000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000006','Students offering free digital help','sent', now() - interval '9 days'),
  ('c0000000-0000-0000-0000-000000000003','cb000000-0000-0000-0000-000000000003','7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000008','Partnership with Lincoln High students','replied', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000004','cb000000-0000-0000-0000-000000000005','7ea50000-0000-0000-0000-000000000003','a0000000-0000-0000-0000-00000000000b','Eastview students - free web design','no_response', now() - interval '12 days');

insert into messages (thread_id, direction, from_email, to_email, subject, body_text, sent_at) values
  ('c0000000-0000-0000-0000-000000000001','outbound','outreach@mail.i3competition.com','rosa@rosaspan.example','Free website help for Rosa''s Panaderia','Hi Rosa, we are students with the I3 Competition...', now() - interval '5 days'),
  ('c0000000-0000-0000-0000-000000000001','inbound','rosa@rosaspan.example','r+abc123@mail.i3competition.com','Re: Free website help','This sounds wonderful! Can we talk next week?', now() - interval '2 days'),
  ('c0000000-0000-0000-0000-000000000003','outbound','outreach@mail.i3competition.com','mei@greenleaf.example','Partnership with Lincoln High students','Hello Ms. Tan, we are a team of students...', now() - interval '4 days'),
  ('c0000000-0000-0000-0000-000000000003','inbound','mei@greenleaf.example','r+def456@mail.i3competition.com','Re: Partnership','What exactly would you need from me?', now() - interval '1 day'),
  ('c0000000-0000-0000-0000-000000000015','inbound','kosei@northside.example','r+ghi789@mail.i3competition.com','Re: I3 Competition','Yes - I have two groups who would be keen. When do you need names?', now() - interval '2 days');

-- ============================== TEMPLATES ==================================
-- Editable in the database so changing the pitch is not a deploy.
-- Placeholders: {{first_name}}, {{org_name}}, {{sender_name}}.

insert into email_templates (season_id, kind, name, subject, body_text) values
  ('5ea50000-0000-0000-0000-000000000001','teacher','First invitation',
   'Inviting {{org_name}} to the I3 Competition',
   'Hi {{first_name}},' || chr(10) || chr(10) ||
   'I am writing from the I3 Competition, a program that pairs high school students with local small business owners to build them websites, apps and social media campaigns over about 14 weeks. It is free for the students and free for the businesses.' || chr(10) || chr(10) ||
   'We are looking for teachers at {{org_name}} who might know a few students who would get something out of it. Over 80% of participating teams are offered a summer internship by the business they worked with.' || chr(10) || chr(10) ||
   'Would you be open to a 15 minute call, or happy for me to send a one-page summary you could pass along?' || chr(10) || chr(10) ||
   'Thank you for your time,' || chr(10) || '{{sender_name}}'),

  ('5ea50000-0000-0000-0000-000000000001','teacher','Follow-up',
   'Re: Inviting {{org_name}} to the I3 Competition',
   'Hi {{first_name}},' || chr(10) || chr(10) ||
   'Just following up on my note about the I3 Competition in case it got buried. No problem at all if it is not a fit this year -- a one-line reply either way would really help me plan.' || chr(10) || chr(10) ||
   'Thanks,' || chr(10) || '{{sender_name}}'),

  ('5ea50000-0000-0000-0000-000000000001','business_owner','First approach',
   'Free website help for {{org_name}}',
   'Hello {{first_name}},' || chr(10) || chr(10) ||
   'We are a team of high school students taking part in the I3 Competition. Over the next few months we build a website, app or social media presence for a local business, at no cost and with mentoring from professional designers and developers.' || chr(10) || chr(10) ||
   'We would love to do that for {{org_name}}. It would need about an hour of your time up front to understand what you need, and occasional feedback after that.' || chr(10) || chr(10) ||
   'Would you be interested in hearing more?' || chr(10) || chr(10) ||
   'Thank you,' || chr(10) || '{{sender_name}}');

-- ============================== SCHEDULING =================================
-- Weekly mentor availability. weekday: 0=Sunday.
insert into availability_rules (mentor_id, season_id, weekday, start_time, end_time, slot_minutes) values
  ('a0000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001',2,'16:00','18:00',30),
  ('a0000000-0000-0000-0000-000000000002','5ea50000-0000-0000-0000-000000000001',4,'16:00','17:30',30),
  ('a0000000-0000-0000-0000-000000000003','5ea50000-0000-0000-0000-000000000001',3,'17:00','19:00',30),
  ('a0000000-0000-0000-0000-000000000004','5ea50000-0000-0000-0000-000000000001',1,'18:00','20:00',60),
  ('a0000000-0000-0000-0000-000000000004','5ea50000-0000-0000-0000-000000000001',6,'10:00','12:00',60);

-- Materialize the next 4 weeks of slots from those rules.
insert into slots (mentor_id, season_id, starts_at, ends_at, meeting_link)
select r.mentor_id, r.season_id, s.slot_start,
       s.slot_start + make_interval(mins => r.slot_minutes), mp.meeting_link
  from availability_rules r
  join mentor_profiles mp on mp.profile_id = r.mentor_id
  cross join lateral (
    select d::date as day from generate_series(current_date, current_date + 27, '1 day') d
     where extract(dow from d) = r.weekday
  ) days
  cross join lateral generate_series(
    (days.day + r.start_time) at time zone mp.timezone,
    (days.day + r.end_time) at time zone mp.timezone - make_interval(mins => r.slot_minutes),
    make_interval(mins => r.slot_minutes)
  ) as s(slot_start)
on conflict (mentor_id, starts_at) do nothing;

-- One slot already taken, so the booked state is visible.
insert into bookings (slot_id, team_id, booked_by, topic)
select id, '7ea50000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000008',
       'Feedback on our homepage wireframe'
  from slots where status='open' order by starts_at limit 1;

update slots set status='booked'
 where id in (select slot_id from bookings);

