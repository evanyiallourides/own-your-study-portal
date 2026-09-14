-- ---------------------------------------------------------------------------
-- Transcript retention
--
-- app_settings.transcript_retention_days has existed since the first migration,
-- an administrator can change it, and the notetaker page quotes it back as
-- though it were policy. Nothing enforced it. Transcripts of lessons — mostly
-- with children — were kept for ever, and the setting was a claim rather than a
-- rule.
--
-- Two decisions worth stating.
--
-- It purges CONTENT, not the row. raw_transcript and the speaker segments are
-- the verbatim record of a child speaking, and those go. What stays is that a
-- transcript existed, how long the lesson ran, and which provider made it —
-- none of it personal, and all of it needed for a lesson's history to still
-- make sense afterwards. Deleting the row would take the lesson's own account
-- of itself with it.
--
-- It leaves lesson notes alone. The reviewed write-up is the thing a student
-- actually studies from months later, and it has been through a tutor. The
-- transcript is the raw material. Keeping the first and dropping the second is
-- the whole point of a retention window rather than a delete button.
--
-- Age is measured from the lesson, not from when the row was written. A
-- transcript that arrived late is still a record of a lesson that happened when
-- it happened.
-- ---------------------------------------------------------------------------

alter table public.transcripts
  add column if not exists purged_at timestamptz;

comment on column public.transcripts.purged_at is
  'When the verbatim content was removed under the retention window. Null while '
  'the transcript is still readable.';

-- The job only ever looks at rows it has not already done, so this is the index
-- that keeps it cheap once most transcripts are purged.
create index if not exists transcripts_unpurged_idx
  on public.transcripts (lesson_id)
  where purged_at is null;

create or replace function public.purge_expired_transcripts()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_days   integer;
  v_purged integer;
begin
  select transcript_retention_days into v_days from public.app_settings limit 1;

  -- No setting, or one turned off, means keep everything. Treating a missing
  -- number as "delete now" is the wrong way round for a destructive job.
  if v_days is null or v_days < 1 then
    return 0;
  end if;

  with expired as (
    update public.transcripts t
       set raw_transcript        = null,
           speaker_segments_json = '[]'::jsonb,
           purged_at             = now(),
           updated_at            = now()
      from public.lessons l
     where l.id = t.lesson_id
       and t.purged_at is null
       and coalesce(l.ended_at, l.scheduled_at) < now() - make_interval(days => v_days)
    returning 1
  )
  select count(*) into v_purged from expired;

  return v_purged;
end;
$$;

comment on function public.purge_expired_transcripts() is
  'Removes the verbatim content of transcripts older than '
  'app_settings.transcript_retention_days. Idempotent: a purged row is never '
  'looked at again. Returns how many it did.';

-- Nobody but the scheduler and an administrator should be able to run a job
-- that destroys content.
revoke execute on function public.purge_expired_transcripts() from public, anon, authenticated;
