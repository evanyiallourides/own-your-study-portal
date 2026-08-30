-- ============================================================================
-- Own Your Study Portal — workflow functions
-- ----------------------------------------------------------------------------
-- Publishing a lesson is several writes that must not half-happen: the notes
-- become reviewed, the lesson becomes visible, the homework list is rebuilt and
-- the student is notified. One function, one transaction.
-- ============================================================================

-- Consent gate. Called before a notetaker bot is ever scheduled. Returns the
-- reasons it is not satisfied, so the UI can say which one is missing rather
-- than a bare "not allowed".
create or replace function public.notetaker_consent_blockers(p_student_id uuid)
returns text[]
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    array_remove(array[
      case when not s.ai_notetaker_consent  then 'Student has not consented to the AI Notetaker' end,
      case when not s.transcription_consent then 'Student has not consented to transcription' end,
      case when s.guardian_consent_required and not s.guardian_consent_received
           then 'Guardian consent is required and has not been recorded' end,
      case when not st.notetaker_enabled_globally
           then 'The AI Notetaker is switched off for the whole organisation' end
    ], null),
    array[]::text[]
  )
  from public.students s
  cross join public.app_settings st
  where s.id = p_student_id;
$$;

comment on function public.notetaker_consent_blockers is
  'Returns an empty array when a notetaker may be scheduled for this student, otherwise one human-readable reason per unmet requirement. Recording without an empty result here is not permitted.';

-- ---------------------------------------------------------------------------
-- publish_lesson
-- ---------------------------------------------------------------------------
create or replace function public.publish_lesson(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson   public.lessons;
  v_notes    public.lesson_notes;
  v_student_profile uuid;
  v_subject_name    text;
  v_item     text;
begin
  if not (public.is_admin() or public.can_write_lesson(p_lesson_id)) then
    raise exception 'Not authorised to publish this lesson' using errcode = '42501';
  end if;

  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then
    raise exception 'Lesson not found' using errcode = 'P0002';
  end if;

  select * into v_notes from public.lesson_notes where lesson_id = p_lesson_id;
  if not found then
    raise exception 'This lesson has no notes to publish' using errcode = 'P0002';
  end if;
  if coalesce(trim(v_notes.summary), '') = '' then
    raise exception 'A lesson cannot be published without a summary' using errcode = '23514';
  end if;

  -- The tutor has seen it. That is what publishing means.
  update public.lesson_notes
     set tutor_reviewed = true,
         reviewed_by    = coalesce(public.current_tutor_id(), reviewed_by),
         reviewed_at    = now()
   where lesson_id = p_lesson_id;

  update public.lessons
     set status       = 'published',
         published    = true,
         published_at = coalesce(published_at, now()),
         processing_error = null
   where id = p_lesson_id;

  -- Rebuild the student's homework list for this lesson. Anything they have
  -- already ticked off survives, so republishing does not resurrect finished
  -- work or lose their progress.
  delete from public.homework_items
   where lesson_id = p_lesson_id
     and not completed;

  for v_item in
    select value #>> '{}' from jsonb_array_elements(coalesce(v_notes.homework, '[]'::jsonb))
  loop
    if coalesce(trim(v_item), '') <> '' and not exists (
      select 1 from public.homework_items h
      where h.lesson_id = p_lesson_id and h.description = v_item
    ) then
      insert into public.homework_items (lesson_id, student_id, subject_id, description)
      values (p_lesson_id, v_lesson.student_id, v_lesson.subject_id, v_item);
    end if;
  end loop;

  select s.profile_id into v_student_profile
    from public.students s where s.id = v_lesson.student_id;
  select sub.name into v_subject_name
    from public.subjects sub where sub.id = v_lesson.subject_id;

  insert into public.notifications (profile_id, kind, title, body, lesson_id)
  values (
    v_student_profile,
    'lesson_published',
    format('Your %s lesson notes have been published', coalesce(v_subject_name, 'lesson')),
    coalesce(v_lesson.title, 'Lesson notes') || ' is ready to read.',
    p_lesson_id
  );
end;
$$;

revoke all on function public.publish_lesson(uuid) from public;
grant execute on function public.publish_lesson(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- unpublish_lesson — a correction path. Takes the lesson back to review so a
-- mistake is fixable without deleting anything.
-- ---------------------------------------------------------------------------
create or replace function public.unpublish_lesson(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not (public.is_admin() or public.can_write_lesson(p_lesson_id)) then
    raise exception 'Not authorised to unpublish this lesson' using errcode = '42501';
  end if;

  update public.lessons
     set published = false,
         status    = 'review_required'
   where id = p_lesson_id;
end;
$$;

revoke all on function public.unpublish_lesson(uuid) from public;
grant execute on function public.unpublish_lesson(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- notify_tutor_review_required — called by the analysis pipeline once AI notes
-- exist. Kept in SQL so the webhook path and any manual re-run behave alike.
-- ---------------------------------------------------------------------------
create or replace function public.mark_lesson_review_required(p_lesson_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_lesson public.lessons;
  v_tutor_profile uuid;
  v_student_name text;
begin
  select * into v_lesson from public.lessons where id = p_lesson_id;
  if not found then
    raise exception 'Lesson not found' using errcode = 'P0002';
  end if;

  update public.lessons
     set status = 'review_required', published = false
   where id = p_lesson_id;

  select t.profile_id into v_tutor_profile
    from public.tutors t where t.id = v_lesson.tutor_id;

  select trim(p.first_name || ' ' || p.last_name) into v_student_name
    from public.students s
    join public.profiles p on p.id = s.profile_id
   where s.id = v_lesson.student_id;

  insert into public.notifications (profile_id, kind, title, body, lesson_id)
  values (
    v_tutor_profile,
    'lesson_notes_ready_for_review',
    format('Lesson notes for %s are ready to review', coalesce(v_student_name, 'your student')),
    'The AI draft is waiting. Nothing reaches the student until you publish it.',
    p_lesson_id
  );
end;
$$;

revoke all on function public.mark_lesson_review_required(uuid) from public;
-- Deliberately not granted to `authenticated`: only the service role, running
-- the analysis pipeline, moves a lesson into review.

-- ---------------------------------------------------------------------------
-- A convenience the dashboards lean on: counts an admin overview needs without
-- shipping every lesson row to the client.
-- ---------------------------------------------------------------------------
create or replace function public.admin_overview_counts()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select case when not public.is_admin() then '{}'::jsonb else jsonb_build_object(
    'students',        (select count(*) from public.students),
    'active_students', (select count(*) from public.students s
                         join public.profiles p on p.id = s.profile_id where p.active),
    'tutors',          (select count(*) from public.tutors where active),
    'subjects',        (select count(*) from public.subjects where not archived),
    'lessons_this_month', (select count(*) from public.lessons
                            where scheduled_at >= date_trunc('month', now())
                              and scheduled_at <  date_trunc('month', now()) + interval '1 month'),
    'review_required', (select count(*) from public.lessons where status = 'review_required'),
    'failed',          (select count(*) from public.lessons where status = 'failed')
  ) end;
$$;

grant execute on function public.admin_overview_counts() to authenticated;
