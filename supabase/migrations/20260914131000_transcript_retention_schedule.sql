-- ---------------------------------------------------------------------------
-- Run the retention job daily
--
-- pg_cron rather than an HTTP endpoint on a schedule, for two reasons. Data
-- lifecycle is a property of the data, so it should keep working through a bad
-- deploy or a rollback of the application. And a job that destroys content has
-- no business being reachable over HTTP at all — there is no endpoint to
-- secure, rate-limit, or accidentally leave open.
--
-- Guarded, because pg_cron is not enabled on every project and a migration that
-- fails on a missing extension blocks everything behind it. If this cannot
-- schedule, the function still exists and can be called from anywhere:
--
--   select public.purge_expired_transcripts();
--
-- Check what is scheduled with:  select * from cron.job;
-- Check what it did with:        select * from cron.job_run_details order by start_time desc;
-- ---------------------------------------------------------------------------

do $$
begin
  create extension if not exists pg_cron;
exception when others then
  raise notice 'pg_cron is not available on this project. purge_expired_transcripts() '
               'still exists and needs scheduling by other means.';
end $$;

do $$
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    -- Unschedule first so re-running the migration does not stack duplicates.
    perform cron.unschedule('purge-expired-transcripts')
      where exists (select 1 from cron.job where jobname = 'purge-expired-transcripts');

    -- 03:20 UTC: past midnight everywhere the practices teach, and off the hour
    -- so it is not competing with everything else that runs at 03:00.
    perform cron.schedule(
      'purge-expired-transcripts',
      '20 3 * * *',
      $job$ select public.purge_expired_transcripts(); $job$
    );
    raise notice 'Scheduled purge-expired-transcripts daily at 03:20 UTC.';
  end if;
end $$;
