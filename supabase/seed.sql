-- ============================================================================
-- Own Your Study Portal — development seed
-- ----------------------------------------------------------------------------
-- The same fiction the in-memory demo mode serves, written into a real
-- database so the RLS policies can be exercised against actual sessions.
--
--   psql "$DATABASE_URL" -f supabase/seed.sql
--   -- or --
--   supabase db reset          (runs migrations, then this file)
--
-- ⚠ DEVELOPMENT ONLY. Every account below shares one well-known password and
-- every person is invented. Running this against production would create real,
-- signed-in-able accounts. The guard at the top refuses to run unless the
-- database is explicitly marked as a development one.
--
-- To mark a database as safe to seed:
--   comment on database postgres is 'own-your-study-dev';
-- ============================================================================

-- pgcrypto lives in the `extensions` schema on Supabase and in `public` on a
-- plain Postgres. Naming both means crypt() resolves either way; a schema that
-- does not exist is ignored rather than an error.
set search_path = public, extensions;

do $$
begin
  if coalesce(
       shobj_description((select oid from pg_database where datname = current_database()), 'pg_database'),
       ''
     ) not like '%own-your-study-dev%'
     and current_setting('oys.allow_seed', true) is distinct from 'yes'
  then
    raise exception using
      message = 'Refusing to seed: this database is not marked as a development database.',
      hint = 'Run:  comment on database ' || quote_ident(current_database())
             || ' is ''own-your-study-dev'';   (or set oys.allow_seed = ''yes'' for one session)';
  end if;
end;
$$;

-- ---------------------------------------------------------------------------
-- Accounts. Created directly in auth.users because there is no mail server in
-- a local stack; the handle_new_user trigger builds the profile and the
-- role-specific row from raw_user_meta_data.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.seed_user(
  p_id uuid,
  p_email text,
  p_first text,
  p_last text,
  p_role text
) returns void
language plpgsql
as $$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
    -- Some GoTrue versions declare these NOT NULL without a default, so they
    -- are given empty strings rather than left to chance.
    confirmation_token, recovery_token, email_change, email_change_token_new,
    created_at, updated_at
  )
  values (
    p_id,
    '00000000-0000-0000-0000-000000000000',
    'authenticated',
    'authenticated',
    p_email,
    -- Password for every demo account: "ownyourstudy-dev"
    crypt('ownyourstudy-dev', gen_salt('bf')),
    now(),
    jsonb_build_object('provider', 'email', 'providers', array['email']),
    jsonb_build_object('role', p_role, 'first_name', p_first, 'last_name', p_last),
    '', '', '', '',
    now(),
    now()
  )
  on conflict (id) do nothing;

  -- Password sign-in needs a matching identity row; without it GoTrue accepts
  -- the user as existing but refuses the credentials.
  insert into auth.identities (
    provider_id, user_id, identity_data, provider, last_sign_in_at,
    created_at, updated_at
  )
  values (
    p_id::text,
    p_id,
    jsonb_build_object('sub', p_id::text, 'email', p_email, 'email_verified', true),
    'email',
    now(), now(), now()
  )
  on conflict do nothing;
end;
$$;

select pg_temp.seed_user('00000000-0000-0000-0000-00000000a001', 'sophia@demo.ownyourstudy.com',   'Sophia',   'Thompson', 'student');
select pg_temp.seed_user('00000000-0000-0000-0000-00000000a002', 'marcus@demo.ownyourstudy.com',   'Marcus',   'Adeyemi',  'student');
select pg_temp.seed_user('00000000-0000-0000-0000-00000000a003', 'theodora@demo.ownyourstudy.com', 'Theodora', 'Kirby',    'tutor');
select pg_temp.seed_user('00000000-0000-0000-0000-00000000a004', 'daniel@demo.ownyourstudy.com',   'Daniel',   'Ferreira', 'tutor');
select pg_temp.seed_user('00000000-0000-0000-0000-00000000a005', 'admin@demo.ownyourstudy.com',    'Rowan',    'Hale',     'admin');
select pg_temp.seed_user('00000000-0000-0000-0000-00000000a006', 'helen@demo.ownyourstudy.com',    'Helen',    'Thompson', 'parent');

-- ---------------------------------------------------------------------------
-- Detail on the role rows the trigger created.
-- ---------------------------------------------------------------------------
update public.students set
  programme = 'IB Diploma Programme',
  year_level = 'DP2',
  school = 'Highgate International School',
  ai_notetaker_consent = true,
  transcription_consent = true,
  guardian_consent_required = true,
  guardian_consent_received = true,
  consent_timestamp = now() - interval '96 days'
where profile_id = '00000000-0000-0000-0000-00000000a001';

update public.students set
  programme = 'A Level',
  year_level = 'Year 13',
  school = 'Wheatfield Sixth Form',
  ai_notetaker_consent = true,
  transcription_consent = true,
  guardian_consent_required = false,
  consent_timestamp = now() - interval '51 days'
where profile_id = '00000000-0000-0000-0000-00000000a002';

update public.tutors set
  headline = 'Chemistry — IB HL and A Level',
  bio = 'Oxford MChem. Ten years teaching IB Chemistry HL, with a particular interest in getting mechanisms to click before exam technique is layered on top.'
where profile_id = '00000000-0000-0000-0000-00000000a003';

update public.tutors set
  headline = 'Mathematics — IB AA HL and Further Maths',
  bio = 'Imperial MSci. Teaches Analysis and Approaches HL with a focus on proof fluency and calculus foundations.'
where profile_id = '00000000-0000-0000-0000-00000000a004';

insert into public.parent_students (parent_id, student_id, relationship)
select p.id, s.id, 'Parent'
from public.parents p, public.students s
where p.profile_id = '00000000-0000-0000-0000-00000000a006'
  and s.profile_id = '00000000-0000-0000-0000-00000000a001'
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Catalogue
-- ---------------------------------------------------------------------------
insert into public.subjects (name, curriculum, level, division) values
  ('Chemistry',      'IB',         'HL',     'ib'),
  ('Mathematics AA', 'IB',         'HL',     'ib'),
  ('Biology',        'GCSE',       null,     'alevel'),
  ('Chemistry',      'A Level',    null,     'alevel'),
  ('Biology',        'AP',         null,     'ap'),
  ('Medicine',       'University', 'Year 1', 'uni-studies')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Assignments — the rows that grant tutors their access.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.student_id(p_email text) returns uuid
language sql stable as $$
  select s.id from public.students s
  join public.profiles p on p.id = s.profile_id
  where lower(p.email) = lower(p_email);
$$;

create or replace function pg_temp.tutor_id(p_email text) returns uuid
language sql stable as $$
  select t.id from public.tutors t
  join public.profiles p on p.id = t.profile_id
  where lower(p.email) = lower(p_email);
$$;

create or replace function pg_temp.subject_id(p_curriculum text, p_name text, p_level text) returns uuid
language sql stable as $$
  select id from public.subjects
  where curriculum = p_curriculum and name = p_name
    and coalesce(level, '') = coalesce(p_level, '');
$$;

insert into public.tutor_student_subjects (tutor_id, student_id, subject_id, active) values
  (pg_temp.tutor_id('theodora@demo.ownyourstudy.com'), pg_temp.student_id('sophia@demo.ownyourstudy.com'), pg_temp.subject_id('IB', 'Chemistry', 'HL'), true),
  (pg_temp.tutor_id('daniel@demo.ownyourstudy.com'),   pg_temp.student_id('sophia@demo.ownyourstudy.com'), pg_temp.subject_id('IB', 'Mathematics AA', 'HL'), true),
  (pg_temp.tutor_id('theodora@demo.ownyourstudy.com'), pg_temp.student_id('marcus@demo.ownyourstudy.com'), pg_temp.subject_id('A Level', 'Chemistry', null), true)
on conflict do nothing;

insert into public.student_subjects (student_id, subject_id, active)
select student_id, subject_id, true from public.tutor_student_subjects
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- Lessons. Relative to now, so the dashboards always have a plausible today.
-- ---------------------------------------------------------------------------
create or replace function pg_temp.seed_lesson(
  p_student_email text,
  p_tutor_email text,
  p_curriculum text,
  p_subject text,
  p_level text,
  p_title text,
  p_days_from_now int,
  p_hour int,
  p_status public.lesson_status,
  p_published boolean,
  p_platform public.meeting_platform default 'google_meet'
) returns uuid
language plpgsql
as $$
declare
  v_when timestamptz;
  v_id uuid;
  v_ran boolean;
begin
  v_when := date_trunc('day', now() + make_interval(days => p_days_from_now))
            + make_interval(hours => p_hour);
  v_ran := v_when < now() and p_status <> 'cancelled';

  insert into public.lessons (
    student_id, tutor_id, subject_id, title, scheduled_at, duration_minutes,
    started_at, ended_at, meeting_url, meeting_platform, status, published,
    published_at, notetaker_enabled
  )
  values (
    pg_temp.student_id(p_student_email),
    pg_temp.tutor_id(p_tutor_email),
    pg_temp.subject_id(p_curriculum, p_subject, p_level),
    p_title,
    v_when,
    60,
    case when v_ran then v_when end,
    case when v_ran then v_when + interval '60 minutes' end,
    case p_platform
      when 'zoom'  then 'https://zoom.us/j/demo-own-your-study'
      when 'teams' then 'https://teams.microsoft.com/l/meetup-join/demo-own-your-study'
      else 'https://meet.google.com/oys-demo-room'
    end,
    p_platform,
    p_status,
    p_published,
    case when p_published then v_when + interval '150 minutes' end,
    true
  )
  returning id into v_id;

  return v_id;
end;
$$;

do $$
declare
  v_sn uuid;
  v_e12 uuid;
begin
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Atomic structure and periodicity', -63, 18, 'published', true);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Bonding and intermolecular forces', -56, 18, 'published', true);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Energetics: Hess''s law and bond enthalpies', -49, 18, 'published', true);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Equilibrium and Le Chatelier''s principle', -42, 18, 'published', true);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Acids and bases: pH, Ka and buffers', -35, 18, 'published', true);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Redox and electrochemical cells', -28, 18, 'published', true);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Organic chemistry: functional groups and nomenclature', -21, 18, 'published', true);

  v_sn := pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Organic chemistry: SN1 and SN2 mechanisms', -14, 18, 'published', true);
  v_e12 := pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Elimination reactions: E1 and E2', -2, 18, 'review_required', false);

  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', null, -1, 17, 'processing_transcript', false);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Reaction pathways and synthesis routes', 2, 18, 'scheduled', false);
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'IB', 'Chemistry', 'HL', 'Spectroscopy: IR, MS and NMR', 9, 18, 'scheduled', false);

  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'daniel@demo.ownyourstudy.com', 'IB', 'Mathematics AA', 'HL', 'Differentiation: chain, product and quotient rules', -30, 17, 'published', true, 'zoom');
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'daniel@demo.ownyourstudy.com', 'IB', 'Mathematics AA', 'HL', 'Integration by substitution', -16, 17, 'published', true, 'zoom');
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'daniel@demo.ownyourstudy.com', 'IB', 'Mathematics AA', 'HL', 'Proof by induction', -9, 17, 'published', true, 'zoom');
  perform pg_temp.seed_lesson('sophia@demo.ownyourstudy.com', 'daniel@demo.ownyourstudy.com', 'IB', 'Mathematics AA', 'HL', 'Vectors: lines and planes', 4, 17, 'scheduled', false, 'zoom');

  perform pg_temp.seed_lesson('marcus@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'A Level', 'Chemistry', null, 'Rate equations and orders of reaction', -10, 16, 'published', true, 'teams');
  perform pg_temp.seed_lesson('marcus@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'A Level', 'Chemistry', null, 'Transition metals and complex ions', -4, 16, 'review_required', false, 'teams');
  perform pg_temp.seed_lesson('marcus@demo.ownyourstudy.com', 'theodora@demo.ownyourstudy.com', 'A Level', 'Chemistry', null, 'Buffers and titration curves', 0, 16, 'scheduled', false, 'teams');

  -- ---- Notes on the two organic chemistry lessons -------------------------
  insert into public.lesson_notes (
    lesson_id, summary, topics_covered, key_concepts, strengths,
    areas_for_improvement, misconceptions, homework, resources_mentioned,
    next_steps, tutor_private_notes, ai_generated, ai_model, ai_generated_at,
    tutor_reviewed
  ) values (
    v_sn,
    'We covered nucleophilic substitution in halogenoalkanes and, in particular, how to choose between SN1 and SN2 for a given reaction. You arrived already able to state the mechanistic difference, so the lesson concentrated on the selection criteria: substrate class, nucleophile strength and solvent. By the end you were working through 1-bromobutane with cyanide in DMSO unprompted and giving all three reasons for SN2, including inversion of configuration.',
    '["SN1 and SN2 mechanisms","Carbocation stability","Steric hindrance to backside attack","Rate equations for each mechanism","Polar protic and polar aprotic solvents","Leaving group ability"]'::jsonb,
    '["SN2 is a single concerted step; SN1 proceeds through a carbocation intermediate","Tertiary substrates favour SN1 for two independent reasons: a more stable carbocation and steric blocking of backside attack","Polar protic solvents stabilise the SN1 intermediate but cage and blunt the nucleophile, which slows SN2","Polar aprotic solvents dissolve the salt without hydrogen bonding to the anion, leaving the nucleophile reactive","A better leaving group accelerates both mechanisms, so it cannot be used to decide between them"]'::jsonb,
    '["You gave the full SN1 mechanism for 2-bromo-2-methylpropane including the final deprotonation step, which is commonly left out","You reasoned from the rate equation to which species appears in the slow step rather than recalling it","By the end of the lesson you were justifying your choice with substrate, nucleophile and solvent together, in that order"]'::jsonb,
    '["Protic versus aprotic solvents: you needed a prompt to connect the solvent to the nucleophile rather than to the substrate","Nucleophile strength was not yet being used as an independent factor in your reasoning"]'::jsonb,
    '["Earlier in the lesson the leaving group was used as evidence for SN1. It affects the rate of both mechanisms and does not select between them — you identified this yourself once it was raised."]'::jsonb,
    '["Substitution problem set, questions 4 to 12","Draw question 12 with full curly arrows, paying attention to where each arrow starts"]'::jsonb,
    '["Substitution problem set (uploaded to this lesson)","Lesson board: SN1 vs SN2 decision flow"]'::jsonb,
    '["Elimination reactions, E1 and E2, and how they compete with substitution","Revisit the solvent argument at the start of next lesson to check it has held"]'::jsonb,
    'Sophia is quick but reaches for pattern recall before reasoning; when pushed for a mechanism she gets there every time. Keep asking "why" twice rather than accepting the first answer.',
    true, 'seed', now() - interval '14 days', true
  );

  insert into public.lesson_notes (
    lesson_id, summary, topics_covered, key_concepts, strengths,
    areas_for_improvement, misconceptions, homework, resources_mentioned,
    next_steps, tutor_private_notes, ai_generated, ai_model, ai_generated_at,
    tutor_reviewed
  ) values (
    v_e12,
    'This lesson introduced elimination — E1 and E2 — alongside the substitution mechanisms already covered, and worked on deciding between substitution and elimination for a given set of conditions. The solvent reasoning from the previous lesson was checked at the start and had held without prompting. The new material that needs consolidation is the anti-periplanar geometry required for E2 and the Newman projections used to show it.',
    '["E1 and E2 mechanisms","Anti-periplanar geometry","Newman projections","Substitution versus elimination conditions","Zaitsev and Hofmann products"]'::jsonb,
    '["E1 shares its first step with SN1; the carbocation is then deprotonated at the beta carbon rather than attacked","E2 is concerted and requires the beta hydrogen and the leaving group to be anti-periplanar, at 180 degrees","Heat and a strong base push toward elimination; a small strong nucleophile in a polar solvent pushes toward substitution","A bulky base such as potassium tert-butoxide gives the Hofmann product rather than the Zaitsev product because it cannot reach the more hindered proton"]'::jsonb,
    '["The polar protic and aprotic distinction from last lesson was recalled correctly and unprompted at the start","You predicted both products for 2-bromo-2-methylbutane correctly, with ethoxide and with tert-butoxide","You identified without prompting that a bulky base changes the product rather than only the rate"]'::jsonb,
    '["Drawing Newman projections from a skeletal structure — you raised this yourself as the least secure part of the lesson","Anti-periplanar geometry needs practice in ring systems, where it determines the product"]'::jsonb,
    '[]'::jsonb,
    '["Elimination problem set, questions 1 to 8","Draw a Newman projection for every E2 answer, including where the question does not ask for one"]'::jsonb,
    '["Elimination problem set","Lesson board: E1/E2 and the anti-periplanar requirement"]'::jsonb,
    '["Reaction pathways: combining substitution, elimination and addition into synthesis routes","Short recap of anti-periplanar geometry using a cyclohexane example"]'::jsonb,
    'Draft from the notetaker, lightly checked but not yet corrected — the Newman projection point is understated relative to how much she struggled with it in the second half.',
    true, 'seed', now() - interval '2 days', false
  );

  -- ---- A transcript, so the viewer has something real to open -------------
  insert into public.transcripts (
    lesson_id, raw_transcript, speaker_segments_json, provider,
    processing_status, duration_seconds
  ) values (
    v_sn,
    'Theodora: Right — last week we finished nomenclature and you were solid on it. Today is substitution.',
    '[
      {"index":0,"speaker":"Theodora","role":"tutor","start_seconds":12,"end_seconds":31,"text":"Right — last week we finished nomenclature and you were solid on it. Today is substitution. Before I draw anything, tell me what you already associate with SN1 and SN2."},
      {"index":1,"speaker":"Sophia","role":"student","start_seconds":31,"end_seconds":44,"text":"SN2 is one step and SN1 is two steps. And SN1 has a carbocation in the middle."},
      {"index":2,"speaker":"Theodora","role":"tutor","start_seconds":44,"end_seconds":61,"text":"Good. That is the mechanistic difference and you have it right. Now the harder question: given a substrate, how do you decide which one actually happens?"},
      {"index":3,"speaker":"Sophia","role":"student","start_seconds":61,"end_seconds":74,"text":"You look at how substituted the carbon is. Primary goes SN2, tertiary goes SN1."},
      {"index":4,"speaker":"Theodora","role":"tutor","start_seconds":203,"end_seconds":221,"text":"Because the slow step does not involve it. Now the part that trips most people. Solvent. What does the solvent do to each mechanism?"},
      {"index":5,"speaker":"Sophia","role":"student","start_seconds":221,"end_seconds":233,"text":"Polar solvents help SN1 because they stabilise the carbocation?"},
      {"index":6,"speaker":"Theodora","role":"tutor","start_seconds":233,"end_seconds":251,"text":"Yes, and specifically polar protic — water, ethanol. They solvate both the cation and the leaving anion through hydrogen bonding. Now what about SN2?"},
      {"index":7,"speaker":"Sophia","role":"student","start_seconds":251,"end_seconds":262,"text":"I think polar protic is bad for SN2? I am not sure why."},
      {"index":8,"speaker":"Theodora","role":"tutor","start_seconds":262,"end_seconds":274,"text":"Think about what the protic solvent does to the nucleophile itself, not to the substrate."},
      {"index":9,"speaker":"Sophia","role":"student","start_seconds":274,"end_seconds":289,"text":"Oh — it hydrogen bonds to the nucleophile. So the nucleophile is surrounded and cannot attack as easily."},
      {"index":10,"speaker":"Theodora","role":"tutor","start_seconds":289,"end_seconds":312,"text":"That is it. It builds a solvent cage around the nucleophile and blunts it. Polar aprotic solvents — acetone, DMSO, DMF — dissolve the salt but cannot hydrogen bond to the anion, so the nucleophile stays naked and reactive."}
    ]'::jsonb,
    'seed', 'ready', 3480
  );

  -- ---- Homework the student can tick off ---------------------------------
  insert into public.homework_items (lesson_id, student_id, subject_id, description, due_at, completed)
  select v_sn, l.student_id, l.subject_id, item, now() + interval '2 days', false
  from public.lessons l,
       unnest(array[
         'Substitution problem set, questions 4 to 12',
         'Draw question 12 with full curly arrows, paying attention to where each arrow starts'
       ]) as item
  where l.id = v_sn;
end;
$$;

-- ---------------------------------------------------------------------------
-- Progress. Illustrative only — see the comment on the column.
-- ---------------------------------------------------------------------------
insert into public.student_topic_progress (student_id, subject_id, topic, mastery_score, confidence, evidence_count)
select
  pg_temp.student_id('sophia@demo.ownyourstudy.com'),
  pg_temp.subject_id('IB', 'Chemistry', 'HL'),
  topic, score, 0.4, evidence
from (values
  ('Atomic structure and periodicity', 0.88, 3),
  ('Bonding and intermolecular forces', 0.81, 4),
  ('Energetics', 0.74, 2),
  ('Equilibrium', 0.79, 3),
  ('Acids and bases', 0.83, 3),
  ('Redox and electrochemistry', 0.62, 2),
  ('Organic: substitution', 0.77, 4),
  ('Organic: elimination', 0.55, 1)
) as t(topic, score, evidence)
on conflict do nothing;

update public.app_settings set notetaker_enabled_globally = true where id;

-- ---------------------------------------------------------------------------
select
  (select count(*) from public.profiles)  as profiles,
  (select count(*) from public.subjects)  as subjects,
  (select count(*) from public.tutor_student_subjects) as assignments,
  (select count(*) from public.lessons)   as lessons,
  (select count(*) from public.lesson_notes) as notes;
