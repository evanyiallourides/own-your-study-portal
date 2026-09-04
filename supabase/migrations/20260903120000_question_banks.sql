-- ---------------------------------------------------------------------------
-- Question bank access
--
-- The marketing site publishes one free question from each of the fourteen IB
-- banks and keeps the other 2,854 out of the deployed folder entirely. This is
-- the record of who may read the rest.
--
-- Two ways in, one answer. An administrator grants access when a subscription
-- is paid, optionally with an expiry; and a student with enough pooled tutoring
-- hours gets it without anyone doing anything, because the pricing page already
-- promises exactly that. `has_question_bank_access()` is the single place those
-- two rules meet, so the API, the page and the navigation cannot disagree about
-- who is entitled to what.
--
-- There is no payments integration here. When one arrives, its webhook writes
-- this same table and nothing else has to change.
-- ---------------------------------------------------------------------------

create table public.question_bank_access (
  student_id  uuid primary key references public.students (id) on delete cascade,
  granted     boolean not null default true,
  -- Null means no expiry. A subscription that lapses is better expressed as a
  -- date in the past than by deleting the row, which would lose the history of
  -- who granted it and when.
  expires_at  timestamptz,
  note        text,
  granted_by  uuid references public.profiles (id),
  granted_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

comment on table public.question_bank_access is
  'Who may read the full IB question banks. Written by an administrator today; '
  'by a payment webhook later, into this same table.';

create index question_bank_access_expires_idx
  on public.question_bank_access (expires_at)
  where granted;

-- The hours threshold is a commercial decision, not a constant, so it sits
-- with the other settings an administrator can change.
alter table public.app_settings
  add column if not exists question_bank_free_hours integer not null default 20
    check (question_bank_free_hours >= 0);

comment on column public.app_settings.question_bank_free_hours is
  'Pooled tutoring hours at which the question banks are included at no extra '
  'cost. Mirrors the promise on the pricing page.';

-- ---------------------------------------------------------------------------
-- Pooled hours
--
-- Every lesson booked for the student that was not cancelled, whether or not it
-- has been taught yet: the ladder prices a package up front, so a student who
-- has booked forty hours is on the forty-hour rate from the first lesson rather
-- than the last. `failed` counts too — a lesson whose recording broke was still
-- taught and still paid for.
-- ---------------------------------------------------------------------------
create or replace function public.student_pooled_minutes(p_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(duration_minutes), 0)::integer
  from public.lessons
  where student_id = p_student_id
    and status <> 'cancelled';
$$;

create or replace function public.has_question_bank_access(p_student_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select
    -- Granted outright, and not expired.
    exists (
      select 1
      from public.question_bank_access qba
      where qba.student_id = p_student_id
        and qba.granted
        and (qba.expires_at is null or qba.expires_at > now())
    )
    -- ...or earned by the hours already on the books.
    or (
      public.student_pooled_minutes(p_student_id) >=
      (select question_bank_free_hours from public.app_settings where id) * 60
    );
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- A student may see whether they have access and until when — that is their own
-- entitlement and they will ask about it — but may not write it. Tutors and
-- parents see the students they are already entitled to see, so the answer can
-- be shown on a student's page without a second query path. Only an
-- administrator writes.
-- ---------------------------------------------------------------------------
alter table public.question_bank_access enable row level security;

create policy "question_bank_access: student reads own"
  on public.question_bank_access for select
  using (student_id = public.current_student_id());

create policy "question_bank_access: tutor reads assigned"
  on public.question_bank_access for select
  using (public.tutor_teaches_student(student_id));

create policy "question_bank_access: parent reads children"
  on public.question_bank_access for select
  using (public.parent_of_student(student_id));

create policy "question_bank_access: admin all"
  on public.question_bank_access for all
  using (public.is_admin())
  with check (public.is_admin());

create trigger question_bank_access_touch
  before update on public.question_bank_access
  for each row execute function public.touch_updated_at();
