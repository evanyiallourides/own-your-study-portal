-- ---------------------------------------------------------------------------
-- Tutoring hours, class boards and study plans
--
-- Three things a student's dashboard was missing.
--
--   1. Hours. Every tutoring package names a number of hours, and until now
--      buying one recorded the money and nothing else: the question bank and
--      the IA review each had a grant column and a claim block, the hours had
--      neither. A student who bought twenty hours had no balance anywhere, and
--      the Committed Pack's promised question bank access only arrived once
--      twenty hours of lessons had actually been booked.
--
--   2. Class boards. The whiteboard a tutor and student share across lessons
--      (Miro, Excalidraw, Bitpaper, a OneNote class notebook...) lived in
--      somebody's bookmarks. It now lives on the student's record.
--
--   3. Study plans. Lesson notes say what happened in one lesson; nothing said
--      where the student stands overall and what happens next. A plan is that
--      document: a review, the goals, and the focus for the coming weeks.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- 1. Hours
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists grants_tutoring_hours integer
    check (grants_tutoring_hours is null or grants_tutoring_hours > 0);

comment on column public.orders.grants_tutoring_hours is
  'Tutoring hours this order buys, per unit of quantity. Applied on settlement '
  'by claim_orders_for_profile(), never on authorisation.';

-- Minutes, not hours: an administrator correcting a balance by half an hour
-- should not need a fractional column.
create table public.tutoring_hour_entries (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  minutes     integer not null check (minutes <> 0),
  reason      text not null check (reason in (
                'purchase',      -- an order settled
                'admin_grant',   -- paid outside the checkout, or goodwill
                'refund',        -- an order came back; unbooked hours with it
                'correction'     -- an administrator fixing a mistake
              )),
  order_id    uuid references public.orders (id) on delete set null,
  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index tutoring_hour_entries_student_idx
  on public.tutoring_hour_entries (student_id, created_at desc);

-- One order grants once, however many times its webhook is delivered.
create unique index tutoring_hour_entries_order_purchase_idx
  on public.tutoring_hour_entries (order_id)
  where reason = 'purchase';

comment on table public.tutoring_hour_entries is
  'Every movement of purchased tutoring time. What has been used is derived '
  'from lessons, so there is no balance column to disagree with either.';

create or replace function public.tutoring_minutes_purchased(p_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(minutes), 0)::integer
  from public.tutoring_hour_entries
  where student_id = p_student_id;
$$;

-- Used and booked minutes, for the dashboard.
--
-- Security definer because RLS hides a lesson from its student while it is
-- being written up, and an hour taught yesterday is still an hour spent. The
-- access check is restated here for the same reason: definer rights would
-- otherwise answer for anybody's student id.
create or replace function public.student_lesson_minutes(p_student_id uuid)
returns table (used_minutes integer, booked_minutes integer)
language sql
stable
security definer
set search_path = public
as $$
  select
    coalesce(sum(duration_minutes) filter (where scheduled_at <= now()), 0)::integer,
    coalesce(sum(duration_minutes) filter (where scheduled_at > now()), 0)::integer
  from public.lessons
  where student_id = p_student_id
    and status <> 'cancelled'
    and (
      public.is_admin()
      or p_student_id = public.current_student_id()
      or public.parent_of_student(p_student_id)
      or public.tutor_teaches_student(p_student_id)
    );
$$;

-- Every visible student's hours in one round trip, for the owner's overview
-- and the tutor's student list. The same visibility rule as above, applied per
-- row, so a tutor gets the students they teach and nobody else.
create or replace function public.tutoring_hour_balances()
returns table (
  student_id        uuid,
  purchased_minutes integer,
  used_minutes      integer,
  booked_minutes    integer
)
language sql
stable
security definer
set search_path = public
as $$
  select
    s.id,
    coalesce((select sum(e.minutes) from public.tutoring_hour_entries e
               where e.student_id = s.id), 0)::integer,
    coalesce((select sum(l.duration_minutes) from public.lessons l
               where l.student_id = s.id and l.status <> 'cancelled'
                 and l.scheduled_at <= now()), 0)::integer,
    coalesce((select sum(l.duration_minutes) from public.lessons l
               where l.student_id = s.id and l.status <> 'cancelled'
                 and l.scheduled_at > now()), 0)::integer
  from public.students s
  where public.is_admin()
     or s.id = public.current_student_id()
     or public.parent_of_student(s.id)
     or public.tutor_teaches_student(s.id);
$$;

-- ---------------------------------------------------------------------------
-- Pooled hours now count what was bought as well as what was booked.
--
-- The larger of the two, not the sum: a booked lesson is drawn from purchased
-- hours, so adding them would count the same hour twice. Taking the larger
-- keeps every student who earned access by booking, and gives it at purchase
-- to the one who bought twenty hours and has not booked them yet — which is
-- what the Committed Pack says it includes.
-- ---------------------------------------------------------------------------
create or replace function public.student_pooled_minutes(p_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select greatest(
    (select coalesce(sum(duration_minutes), 0)::integer
       from public.lessons
      where student_id = p_student_id
        and status <> 'cancelled'),
    public.tutoring_minutes_purchased(p_student_id)
  );
$$;

-- ---------------------------------------------------------------------------
-- Applying what an order granted
--
-- Restated in full, carried forward verbatim from 20260917120000_ia_marking.sql
-- with one block added at the end of the loop. The match on
-- coalesce(student_email, buyer_email) is what stops a parent collecting what
-- they bought for their child; migrations.test.mts checks it survives.
-- ---------------------------------------------------------------------------
create or replace function public.claim_orders_for_profile(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email      text;
  v_student_id uuid;
  v_order      record;
  v_claimed    integer := 0;
begin
  select p.email, s.id into v_email, v_student_id
  from public.profiles p
  left join public.students s on s.profile_id = p.id
  where p.id = p_profile_id;

  if v_email is null or v_student_id is null then
    return 0;
  end if;

  for v_order in
    select * from public.orders
    where student_id is null
      and lower(coalesce(student_email, buyer_email)) = lower(v_email)
      and status in ('paid', 'instalments_active', 'completed')
    order by created_at
  loop
    update public.orders
       set student_id = v_student_id,
           claimed_at = now(),
           claimed_by = p_profile_id
     where id = v_order.id;

    if v_order.grants_question_bank_days is not null then
      insert into public.question_bank_access as qba
        (student_id, granted, expires_at, note, order_id, granted_at)
      values (
        v_student_id,
        true,
        now() + make_interval(days => v_order.grants_question_bank_days),
        'Paid: ' || v_order.sku_name,
        v_order.id,
        now()
      )
      on conflict (student_id) do update
        set granted    = true,
            expires_at = greatest(coalesce(qba.expires_at, now()), now())
                         + make_interval(days => v_order.grants_question_bank_days),
            note       = 'Paid: ' || v_order.sku_name,
            order_id   = v_order.id;
    end if;

    if v_order.grants_ia_markings is not null then
      insert into public.ia_credit_entries
        (student_id, delta, reason, order_id, note)
      values (
        v_student_id,
        v_order.grants_ia_markings * greatest(v_order.quantity, 1),
        'purchase',
        v_order.id,
        'Paid: ' || v_order.sku_name
      )
      on conflict do nothing;
    end if;

    if v_order.grants_tutoring_hours is not null then
      -- Same shape as the IA credits: per unit, multiplied by quantity, and
      -- idempotent against the partial unique index on (order_id).
      insert into public.tutoring_hour_entries
        (student_id, minutes, reason, order_id, note)
      values (
        v_student_id,
        v_order.grants_tutoring_hours * 60 * greatest(v_order.quantity, 1),
        'purchase',
        v_order.id,
        'Paid: ' || v_order.sku_name
      )
      on conflict do nothing;
    end if;

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Linking an order by hand
--
-- The administrator's queue of unmatched payments used to set student_id and
-- then call claim_orders_for_profile() — which only looks at orders with no
-- student and a matching email, so it skipped the very order just linked and
-- nothing it bought was ever applied. This attaches and applies in one step.
--
-- Re-linking moves what the order granted: an order linked to the wrong
-- student and then to the right one leaves its hours and IA credits with the
-- right one, rather than with whoever was picked first (the purchase entries
-- are unique per order, so a second insert would silently do nothing).
-- ---------------------------------------------------------------------------
create or replace function public.link_order_to_student(p_order_id uuid, p_student_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order record;
begin
  if not public.is_admin() then
    raise exception 'Only an administrator can link an order.' using errcode = '42501';
  end if;

  select * into v_order from public.orders where id = p_order_id for update;
  if not found then
    raise exception 'That order does not exist.';
  end if;
  if not exists (select 1 from public.students where id = p_student_id) then
    raise exception 'That student does not exist.';
  end if;

  update public.orders
     set student_id = p_student_id,
         claimed_at = now(),
         claimed_by = auth.uid()
   where id = p_order_id;

  -- Nothing is granted for money that has not arrived or has gone back.
  if v_order.status not in ('paid', 'instalments_active', 'past_due', 'completed') then
    return;
  end if;

  -- Question banks: extend once per order. A row already carrying this order
  -- belongs to the student it was first given to; withdraw it there.
  if v_order.grants_question_bank_days is not null then
    update public.question_bank_access
       set granted = false, note = 'Order moved to another student'
     where order_id = p_order_id and student_id <> p_student_id;

    if not exists (
      select 1 from public.question_bank_access
       where order_id = p_order_id and student_id = p_student_id
    ) then
      insert into public.question_bank_access as qba
        (student_id, granted, expires_at, note, order_id, granted_at)
      values (
        p_student_id, true,
        now() + make_interval(days => v_order.grants_question_bank_days),
        'Paid: ' || v_order.sku_name, p_order_id, now()
      )
      on conflict (student_id) do update
        set granted    = true,
            expires_at = greatest(coalesce(qba.expires_at, now()), now())
                         + make_interval(days => v_order.grants_question_bank_days),
            note       = 'Paid: ' || v_order.sku_name,
            order_id   = p_order_id;
    end if;
  end if;

  if v_order.grants_ia_markings is not null then
    update public.ia_credit_entries
       set student_id = p_student_id
     where order_id = p_order_id and reason = 'purchase';
    insert into public.ia_credit_entries (student_id, delta, reason, order_id, note)
    values (p_student_id, v_order.grants_ia_markings * greatest(v_order.quantity, 1),
            'purchase', p_order_id, 'Paid: ' || v_order.sku_name)
    on conflict do nothing;
  end if;

  if v_order.grants_tutoring_hours is not null then
    update public.tutoring_hour_entries
       set student_id = p_student_id
     where order_id = p_order_id and reason = 'purchase';
    insert into public.tutoring_hour_entries (student_id, minutes, reason, order_id, note)
    values (p_student_id, v_order.grants_tutoring_hours * 60 * greatest(v_order.quantity, 1),
            'purchase', p_order_id, 'Paid: ' || v_order.sku_name)
    on conflict do nothing;
  end if;
end;
$$;

revoke all on function public.link_order_to_student(uuid, uuid) from public, anon;
grant execute on function public.link_order_to_student(uuid, uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Taking hours back
--
-- Only what has not been booked. A refunded order whose hours were already
-- taught does not leave the student in debt: the balance is clamped at what
-- is still free, exactly as the IA credits are.
--
-- How much is owed back depends on why. A refund returned the money, so every
-- hour it bought is owed. An instalment plan that ended early (the order is
-- 'cancelled') kept what was paid, so only the unpaid share of the hours is
-- owed: two of four instalments paid keeps half the hours.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_tutoring_hours_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_granted    integer;
  v_owed       integer;
  v_free       integer;
  v_take       integer;
  v_order      record;
begin
  select student_id, minutes into v_student_id, v_granted
  from public.tutoring_hour_entries
  where order_id = p_order_id and reason = 'purchase'
  limit 1;

  if v_student_id is null then
    return 0;
  end if;

  if exists (
    select 1 from public.tutoring_hour_entries
    where order_id = p_order_id and reason = 'refund'
  ) then
    return 0;
  end if;

  select status, amount_paid_minor, amount_total_minor into v_order
  from public.orders where id = p_order_id;

  v_owed := v_granted;
  if v_order.status = 'cancelled' and coalesce(v_order.amount_total_minor, 0) > 0 then
    v_owed := ceil(
      v_granted * greatest(v_order.amount_total_minor - v_order.amount_paid_minor, 0)::numeric
        / v_order.amount_total_minor
    )::integer;
  end if;

  v_free := public.tutoring_minutes_purchased(v_student_id) - (
    select coalesce(sum(duration_minutes), 0)::integer
      from public.lessons
     where student_id = v_student_id and status <> 'cancelled'
  );
  v_take := least(v_owed, greatest(v_free, 0));

  if v_take <= 0 then
    return 0;
  end if;

  insert into public.tutoring_hour_entries
    (student_id, minutes, reason, order_id, note)
  values (v_student_id, -v_take, 'refund', p_order_id, 'Order refunded or cancelled');

  return v_take;
end;
$$;

revoke all on function public.revoke_tutoring_hours_for_order(uuid) from public, anon, authenticated;
grant execute on function public.revoke_tutoring_hours_for_order(uuid) to service_role;

-- ---------------------------------------------------------------------------
-- Backfill
--
-- Orders placed before this migration carry no grants_tutoring_hours, so the
-- catalogue's hours are written onto them once, here. This is the one place
-- the catalogue is restated in SQL; catalogue.test.mts compares the two so a
-- package added later cannot be missed silently. After this, checkout writes
-- the column itself.
--
-- Already-claimed paid orders are then credited directly, so a student who
-- bought hours last month sees them today rather than never.
-- ---------------------------------------------------------------------------
update public.orders
   set grants_tutoring_hours = case sku_slug
         when 'single-session'  then 1
         when 'starter-5hr'     then 5
         when 'standard-10hr'   then 10
         when 'committed-20hr'  then 20
         when 'foundation-10s'  then 20
         when 'momentum-20s'    then 40
         when 'achiever-40s'    then 80
         when 'elite-60s'       then 120
         when 'ia-strategy'     then 6
         when 'exam-strategy'   then 8
         when 'mock-exam'       then 2
       end
 where grants_tutoring_hours is null;

insert into public.tutoring_hour_entries (student_id, minutes, reason, order_id, note)
select o.student_id,
       o.grants_tutoring_hours * 60 * greatest(o.quantity, 1),
       'purchase',
       o.id,
       'Paid: ' || o.sku_name
  from public.orders o
 where o.student_id is not null
   and o.grants_tutoring_hours is not null
   -- past_due too: it was claimed while the plan was running, and a failed
   -- instalment is retried, not a withdrawal of the lessons.
   and o.status in ('paid', 'instalments_active', 'past_due', 'completed')
on conflict do nothing;

-- ---------------------------------------------------------------------------
-- 2. Class boards
-- ---------------------------------------------------------------------------
create table public.class_boards (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,
  -- Null for a board shared across every subject.
  subject_id  uuid references public.subjects (id) on delete set null,
  label       text not null check (char_length(label) between 1 and 80),
  -- https only: a board link is opened by a sixteen-year-old with one click,
  -- and javascript: or http: have no business being one.
  url         text not null check (url ~* '^https://[^\s]+$' and char_length(url) <= 2000),
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index class_boards_student_idx on public.class_boards (student_id, created_at);

comment on table public.class_boards is
  'Links to the shared whiteboards a tutor and student use across lessons.';

-- ---------------------------------------------------------------------------
-- 3. Study plans — one living document per student
-- ---------------------------------------------------------------------------
create table public.study_plans (
  student_id      uuid primary key references public.students (id) on delete cascade,
  -- Where things stand: the tutor's review across lessons, in prose.
  review          text check (review is null or char_length(review) <= 6000),
  -- What the student is working towards.
  goals           text[] not null default '{}',
  -- What the next few weeks concentrate on.
  focus_areas     text[] not null default '{}',
  next_review_on  date,
  updated_by      uuid references public.profiles (id),
  updated_at      timestamptz not null default now()
);

comment on table public.study_plans is
  'The tutor''s overall review of a student and the plan ahead. Lesson notes '
  'cover one lesson; this covers the course.';

create trigger study_plans_touch
  before update on public.study_plans
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- RLS
--
-- Hours: the student and their parents read the ledger (they paid), a tutor
-- reads it for the students they teach (they schedule against it), and only
-- an administrator writes by hand. Purchases arrive through the security
-- definer claim function.
--
-- Boards and plans: read by the student, their parents and their tutors;
-- written by their tutors and administrators.
-- ---------------------------------------------------------------------------
alter table public.tutoring_hour_entries enable row level security;
alter table public.class_boards          enable row level security;
alter table public.study_plans           enable row level security;

create policy "tutoring_hour_entries: student reads own"
  on public.tutoring_hour_entries for select
  using (student_id = public.current_student_id());

create policy "tutoring_hour_entries: parent reads children"
  on public.tutoring_hour_entries for select
  using (public.parent_of_student(student_id));

create policy "tutoring_hour_entries: tutor reads assigned"
  on public.tutoring_hour_entries for select
  using (public.tutor_teaches_student(student_id));

create policy "tutoring_hour_entries: admin all"
  on public.tutoring_hour_entries for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "class_boards: student reads own"
  on public.class_boards for select
  using (student_id = public.current_student_id());

create policy "class_boards: parent reads children"
  on public.class_boards for select
  using (public.parent_of_student(student_id));

create policy "class_boards: tutor manages assigned"
  on public.class_boards for all
  using (public.tutor_teaches_student(student_id))
  with check (public.tutor_teaches_student(student_id));

create policy "class_boards: admin all"
  on public.class_boards for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "study_plans: student reads own"
  on public.study_plans for select
  using (student_id = public.current_student_id());

create policy "study_plans: parent reads children"
  on public.study_plans for select
  using (public.parent_of_student(student_id));

create policy "study_plans: tutor manages assigned"
  on public.study_plans for all
  using (public.tutor_teaches_student(student_id))
  with check (public.tutor_teaches_student(student_id));

create policy "study_plans: admin all"
  on public.study_plans for all
  using (public.is_admin())
  with check (public.is_admin());
