-- ============================================================================
-- Own Your Study Portal — storage
-- ----------------------------------------------------------------------------
-- One private bucket. Nothing in it is world-readable; the app mints a signed
-- URL per read, which expires. Objects are keyed `lessons/<lesson_id>/<file>`
-- so the lesson's own access rules can be reused verbatim on the object.
-- ============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'lesson-files',
  'lesson-files',
  false,
  26214400, -- 25 MB; a board scan or worksheet, not a video
  array[
    'application/pdf',
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/heic',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/msword',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- The lesson id sits in the second path segment. Anything not matching the
-- convention resolves to null and therefore fails every policy below.
create or replace function public.storage_lesson_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  parts text[] := string_to_array(p_name, '/');
begin
  if array_length(parts, 1) < 3 or parts[1] <> 'lessons' then
    return null;
  end if;
  return parts[2]::uuid;
exception when others then
  return null;
end;
$$;

create policy "lesson files: students read published"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and public.can_read_published_lesson(public.storage_lesson_id(name))
  );

create policy "lesson files: tutors and admins read"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and (
      public.is_admin()
      or public.can_write_lesson(public.storage_lesson_id(name))
    )
  );

create policy "lesson files: tutors and admins upload"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'lesson-files'
    and (
      public.is_admin()
      or public.can_write_lesson(public.storage_lesson_id(name))
    )
  );

create policy "lesson files: tutors and admins replace"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and (
      public.is_admin()
      or public.can_write_lesson(public.storage_lesson_id(name))
    )
  );

create policy "lesson files: tutors and admins delete"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'lesson-files'
    and (
      public.is_admin()
      or public.can_write_lesson(public.storage_lesson_id(name))
    )
  );
