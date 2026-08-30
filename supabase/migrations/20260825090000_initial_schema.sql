-- ============================================================================
-- Own Your Study Portal — core schema
-- ----------------------------------------------------------------------------
-- One migration for the relational shape. Policies live in the next migration
-- so the access rules can be read (and reviewed) as a single document rather
-- than scattered through table definitions.
-- ============================================================================

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- Enums. Postgres enums rather than check constraints: the values are a closed
-- set the application switches on exhaustively, and a typo should fail at
-- write time rather than surface as an unrenderable status badge.
-- ---------------------------------------------------------------------------
create type public.user_role as enum ('student', 'tutor', 'admin', 'parent');

create type public.lesson_status as enum (
  'scheduled',
  'in_progress',
  'processing_transcript',
  'generating_notes',
  'review_required',
  'published',
  'failed',
  'cancelled'
);

create type public.meeting_platform as enum ('google_meet', 'zoom', 'teams', 'other');

create type public.lesson_file_category as enum ('board', 'worksheet', 'homework', 'resource', 'other');

create type public.transcript_status as enum ('pending', 'processing', 'ready', 'failed');

create type public.notification_kind as enum (
  'lesson_notes_ready_for_review',
  'lesson_published',
  'lesson_scheduled',
  'transcript_failed'
);

-- ---------------------------------------------------------------------------
-- profiles — one row per authenticated user, whatever their role.
-- ---------------------------------------------------------------------------
create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text not null,
  first_name   text not null default '',
  last_name    text not null default '',
  role         public.user_role not null default 'student',
  avatar_url   text,
  active       boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index profiles_role_idx on public.profiles (role);
create unique index profiles_email_key on public.profiles (lower(email));

comment on table public.profiles is
  'Identity and role for every portal user. The role column is the single source of truth for authorisation and is deliberately not writable by the user themselves (see RLS).';

-- ---------------------------------------------------------------------------
-- Role detail tables. Kept separate from profiles so role-specific fields do
-- not become a wide table of mostly-null columns.
-- ---------------------------------------------------------------------------
create table public.students (
  id            uuid primary key default gen_random_uuid(),
  profile_id    uuid not null unique references public.profiles (id) on delete cascade,
  programme     text,
  year_level    text,
  school        text,
  timezone      text not null default 'Europe/London',
  -- Consent. Recording a minor is not covered by a generic terms checkbox, so
  -- each permission is stored explicitly and the notetaker checks them.
  ai_notetaker_consent       boolean not null default false,
  transcription_consent      boolean not null default false,
  guardian_consent_required  boolean not null default true,
  guardian_consent_received  boolean not null default false,
  consent_timestamp          timestamptz,
  consent_recorded_by        uuid references public.profiles (id),
  -- Whether the student may read the raw transcript of their own lessons.
  transcript_access_enabled  boolean not null default true,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table public.tutors (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references public.profiles (id) on delete cascade,
  bio         text,
  headline    text,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create table public.parents (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null unique references public.profiles (id) on delete cascade,
  created_at  timestamptz not null default now()
);

create table public.parent_students (
  parent_id   uuid not null references public.parents (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  relationship text,
  created_at  timestamptz not null default now(),
  primary key (parent_id, student_id)
);

-- ---------------------------------------------------------------------------
-- subjects
-- ---------------------------------------------------------------------------
create table public.subjects (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  curriculum  text not null,          -- IB, A Level, GCSE, AP, University
  level       text,                   -- HL, SL, Higher, Foundation, Year 1...
  division    text,                   -- maps to the marketing site's practices
  archived    boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create unique index subjects_identity_key
  on public.subjects (lower(name), lower(curriculum), lower(coalesce(level, '')));

create table public.student_subjects (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete restrict,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (student_id, subject_id)
);

-- The assignment table. This single row is what grants a tutor sight of a
-- student, and only in the subject named. Everything in RLS reads from here.
create table public.tutor_student_subjects (
  id          uuid primary key default gen_random_uuid(),
  tutor_id    uuid not null references public.tutors (id) on delete cascade,
  student_id  uuid not null references public.students (id) on delete cascade,
  subject_id  uuid not null references public.subjects (id) on delete restrict,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (tutor_id, student_id, subject_id)
);

create index tss_tutor_idx   on public.tutor_student_subjects (tutor_id) where active;
create index tss_student_idx on public.tutor_student_subjects (student_id) where active;

comment on table public.tutor_student_subjects is
  'The authorisation edge of the system: a tutor sees a student only through an active row here, and only in that subject.';

-- ---------------------------------------------------------------------------
-- lessons
-- ---------------------------------------------------------------------------
create table public.lessons (
  id               uuid primary key default gen_random_uuid(),
  student_id       uuid not null references public.students (id) on delete cascade,
  tutor_id         uuid not null references public.tutors (id) on delete restrict,
  subject_id       uuid not null references public.subjects (id) on delete restrict,
  title            text,
  scheduled_at     timestamptz not null,
  duration_minutes integer not null default 60 check (duration_minutes between 5 and 480),
  started_at       timestamptz,
  ended_at         timestamptz,
  meeting_url      text,
  meeting_platform public.meeting_platform not null default 'google_meet',
  status           public.lesson_status not null default 'scheduled',
  published        boolean not null default false,
  published_at     timestamptz,
  -- Notetaker wiring. Nullable until a bot is actually scheduled.
  notetaker_enabled  boolean not null default false,
  recall_bot_id      text unique,
  processing_error   text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index lessons_student_idx  on public.lessons (student_id, scheduled_at desc);
create index lessons_tutor_idx    on public.lessons (tutor_id, scheduled_at desc);
create index lessons_status_idx   on public.lessons (status);
create index lessons_scheduled_idx on public.lessons (scheduled_at);

-- `published` and `status` must not drift apart: a lesson is visible to the
-- student when, and only when, published is true.
alter table public.lessons
  add constraint lessons_published_status_consistent
  check ((published = false) or (status = 'published'));

-- ---------------------------------------------------------------------------
-- transcripts
-- ---------------------------------------------------------------------------
create table public.transcripts (
  id                     uuid primary key default gen_random_uuid(),
  lesson_id              uuid not null unique references public.lessons (id) on delete cascade,
  raw_transcript         text,
  speaker_segments_json  jsonb not null default '[]'::jsonb,
  provider               text not null default 'recall',
  provider_ref           text,
  processing_status      public.transcript_status not null default 'pending',
  language               text default 'en',
  duration_seconds       integer,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

comment on column public.transcripts.speaker_segments_json is
  'Array of { index, speaker, role, start_seconds, end_seconds, text }. Ordered by start_seconds so a deep link can address a segment by index.';

-- ---------------------------------------------------------------------------
-- lesson_notes — one row per lesson, AI-drafted then tutor-reviewed.
-- ---------------------------------------------------------------------------
create table public.lesson_notes (
  id                     uuid primary key default gen_random_uuid(),
  lesson_id              uuid not null unique references public.lessons (id) on delete cascade,
  summary                text,
  topics_covered         jsonb not null default '[]'::jsonb,
  key_concepts           jsonb not null default '[]'::jsonb,
  strengths              jsonb not null default '[]'::jsonb,
  areas_for_improvement  jsonb not null default '[]'::jsonb,
  misconceptions         jsonb not null default '[]'::jsonb,
  homework               jsonb not null default '[]'::jsonb,
  resources_mentioned    jsonb not null default '[]'::jsonb,
  next_steps             jsonb not null default '[]'::jsonb,
  -- Never leaves the tutor/admin side. Enforced by RLS, not by the UI.
  tutor_private_notes    text,
  ai_generated           boolean not null default false,
  ai_model               text,
  ai_generated_at        timestamptz,
  tutor_reviewed         boolean not null default false,
  reviewed_by            uuid references public.tutors (id),
  reviewed_at            timestamptz,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- lesson_files — boards, worksheets, resources.
-- ---------------------------------------------------------------------------
create table public.lesson_files (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  uploaded_by  uuid not null references public.profiles (id) on delete restrict,
  file_name    text not null,
  file_type    text not null,
  file_size    bigint,
  storage_path text not null,
  category     public.lesson_file_category not null default 'resource',
  created_at   timestamptz not null default now()
);

create index lesson_files_lesson_idx on public.lesson_files (lesson_id);

comment on column public.lesson_files.storage_path is
  'Object key inside the private "lesson-files" bucket. URLs are minted as short-lived signed URLs at read time — never stored.';

-- ---------------------------------------------------------------------------
-- homework — derived from lesson notes at publish time, so a student has one
-- list to work from rather than having to open each lesson.
-- ---------------------------------------------------------------------------
create table public.homework_items (
  id           uuid primary key default gen_random_uuid(),
  lesson_id    uuid not null references public.lessons (id) on delete cascade,
  student_id   uuid not null references public.students (id) on delete cascade,
  subject_id   uuid not null references public.subjects (id) on delete restrict,
  description  text not null,
  due_at       timestamptz,
  completed    boolean not null default false,
  completed_at timestamptz,
  created_at   timestamptz not null default now()
);

create index homework_student_idx on public.homework_items (student_id, completed);

-- ---------------------------------------------------------------------------
-- student_topic_progress — deliberately thin for V1. Mastery is a placeholder
-- until objective assessment data exists to feed it; see the README.
-- ---------------------------------------------------------------------------
create table public.student_topic_progress (
  id             uuid primary key default gen_random_uuid(),
  student_id     uuid not null references public.students (id) on delete cascade,
  subject_id     uuid not null references public.subjects (id) on delete cascade,
  topic          text not null,
  mastery_score  numeric(4,3) check (mastery_score between 0 and 1),
  confidence     numeric(4,3) check (confidence between 0 and 1),
  evidence_count integer not null default 0,
  last_updated   timestamptz not null default now(),
  unique (student_id, subject_id, topic)
);

comment on column public.student_topic_progress.mastery_score is
  'Placeholder in V1. Nothing writes a defensible value yet — seeded values are labelled as illustrative in the UI. Intended to be fed by scored assessments, not by conversation.';

-- ---------------------------------------------------------------------------
-- notifications — in-app records only for V1. No delivery infrastructure.
-- ---------------------------------------------------------------------------
create table public.notifications (
  id          uuid primary key default gen_random_uuid(),
  profile_id  uuid not null references public.profiles (id) on delete cascade,
  kind        public.notification_kind not null,
  title       text not null,
  body        text,
  lesson_id   uuid references public.lessons (id) on delete cascade,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);

create index notifications_profile_idx on public.notifications (profile_id, read_at, created_at desc);

-- ---------------------------------------------------------------------------
-- webhook_events — idempotency ledger for Recall (and anything later).
-- ---------------------------------------------------------------------------
create table public.webhook_events (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,
  event_id      text not null,
  event_type    text not null,
  lesson_id     uuid references public.lessons (id) on delete set null,
  received_at   timestamptz not null default now(),
  processed_at  timestamptz,
  status        text not null default 'received',
  error_message text,
  unique (provider, event_id)
);

comment on table public.webhook_events is
  'Idempotency ledger. The unique (provider, event_id) index is what makes redelivery a no-op — no transcript payload is stored here, only the fact of the event.';

-- ---------------------------------------------------------------------------
-- settings — a single-row table for operational toggles an admin can change.
-- ---------------------------------------------------------------------------
create table public.app_settings (
  id                          boolean primary key default true check (id),
  notetaker_enabled_globally  boolean not null default false,
  notetaker_display_name      text not null default 'Own Your Study AI Notetaker',
  require_guardian_consent_under_18 boolean not null default true,
  transcript_retention_days   integer not null default 365,
  media_retention_hours       integer not null default 24,
  updated_at                  timestamptz not null default now(),
  updated_by                  uuid references public.profiles (id)
);

insert into public.app_settings (id) values (true) on conflict do nothing;

-- ---------------------------------------------------------------------------
-- updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles', 'students', 'tutors', 'subjects', 'lessons',
    'transcripts', 'lesson_notes'
  ] loop
    execute format(
      'create trigger %I_touch before update on public.%I
         for each row execute function public.touch_updated_at()', t, t);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- New auth users get a profile automatically. Role comes from the invite
-- metadata an admin set; anything unrecognised falls back to 'student', which
-- is the least-privileged role.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  requested_role public.user_role;
begin
  begin
    requested_role := (new.raw_user_meta_data ->> 'role')::public.user_role;
  exception when others then
    requested_role := 'student';
  end;

  insert into public.profiles (id, email, first_name, last_name, role)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'first_name', ''),
    coalesce(new.raw_user_meta_data ->> 'last_name', ''),
    coalesce(requested_role, 'student')
  )
  on conflict (id) do nothing;

  -- Give the role its detail row so the rest of the app never has to cope with
  -- a profile that has no student/tutor record behind it.
  if coalesce(requested_role, 'student') = 'student' then
    insert into public.students (profile_id) values (new.id) on conflict do nothing;
  elsif requested_role = 'tutor' then
    insert into public.tutors (profile_id) values (new.id) on conflict do nothing;
  elsif requested_role = 'parent' then
    insert into public.parents (profile_id) values (new.id) on conflict do nothing;
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
