-- ============================================================================
-- Own Your Study Portal — Row Level Security
-- ----------------------------------------------------------------------------
-- Authorisation lives here, not in the UI. Every policy is expressed in terms
-- of a small set of SECURITY DEFINER helpers so the rules read as sentences
-- and so a policy on `profiles` can ask about `profiles` without recursing.
--
-- The helpers are SECURITY DEFINER *on purpose*: they bypass RLS on the tables
-- they read, which is what stops a policy from evaluating itself. Each one is
-- narrow, returns only a boolean or an id, and takes no user-controlled SQL.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.current_role_name()
returns public.user_role
language sql
stable
security definer
set search_path = public
as $$
  select role from public.profiles where id = auth.uid();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and role = 'admin' and active
  );
$$;

create or replace function public.current_student_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.students where profile_id = auth.uid();
$$;

create or replace function public.current_tutor_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.tutors where profile_id = auth.uid();
$$;

create or replace function public.current_parent_id()
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select id from public.parents where profile_id = auth.uid();
$$;

-- The central question: may the signed-in tutor see this student at all?
create or replace function public.tutor_teaches_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tutor_student_subjects tss
    join public.tutors t on t.id = tss.tutor_id
    where tss.student_id = p_student_id
      and t.profile_id = auth.uid()
      and tss.active
  );
$$;

-- The narrower question, used for lessons and notes: this student *in this
-- subject*. A chemistry tutor has no business in the maths lessons.
create or replace function public.tutor_teaches_student_subject(p_student_id uuid, p_subject_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tutor_student_subjects tss
    join public.tutors t on t.id = tss.tutor_id
    where tss.student_id = p_student_id
      and tss.subject_id = p_subject_id
      and t.profile_id = auth.uid()
      and tss.active
  );
$$;

create or replace function public.parent_of_student(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.parent_students ps
    join public.parents p on p.id = ps.parent_id
    where ps.student_id = p_student_id
      and p.profile_id = auth.uid()
  );
$$;

-- Lesson reachability, resolved once and reused by every child table.
-- `p_require_published` separates "this is my lesson" from "this lesson has
-- been released to me", which is the difference between a tutor's view and a
-- student's.
create or replace function public.can_read_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    where l.id = p_lesson_id
      and (
        public.is_admin()
        or l.student_id = public.current_student_id()
        or public.tutor_teaches_student_subject(l.student_id, l.subject_id)
        or public.parent_of_student(l.student_id)
      )
  );
$$;

-- What a student or parent is allowed to see: their lesson, and published.
create or replace function public.can_read_published_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    where l.id = p_lesson_id
      and l.published
      and (
        l.student_id = public.current_student_id()
        or public.parent_of_student(l.student_id)
      )
  );
$$;

create or replace function public.can_write_lesson(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    where l.id = p_lesson_id
      and (
        public.is_admin()
        or public.tutor_teaches_student_subject(l.student_id, l.subject_id)
      )
  );
$$;

-- Everything below this line exists for one reason: a policy expression that
-- reads a table applies that table's own policies, and a policy expression
-- that reads its *own* table recurses. Wrapping each lookup in a narrow
-- SECURITY DEFINER function makes the rules both terminating and predictable.

create or replace function public.current_profile_active()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select active from public.profiles where id = auth.uid();
$$;

-- Does this profile belong to a student the signed-in tutor teaches?
create or replace function public.profile_is_my_student(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    join public.tutor_student_subjects tss on tss.student_id = s.id
    join public.tutors t on t.id = tss.tutor_id
    where s.profile_id = p_profile_id
      and t.profile_id = auth.uid()
      and tss.active
  );
$$;

-- Does this profile belong to a tutor who teaches the signed-in student?
create or replace function public.profile_is_my_tutor(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tutors t
    join public.tutor_student_subjects tss on tss.tutor_id = t.id
    join public.students s on s.id = tss.student_id
    where t.profile_id = p_profile_id
      and s.profile_id = auth.uid()
      and tss.active
  );
$$;

create or replace function public.profile_is_my_child(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.students s
    join public.parent_students ps on ps.student_id = s.id
    join public.parents p on p.id = ps.parent_id
    where s.profile_id = p_profile_id
      and p.profile_id = auth.uid()
  );
$$;

-- Tutor-row visibility, from the student's and the parent's side.
create or replace function public.tutor_row_teaches_me(p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tutor_student_subjects tss
    join public.students s on s.id = tss.student_id
    where tss.tutor_id = p_tutor_id
      and s.profile_id = auth.uid()
      and tss.active
  );
$$;

create or replace function public.tutor_row_teaches_my_child(p_tutor_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.tutor_student_subjects tss
    join public.parent_students ps on ps.student_id = tss.student_id
    join public.parents p on p.id = ps.parent_id
    where tss.tutor_id = p_tutor_id
      and p.profile_id = auth.uid()
      and tss.active
  );
$$;

-- Has the student on this lesson been granted sight of raw transcripts?
create or replace function public.lesson_transcript_visible_to_student(p_lesson_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.lessons l
    join public.students s on s.id = l.student_id
    where l.id = p_lesson_id
      and s.transcript_access_enabled
  );
$$;

create or replace function public.my_guardian_consent_required()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select guardian_consent_required from public.students where profile_id = auth.uid();
$$;

create or replace function public.homework_description_of(p_id uuid)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select description from public.homework_items where id = p_id;
$$;

create or replace function public.homework_lesson_of(p_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select lesson_id from public.homework_items where id = p_id;
$$;

-- ---------------------------------------------------------------------------
-- Enable RLS everywhere. No table is left open; anything without a policy is
-- therefore unreadable, which is the safe direction to fail in.
-- ---------------------------------------------------------------------------
alter table public.profiles                enable row level security;
alter table public.students                enable row level security;
alter table public.tutors                  enable row level security;
alter table public.parents                 enable row level security;
alter table public.parent_students         enable row level security;
alter table public.subjects                enable row level security;
alter table public.student_subjects        enable row level security;
alter table public.tutor_student_subjects  enable row level security;
alter table public.lessons                 enable row level security;
alter table public.transcripts             enable row level security;
alter table public.lesson_notes            enable row level security;
alter table public.lesson_files            enable row level security;
alter table public.homework_items          enable row level security;
alter table public.student_topic_progress  enable row level security;
alter table public.notifications           enable row level security;
alter table public.webhook_events          enable row level security;
alter table public.app_settings            enable row level security;

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
create policy "profiles: read own"
  on public.profiles for select
  using (id = auth.uid());

create policy "profiles: admin reads all"
  on public.profiles for select
  using (public.is_admin());

-- A tutor needs the names of their students, and of nobody else.
create policy "profiles: tutor reads assigned students"
  on public.profiles for select
  using (public.profile_is_my_student(id));

-- A student needs the name of the tutor teaching them.
create policy "profiles: student reads own tutors"
  on public.profiles for select
  using (public.profile_is_my_tutor(id));

create policy "profiles: parent reads own children"
  on public.profiles for select
  using (public.profile_is_my_child(id));

-- Users may edit their own name and avatar. They may NOT change their role:
-- the WITH CHECK re-asserts the stored role, so an UPDATE that alters it fails.
create policy "profiles: update own non-privileged fields"
  on public.profiles for update
  using (id = auth.uid())
  with check (
    id = auth.uid()
    and role = public.current_role_name()
    and active = public.current_profile_active()
  );

create policy "profiles: admin writes"
  on public.profiles for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- students / tutors / parents
-- ---------------------------------------------------------------------------
create policy "students: read own"
  on public.students for select
  using (profile_id = auth.uid());

create policy "students: tutor reads assigned"
  on public.students for select
  using (public.tutor_teaches_student(id));

create policy "students: parent reads children"
  on public.students for select
  using (public.parent_of_student(id));

create policy "students: admin all"
  on public.students for all
  using (public.is_admin())
  with check (public.is_admin());

-- Consent is the student's (or their guardian's) to give, so a student may
-- update their own row — but not the fields that decide whether guardian
-- consent is needed, which stay with the admin.
create policy "students: update own consent"
  on public.students for update
  using (profile_id = auth.uid())
  with check (
    profile_id = auth.uid()
    and guardian_consent_required = public.my_guardian_consent_required()
  );

create policy "tutors: read own"
  on public.tutors for select
  using (profile_id = auth.uid());

create policy "tutors: student reads own tutors"
  on public.tutors for select
  using (public.tutor_row_teaches_me(id));

create policy "tutors: parent reads children's tutors"
  on public.tutors for select
  using (public.tutor_row_teaches_my_child(id));

create policy "tutors: update own"
  on public.tutors for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "tutors: admin all"
  on public.tutors for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "parents: read own"
  on public.parents for select
  using (profile_id = auth.uid());

create policy "parents: admin all"
  on public.parents for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "parent_students: parent reads own links"
  on public.parent_students for select
  using (parent_id = public.current_parent_id());

create policy "parent_students: admin all"
  on public.parent_students for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- subjects — the catalogue is not sensitive; only admins may change it.
-- ---------------------------------------------------------------------------
create policy "subjects: readable by signed-in users"
  on public.subjects for select
  to authenticated
  using (true);

create policy "subjects: admin writes"
  on public.subjects for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- student_subjects
-- ---------------------------------------------------------------------------
create policy "student_subjects: read own"
  on public.student_subjects for select
  using (student_id = public.current_student_id());

create policy "student_subjects: tutor reads assigned"
  on public.student_subjects for select
  using (public.tutor_teaches_student(student_id));

create policy "student_subjects: parent reads children"
  on public.student_subjects for select
  using (public.parent_of_student(student_id));

create policy "student_subjects: admin all"
  on public.student_subjects for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- tutor_student_subjects — visible to the people it concerns, writable only
-- by an admin. A tutor cannot assign themselves a student.
-- ---------------------------------------------------------------------------
create policy "assignments: tutor reads own"
  on public.tutor_student_subjects for select
  using (tutor_id = public.current_tutor_id());

create policy "assignments: student reads own"
  on public.tutor_student_subjects for select
  using (student_id = public.current_student_id());

create policy "assignments: parent reads children"
  on public.tutor_student_subjects for select
  using (public.parent_of_student(student_id));

create policy "assignments: admin all"
  on public.tutor_student_subjects for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- lessons
-- ---------------------------------------------------------------------------
create policy "lessons: student reads own published"
  on public.lessons for select
  using (
    student_id = public.current_student_id()
    and (published or status in ('scheduled', 'in_progress', 'cancelled'))
  );

comment on policy "lessons: student reads own published" on public.lessons is
  'A student sees a lesson that is scheduled (so they can join it) or published (so they can study it). Lessons mid-processing or awaiting tutor review stay hidden — unreviewed AI output is never student-facing.';

create policy "lessons: tutor reads own"
  on public.lessons for select
  using (public.tutor_teaches_student_subject(student_id, subject_id));

create policy "lessons: parent reads children published"
  on public.lessons for select
  using (
    public.parent_of_student(student_id)
    and (published or status in ('scheduled', 'in_progress'))
  );

create policy "lessons: admin reads all"
  on public.lessons for select
  using (public.is_admin());

create policy "lessons: tutor creates for assigned students"
  on public.lessons for insert
  with check (
    tutor_id = public.current_tutor_id()
    and public.tutor_teaches_student_subject(student_id, subject_id)
  );

create policy "lessons: tutor updates own"
  on public.lessons for update
  using (public.tutor_teaches_student_subject(student_id, subject_id))
  with check (public.tutor_teaches_student_subject(student_id, subject_id));

create policy "lessons: admin writes"
  on public.lessons for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- transcripts — a student reads their own only when the lesson is published
-- AND transcript access is switched on for them.
-- ---------------------------------------------------------------------------
create policy "transcripts: student reads when permitted"
  on public.transcripts for select
  using (
    public.can_read_published_lesson(lesson_id)
    and public.lesson_transcript_visible_to_student(lesson_id)
  );

create policy "transcripts: tutor and admin read"
  on public.transcripts for select
  using (public.is_admin() or public.can_write_lesson(lesson_id));

create policy "transcripts: tutor and admin write"
  on public.transcripts for all
  using (public.is_admin() or public.can_write_lesson(lesson_id))
  with check (public.is_admin() or public.can_write_lesson(lesson_id));

-- ---------------------------------------------------------------------------
-- lesson_notes
-- ----------------------------------------------------------------------------
-- The table itself is tutor/admin only, because it carries
-- `tutor_private_notes`. RLS is row-level, so the only way to keep one column
-- away from students is to keep the whole row away from them and let them read
-- a projection instead — that is what `student_lesson_notes` below is for.
-- A future `select *` therefore cannot leak private notes by accident.
-- ---------------------------------------------------------------------------
create policy "lesson_notes: tutor reads own lessons"
  on public.lesson_notes for select
  using (public.can_write_lesson(lesson_id));

create policy "lesson_notes: admin reads all"
  on public.lesson_notes for select
  using (public.is_admin());

create policy "lesson_notes: tutor writes own lessons"
  on public.lesson_notes for all
  using (public.can_write_lesson(lesson_id))
  with check (public.can_write_lesson(lesson_id));

create policy "lesson_notes: admin writes"
  on public.lesson_notes for all
  using (public.is_admin())
  with check (public.is_admin());

-- The student-facing projection. SECURITY INVOKER is off (the default), so the
-- view runs as its owner and is not blocked by the policies above; it does its
-- own authorisation in the WHERE clause and simply has no column to leak.
create view public.student_lesson_notes
  -- Stated explicitly, because the entire safety argument rests on it: the
  -- view runs as its owner, so the base table's tutor-only policy does not
  -- block it, and the view does its own authorisation in the WHERE clause.
  -- Flipping this to true would make the view return nothing to students.
  with (security_invoker = false)
as
  select
    n.id,
    n.lesson_id,
    n.summary,
    n.topics_covered,
    n.key_concepts,
    n.strengths,
    n.areas_for_improvement,
    n.misconceptions,
    n.homework,
    n.resources_mentioned,
    n.next_steps,
    n.tutor_reviewed,
    n.ai_generated,
    n.updated_at
  from public.lesson_notes n
  where public.can_read_published_lesson(n.lesson_id);

comment on view public.student_lesson_notes is
  'What a student or parent may read of a lesson''s notes: everything except tutor_private_notes, and only once the tutor has published the lesson.';

grant select on public.student_lesson_notes to authenticated;

-- ---------------------------------------------------------------------------
-- lesson_files
-- ---------------------------------------------------------------------------
create policy "lesson_files: student reads published lesson files"
  on public.lesson_files for select
  using (public.can_read_published_lesson(lesson_id));

create policy "lesson_files: tutor and admin read"
  on public.lesson_files for select
  using (public.is_admin() or public.can_write_lesson(lesson_id));

create policy "lesson_files: tutor and admin write"
  on public.lesson_files for all
  using (public.is_admin() or public.can_write_lesson(lesson_id))
  with check (
    (public.is_admin() or public.can_write_lesson(lesson_id))
    and uploaded_by = auth.uid()
  );

-- ---------------------------------------------------------------------------
-- homework_items
-- ---------------------------------------------------------------------------
create policy "homework: student reads own"
  on public.homework_items for select
  using (student_id = public.current_student_id());

-- Ticking off homework is the student's to do; nothing else on the row is.
create policy "homework: student marks complete"
  on public.homework_items for update
  using (student_id = public.current_student_id())
  with check (
    student_id = public.current_student_id()
    and description = public.homework_description_of(id)
    and lesson_id = public.homework_lesson_of(id)
  );

create policy "homework: tutor reads and writes assigned"
  on public.homework_items for all
  using (public.tutor_teaches_student_subject(student_id, subject_id))
  with check (public.tutor_teaches_student_subject(student_id, subject_id));

create policy "homework: parent reads children"
  on public.homework_items for select
  using (public.parent_of_student(student_id));

create policy "homework: admin all"
  on public.homework_items for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- student_topic_progress
-- ---------------------------------------------------------------------------
create policy "progress: student reads own"
  on public.student_topic_progress for select
  using (student_id = public.current_student_id());

create policy "progress: tutor reads and writes assigned"
  on public.student_topic_progress for all
  using (public.tutor_teaches_student_subject(student_id, subject_id))
  with check (public.tutor_teaches_student_subject(student_id, subject_id));

create policy "progress: parent reads children"
  on public.student_topic_progress for select
  using (public.parent_of_student(student_id));

create policy "progress: admin all"
  on public.student_topic_progress for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- notifications — yours and only yours.
-- ---------------------------------------------------------------------------
create policy "notifications: read own"
  on public.notifications for select
  using (profile_id = auth.uid());

create policy "notifications: mark own read"
  on public.notifications for update
  using (profile_id = auth.uid())
  with check (profile_id = auth.uid());

create policy "notifications: admin all"
  on public.notifications for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- webhook_events / app_settings — operational, admin only. The webhook route
-- itself uses the service role and bypasses RLS.
-- ---------------------------------------------------------------------------
create policy "webhook_events: admin reads"
  on public.webhook_events for select
  using (public.is_admin());

create policy "settings: readable by signed-in users"
  on public.app_settings for select
  to authenticated
  using (true);

create policy "settings: admin writes"
  on public.app_settings for all
  using (public.is_admin())
  with check (public.is_admin());
