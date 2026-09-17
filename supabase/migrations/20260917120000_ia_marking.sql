-- ---------------------------------------------------------------------------
-- IA review — credits, submissions, reviews, and the descriptor packs
--
-- An internal assessment is uploaded, read against the published criteria, and
-- returned as a written review. One review costs one credit, and credits are
-- bought at checkout or granted by an administrator.
--
-- Four tables, and the reason each is separate:
--
--   ia_credit_entries    a LEDGER, not a balance. A balance column and a
--                        refund are a race; a ledger is what actually happened
--                        and the balance is derived from it. It also answers
--                        "why do I have two credits?" without a support email.
--
--   ia_submissions       one uploaded document. Holds the routing inputs the
--                        student gave — subject, level, session, stage —
--                        because the session is what selects a marking model
--                        and it must be recorded next to the file rather than
--                        inferred later from the upload date.
--
--   ia_reviews           what came back. Many per submission: a student who
--                        revises and re-runs gets a second review, and the
--                        first must not be overwritten — the pair is the only
--                        evidence that the advice was worth taking.
--
--   ia_assessment_packs  IB's achievement descriptors, installed by an
--                        administrator who is licensed to hold them. Not in
--                        the repository, admin-only at every level, and until
--                        one is installed the reviews carry no marks at all.
--                        See src/lib/ia/packs.ts.
--
-- The credit is spent when a review is STORED, not when one is requested. A
-- model call that fails, a PDF that turns out to be a photograph of a desk, a
-- 2029 Maths session we cannot mark — none of those costs the student
-- anything, and the ledger is what makes that guarantee mechanical rather than
-- a promise in a support reply.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- What an order grants
--
-- Deliberately a second column rather than a reuse of grants_question_bank_days:
-- one is a licence measured in days, the other a countable credit, and they
-- renew differently. A licence bought twice extends; a credit bought twice
-- adds. Collapsing them into one column would force one of those two rules
-- onto both.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists grants_ia_markings integer
    check (grants_ia_markings is null or grants_ia_markings > 0);

comment on column public.orders.grants_ia_markings is
  'IA review credits this order buys, per unit of quantity. Applied on '
  'settlement by claim_orders_for_profile(), never on authorisation.';

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------
create table public.ia_credit_entries (
  id          uuid primary key default gen_random_uuid(),
  student_id  uuid not null references public.students (id) on delete cascade,

  -- Positive buys, negative spends. Never zero: an entry that changes nothing
  -- is a note, and there is a column for those.
  delta       integer not null check (delta <> 0),

  reason      text not null check (reason in (
                'purchase',      -- an order settled
                'admin_grant',   -- goodwill, or bundled with a package
                'review',        -- spent on a review that was stored
                'refund',        -- an order came back; unused credits with it
                'correction'     -- an administrator fixing a mistake
              )),

  -- Whichever of these applies. Both null for an admin grant.
  order_id    uuid references public.orders (id) on delete set null,

  note        text,
  created_by  uuid references public.profiles (id),
  created_at  timestamptz not null default now()
);

create index ia_credit_entries_student_idx
  on public.ia_credit_entries (student_id, created_at desc);

-- One order grants once. Without this a webhook retry, or an administrator
-- clicking twice, doubles somebody's credits — and the delivery of a webhook
-- more than once is normal rather than exceptional.
create unique index ia_credit_entries_order_purchase_idx
  on public.ia_credit_entries (order_id)
  where reason = 'purchase';

comment on table public.ia_credit_entries is
  'Every movement of IA review credit. The balance is the sum of deltas; there '
  'is deliberately no balance column to disagree with it.';

create or replace function public.ia_credit_balance(p_student_id uuid)
returns integer
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(sum(delta), 0)::integer
  from public.ia_credit_entries
  where student_id = p_student_id;
$$;

-- ---------------------------------------------------------------------------
-- Submissions
-- ---------------------------------------------------------------------------
create type public.ia_subject as enum ('biology', 'chemistry', 'maths_aa');
create type public.ia_stage   as enum ('partial_draft', 'complete_draft', 'final');

create type public.ia_submission_status as enum (
  'uploaded',     -- the file is in storage, nothing has run
  'reviewing',    -- a review is in flight
  'reviewed',     -- a review exists
  'failed'        -- it could not be reviewed; no credit was spent
);

create table public.ia_submissions (
  id            uuid primary key default gen_random_uuid(),
  student_id    uuid not null references public.students (id) on delete cascade,

  subject       public.ia_subject not null,
  level         text not null check (level in ('SL', 'HL')),

  -- "May 2027". Stored as the student gave it, because it is what selects the
  -- marking model and a model chosen from the upload date is the mistake all
  -- three assessment packs warn about first.
  session_month text not null check (session_month in ('May', 'November')),
  session_year  integer not null check (session_year between 2024 and 2032),

  stage         public.ia_stage not null,

  -- Storage object key, `ia/<submission_id>/<filename>`.
  storage_path  text not null,
  file_name     text not null,
  file_size     integer not null check (file_size > 0),
  -- SHA-256 of the bytes. Identifies the exact file a review was produced
  -- from, and makes a re-upload of an unchanged document recognisable.
  file_hash     text not null,
  word_count    integer,

  -- What the student asked us to look at. Evidence about their concerns; never
  -- an instruction about marking. The prompt says so, and so does this.
  student_note  text,

  status        public.ia_submission_status not null default 'uploaded',
  failure_note  text,

  -- Set when the student asks to have it looked at by a person. The upsell
  -- into the IA & EE Strategy Package is a conversation with an administrator,
  -- not an automatic charge, so this is a flag and a notification rather than
  -- a second checkout.
  professional_review_requested_at timestamptz,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index ia_submissions_student_idx
  on public.ia_submissions (student_id, created_at desc);

create index ia_submissions_status_idx
  on public.ia_submissions (status) where status in ('reviewing', 'failed');

-- The queue an administrator works: somebody has asked for a person to read it.
create index ia_submissions_escalated_idx
  on public.ia_submissions (professional_review_requested_at desc)
  where professional_review_requested_at is not null;

create trigger ia_submissions_touch
  before update on public.ia_submissions
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- Reviews
--
-- The review body is jsonb rather than fifty columns. It is a document
-- produced against a versioned contract (src/lib/ia/schema.ts), it is read as
-- a whole, and the shape will change as the contract does — which is exactly
-- the case jsonb is for. The fields lifted out into columns are the ones
-- something QUERIES: the mode, the total, and the pack it was produced under.
-- ---------------------------------------------------------------------------
create table public.ia_reviews (
  id              uuid primary key default gen_random_uuid(),
  submission_id   uuid not null references public.ia_submissions (id) on delete cascade,

  -- Which marking model, which descriptors, which prompt, which model. All
  -- four are needed to explain a mark a year from now, and a review that
  -- cannot be explained should not have been shown.
  rubric_id       text not null,
  pack_version    text,
  pack_checksum   text,
  prompt_version  text not null,
  model_id        text not null,

  mode            text not null check (mode in ('marking', 'feedback_only')),
  -- Never anything else until a benchmark has been run against real reference
  -- marks. The check is here so that changing it is a deliberate act.
  calibration_status text not null default 'uncalibrated'
    check (calibration_status = 'uncalibrated'),

  -- Null whenever any criterion is unassessed. The constraint below is the
  -- database's half of the same rule the TypeScript enforces: a total is a
  -- claim that every criterion was assessed, and in feedback mode none was.
  total           integer check (total is null or total >= 0),
  max_total       integer not null check (max_total > 0),

  body            jsonb not null,

  created_at      timestamptz not null default now(),

  constraint ia_reviews_no_total_without_marking
    check (mode = 'marking' or total is null)
);

create index ia_reviews_submission_idx
  on public.ia_reviews (submission_id, created_at desc);

comment on constraint ia_reviews_no_total_without_marking on public.ia_reviews is
  'A feedback-only review has no total. Enforced here as well as in TypeScript '
  'because a mark out of 24 on work nobody had the descriptors for is the one '
  'output this subsystem exists to prevent.';

-- ---------------------------------------------------------------------------
-- Assessment packs
--
-- IB's achievement descriptors, which we do not ship and may not publish. An
-- administrator installs the material their centre is licensed to hold; until
-- then every review is feedback-only, which is the designed behaviour and not
-- a degraded one.
--
-- Admin-only for select as well as for write. A student has no reason to read
-- the descriptor text through the API, and "readable by anyone signed in" is
-- how licensed material ends up somewhere it should not be.
-- ---------------------------------------------------------------------------
create table public.ia_assessment_packs (
  rubric_id     text primary key,
  version       text not null,
  source        text not null,
  checksum      text not null,
  body          jsonb not null,
  installed_by  uuid references public.profiles (id),
  installed_at  timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create trigger ia_assessment_packs_touch
  before update on public.ia_assessment_packs
  for each row execute function public.touch_updated_at();

comment on table public.ia_assessment_packs is
  'Official IB achievement descriptors, installed by a licensed operator. Not '
  'in the repository and not readable by students. No pack installed for a '
  'model means every review against that model withholds marks.';

-- ---------------------------------------------------------------------------
-- Spending a credit
--
-- One function, so the balance check and the ledger write cannot be separated
-- by a second request. Two tabs and a slow model call is not a rare case; it
-- is what a nervous student does the night before a deadline.
--
-- Returns the new balance, or raises if there is nothing to spend. The caller
-- stores the review first and calls this after: a review that exists and was
-- not paid for is a bookkeeping error, and a payment for a review that does
-- not exist is somebody's forty-five dollars.
-- ---------------------------------------------------------------------------
create or replace function public.spend_ia_credit(
  p_student_id uuid,
  p_note       text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  -- Serialise against concurrent spends for this student. Locking the student
  -- row is enough: every entry for them goes through here.
  perform 1 from public.students where id = p_student_id for update;

  v_balance := public.ia_credit_balance(p_student_id);
  if v_balance < 1 then
    raise exception 'No IA review credit available for student %', p_student_id
      using errcode = 'check_violation';
  end if;

  insert into public.ia_credit_entries (student_id, delta, reason, note)
  values (p_student_id, -1, 'review', p_note);

  return v_balance - 1;
end;
$$;

-- ---------------------------------------------------------------------------
-- Applying what an order granted
--
-- `create or replace` takes the whole body, so the function is restated in
-- full. The only change is the ia_markings block. Everything else is carried
-- forward verbatim from 20260915100000_auto_enrol_buyers.sql — in particular
-- the match on `coalesce(student_email, buyer_email)`, which is what stops a
-- parent collecting the entitlement they bought for their child. Restating
-- this function is the one place a fix like that can be silently undone, and
-- migrations.test.mts is what catches it when it is.
--
-- Credits are multiplied by the order's quantity. Somebody sitting Biology,
-- Chemistry and Maths buys three, and would otherwise pay for three and
-- receive one.
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
      -- on conflict do nothing, against the unique index on (order_id) where
      -- reason = 'purchase': claiming is safe to run repeatedly, and a second
      -- run must not top the balance up again.
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

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

-- ---------------------------------------------------------------------------
-- Taking it back
--
-- A refund reclaims credits that have not been used. It does not claw back a
-- review already produced: the work was done and the student has read it.
-- Clamped at zero for the same reason — a student who bought one, used it, and
-- was refunded goes to zero, not to minus one, because a negative balance is a
-- debt we did not agree to extend.
-- ---------------------------------------------------------------------------
create or replace function public.revoke_ia_credits_for_order(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_student_id uuid;
  v_granted    integer;
  v_balance    integer;
  v_take       integer;
begin
  select student_id, delta into v_student_id, v_granted
  from public.ia_credit_entries
  where order_id = p_order_id and reason = 'purchase'
  limit 1;

  if v_student_id is null then
    return 0;
  end if;

  -- Already reversed? Then there is nothing to do, and doing it twice would
  -- take credits the student bought with a different order.
  if exists (
    select 1 from public.ia_credit_entries
    where order_id = p_order_id and reason = 'refund'
  ) then
    return 0;
  end if;

  v_balance := public.ia_credit_balance(v_student_id);
  v_take := least(v_granted, greatest(v_balance, 0));

  if v_take <= 0 then
    return 0;
  end if;

  insert into public.ia_credit_entries
    (student_id, delta, reason, order_id, note)
  values (v_student_id, -v_take, 'refund', p_order_id, 'Order refunded or cancelled');

  return v_take;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- A student reads their own submissions, their own reviews and their own
-- ledger, and writes none of them — every write goes through the API, which
-- checks the credit. Tutors read the students they already teach, so an IA can
-- be discussed in a lesson. Parents see that a review happened and what it
-- cost, and not its contents: the feedback is the student's.
-- ---------------------------------------------------------------------------
alter table public.ia_credit_entries    enable row level security;
alter table public.ia_submissions       enable row level security;
alter table public.ia_reviews           enable row level security;
alter table public.ia_assessment_packs  enable row level security;

create policy "ia_credit_entries: student reads own"
  on public.ia_credit_entries for select
  using (student_id = public.current_student_id());

create policy "ia_credit_entries: parent reads children"
  on public.ia_credit_entries for select
  using (public.parent_of_student(student_id));

create policy "ia_credit_entries: admin all"
  on public.ia_credit_entries for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "ia_submissions: student reads own"
  on public.ia_submissions for select
  using (student_id = public.current_student_id());

create policy "ia_submissions: tutor reads taught"
  on public.ia_submissions for select
  using (public.tutor_teaches_student(student_id));

create policy "ia_submissions: admin all"
  on public.ia_submissions for all
  using (public.is_admin())
  with check (public.is_admin());

-- Reviews follow their submission rather than restating who may read it. One
-- rule, one place; a second copy is how two tables end up disagreeing about
-- whose coursework it is.
create or replace function public.can_read_ia_submission(p_submission_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.ia_submissions s
    where s.id = p_submission_id
      and (
        s.student_id = public.current_student_id()
        or public.tutor_teaches_student(s.student_id)
        or public.is_admin()
      )
  );
$$;

create policy "ia_reviews: readable with the submission"
  on public.ia_reviews for select
  using (public.can_read_ia_submission(submission_id));

create policy "ia_reviews: admin all"
  on public.ia_reviews for all
  using (public.is_admin())
  with check (public.is_admin());

-- No student or tutor policy at all. Licensed descriptor text, administrators
-- only, read as well as write.
create policy "ia_assessment_packs: admin all"
  on public.ia_assessment_packs for all
  using (public.is_admin())
  with check (public.is_admin());

-- ---------------------------------------------------------------------------
-- Storage
--
-- A second bucket rather than a folder in lesson-files: the access rule is
-- different (a submission belongs to a student, not to a lesson), and reusing
-- the bucket would mean one policy function deciding both. Keyed
-- `ia/<submission_id>/<filename>`, so the submission's own rules apply to the
-- object without a second lookup path.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'ia-submissions',
  'ia-submissions',
  false,
  26214400, -- 25 MB, matching MAX_UPLOAD_BYTES in src/lib/ia/extract.ts
  array[
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'text/plain',
    'text/markdown'
  ]
)
on conflict (id) do update
  set file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

create or replace function public.storage_ia_submission_id(p_name text)
returns uuid
language plpgsql
immutable
as $$
declare
  parts text[] := string_to_array(p_name, '/');
begin
  if array_length(parts, 1) < 3 or parts[1] <> 'ia' then
    return null;
  end if;
  return parts[2]::uuid;
exception when others then
  return null;
end;
$$;

create policy "ia submissions: readable with the submission"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'ia-submissions'
    and public.can_read_ia_submission(public.storage_ia_submission_id(name))
  );

-- Uploads go through the API with the service role, which is what checks the
-- credit balance first. A client that could write here directly could store a
-- document without spending one.
create policy "ia submissions: admin writes"
  on storage.objects for all
  to authenticated
  using (bucket_id = 'ia-submissions' and public.is_admin())
  with check (bucket_id = 'ia-submissions' and public.is_admin());
