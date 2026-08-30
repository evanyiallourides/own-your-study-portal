-- ============================================================================
-- Own Your Study Portal — Google Calendar and Meet
-- ----------------------------------------------------------------------------
-- Two things are stored here. A tutor's Google connection, which is a refresh
-- token and therefore the most sensitive row in the database. And the identity
-- of the calendar event a lesson created, so the lesson can be moved or
-- cancelled later rather than leaving an orphan in somebody's calendar.
--
-- The refresh token is never readable through the API. There is no select
-- policy granting it to anybody — not the owner, not an administrator — and
-- RLS is on, so PostgREST returns nothing. Only the service role, used by the
-- server-side code that actually calls Google, can read it. What a person can
-- see is the connection's status, through a view that does not have the column
-- at all. Withholding a column by withholding the row is the same reasoning
-- that keeps a tutor's private notes away from students.
-- ============================================================================

create table public.google_accounts (
  profile_id      uuid primary key references public.profiles (id) on delete cascade,

  -- Which Google account this is. Shown back to the person so they can tell
  -- whether they connected the right one, which is the usual mistake.
  google_email    text not null,
  google_sub      text not null,

  -- The long-lived credential. Google issues it once, on first consent, and
  -- not again unless access is revoked and re-granted — so losing it means the
  -- tutor must reconnect.
  refresh_token   text not null,

  -- Cached so a token is not minted for every request. Short-lived by design.
  access_token    text,
  access_expires_at timestamptz,

  -- Which calendar lessons are written to. "primary" unless someone changes it.
  calendar_id     text not null default 'primary',

  scope           text not null,
  connected_at    timestamptz not null default now(),
  last_used_at    timestamptz,
  last_error      text,

  updated_at      timestamptz not null default now()
);

create index google_accounts_email_idx on public.google_accounts (google_email);

create trigger google_accounts_touch
  before update on public.google_accounts
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- The lesson's side of it.
-- ---------------------------------------------------------------------------
alter table public.lessons
  add column google_event_id  text,
  add column google_calendar_id text,
  -- Which account owns the event, so a lesson whose tutor later disconnects
  -- can be reported honestly rather than silently failing to update.
  add column google_owner_id  uuid references public.profiles (id) on delete set null,
  -- True when the Meet link on this lesson was minted by us. A pasted link is
  -- not ours to move or revoke, and the interface should not imply otherwise.
  --
  -- Note that this is an application-layer distinction, not an enforced one:
  -- RLS works on rows, so any policy that lets a tutor update their own lesson
  -- lets them update these columns too. The consequence of setting it falsely
  -- is small — the portal would try to patch a calendar event that does not
  -- exist and get a 404 it already handles — so it is not worth a trigger.
  add column meet_link_managed boolean not null default false;

create index lessons_google_event_idx on public.lessons (google_event_id)
  where google_event_id is not null;

-- ---------------------------------------------------------------------------
-- Status without secrets.
--
-- security_invoker is left at its default of false on purpose: the view runs
-- as its owner and does its own filtering in the where clause. That is what
-- lets it show a row whose underlying table grants no select to anyone.
-- ---------------------------------------------------------------------------
create view public.google_connection_status as
  select
    g.profile_id,
    g.google_email,
    g.calendar_id,
    g.connected_at,
    g.last_used_at,
    g.last_error,
    -- Deliberately not the token, nor its expiry to the second: whether a
    -- connection is working is a yes or no to the person looking at it.
    (g.refresh_token is not null) as connected
  from public.google_accounts g
  where g.profile_id = auth.uid()
     or public.is_admin();

comment on view public.google_connection_status is
  'Connection status for the signed-in user (or every user, for an admin). Never exposes tokens.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.google_accounts enable row level security;

-- Note the absence of a select policy. Reading a token through the API is not
-- a thing anybody may do; the server reads it with the service role.
--
-- Disconnecting, though, must be possible without a server round trip through
-- privileged code, and deleting your own row is a safe thing to allow.
create policy "google_accounts: disconnect own"
  on public.google_accounts for delete
  using (profile_id = auth.uid());

create policy "google_accounts: admin disconnects"
  on public.google_accounts for delete
  using (public.is_admin());

-- Explicit rather than inherited. Supabase grants broadly on public by
-- default, and for this table the grants should be visible in the migration
-- that creates it rather than assumed from a project-wide default.
revoke all on public.google_accounts from anon, authenticated;
grant delete on public.google_accounts to authenticated;

grant select on public.google_connection_status to authenticated;
revoke all on public.google_connection_status from anon;

-- ---------------------------------------------------------------------------
-- Housekeeping: a disconnected account leaves its events behind in Google, but
-- the portal should stop claiming it manages them.
-- ---------------------------------------------------------------------------
create or replace function public.forget_google_events()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.lessons
     set meet_link_managed = false,
         google_owner_id   = null
   where google_owner_id = old.profile_id;
  return old;
end;
$$;

create trigger google_accounts_forget_events
  after delete on public.google_accounts
  for each row execute function public.forget_google_events();
