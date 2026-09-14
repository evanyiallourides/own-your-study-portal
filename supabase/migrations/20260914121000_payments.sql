-- ---------------------------------------------------------------------------
-- Payments
--
-- The question bank migration ended with a promise: "There is no payments
-- integration here. When one arrives, its webhook writes this same table and
-- nothing else has to change." This keeps it. `has_question_bank_access()` is
-- not touched, `paid-access.ts` is not touched, and the two gated API routes
-- are not touched. A webhook now writes `question_bank_access` exactly where an
-- administrator writes it.
--
-- The hard part is not the money, it is the person. Buyers arrive from a static
-- marketing site with no account — the portal has no self-signup, invitations
-- are how people get in — so at the moment a payment succeeds there is often no
-- `students` row to attach an entitlement to. An order therefore records the
-- buyer's email, and `claim_orders_for_profile()` attaches it later: when an
-- administrator links it by hand, when the webhook finds a profile that already
-- matches, or on its own the first time that person signs in.
--
-- Money is stored in minor units of the currency it was charged in, never
-- converted on the way in. A sale in euros is a sale in euros; converting at
-- write time bakes in a rate nobody can reproduce later, and the only rate the
-- accounts care about is the one Stripe used at payout.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- customers — the Stripe customer, and the portal person if we know them yet
-- ---------------------------------------------------------------------------
create table public.customers (
  stripe_customer_id text primary key,
  email              text not null,
  name               text,
  -- Nullable, and deliberately not unique: one person can buy twice under two
  -- addresses and end up with two Stripe customers. Merging them is an
  -- administrator's judgement, not something a constraint should force.
  profile_id         uuid references public.profiles (id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index customers_email_idx on public.customers (lower(email));
create index customers_profile_idx on public.customers (profile_id);

comment on table public.customers is
  'Stripe customers. Email is the only join to a portal profile at the moment '
  'of purchase, because buyers are anonymous until they are invited.';

-- ---------------------------------------------------------------------------
-- orders
-- ---------------------------------------------------------------------------
create type public.order_status as enum (
  'pending',              -- checkout session created, nothing paid
  'paid',                 -- paid outright
  'instalments_active',   -- first instalment taken, schedule running
  'past_due',             -- an instalment failed; Stripe is still retrying
  'completed',            -- paid in full, including the last instalment
  'refunded',
  'cancelled'
);

create table public.orders (
  id                              uuid primary key default gen_random_uuid(),

  stripe_checkout_session_id      text unique,
  stripe_payment_intent_id        text,
  stripe_subscription_id          text,
  stripe_subscription_schedule_id text,
  stripe_customer_id              text references public.customers (stripe_customer_id),

  -- The catalogue lives in TypeScript, so this is not a foreign key. The name
  -- is snapshotted beside it: renaming a package later must not rewrite what
  -- somebody was told they were buying.
  sku_slug                        text not null,
  sku_name                        text not null,
  plan                            text not null check (plan in ('full', 'instalments')),
  quantity                        integer not null default 1 check (quantity > 0),
  instalment_months               integer check (instalment_months is null or instalment_months >= 2),
  instalments_paid                integer not null default 0 check (instalments_paid >= 0),

  currency                        text not null check (currency in ('usd', 'eur', 'gbp', 'aud')),
  amount_total_minor              integer not null check (amount_total_minor >= 0),
  amount_paid_minor               integer not null default 0 check (amount_paid_minor >= 0),
  -- What Stripe Tax actually charged, as opposed to what the catalogue assumed.
  -- Reconciled from the session, never computed here.
  tax_amount_minor                integer not null default 0 check (tax_amount_minor >= 0),

  -- Denormalised from the catalogue at purchase. What was bought does not
  -- change when the catalogue does.
  grants_question_bank_days       integer check (grants_question_bank_days is null or grants_question_bank_days > 0),

  status                          public.order_status not null default 'pending',
  buyer_email                     text not null,
  buyer_name                      text,
  buyer_country                   text,
  source_site                     text,

  student_id                      uuid references public.students (id) on delete set null,
  claimed_at                      timestamptz,
  claimed_by                      uuid references public.profiles (id),

  note                            text,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now()
);

create index orders_buyer_email_idx on public.orders (lower(buyer_email));
create index orders_status_idx on public.orders (status);
create index orders_student_idx on public.orders (student_id);
create index orders_subscription_idx on public.orders (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- This partial index *is* the unmatched-payments queue: money taken, nobody to
-- give it to. It is the only part of the admin screen that requires action.
create index orders_unmatched_idx on public.orders (created_at desc)
  where student_id is null and status <> 'pending';

comment on table public.orders is
  'One row per checkout attempt, created before the redirect to Stripe so an '
  'abandoned checkout is visible and the webhook has an unambiguous key.';

-- ---------------------------------------------------------------------------
-- order_payments — every movement of money against an order
-- ---------------------------------------------------------------------------
create table public.order_payments (
  id               uuid primary key default gen_random_uuid(),
  order_id         uuid not null references public.orders (id) on delete cascade,
  stripe_object_id text not null,
  kind             text not null check (kind in ('payment', 'refund', 'failure', 'dispute')),
  amount_minor     integer not null,
  currency         text not null,
  -- From the balance transaction. Stripe nets fees out of payouts and Xero
  -- wants gross plus fee, so it is captured here rather than recomputed.
  fee_minor        integer,
  tax_minor        integer,
  occurred_at      timestamptz not null default now(),
  detail           text,
  -- Makes double-counting the first instalment impossible by construction:
  -- checkout.session.completed and invoice.paid both describe it, and whichever
  -- arrives second is rejected rather than added.
  unique (order_id, stripe_object_id, kind)
);

create index order_payments_order_idx on public.order_payments (order_id, occurred_at desc);

-- ---------------------------------------------------------------------------
-- Links back into what already existed
-- ---------------------------------------------------------------------------
alter table public.question_bank_access
  add column if not exists order_id uuid references public.orders (id) on delete set null;

comment on column public.question_bank_access.order_id is
  'The order that paid for this access, when one did. Null for an '
  'administrator grant or a comp.';

-- Same traceability the Recall handler gets from lesson_id.
alter table public.webhook_events
  add column if not exists order_id uuid references public.orders (id) on delete set null;

alter table public.app_settings
  add column if not exists auto_invite_paid_buyers boolean not null default false;

comment on column public.app_settings.auto_invite_paid_buyers is
  'Whether a paid order from an unknown email should send a portal invitation '
  'automatically. Off by default: creating accounts from payments should be a '
  'deliberate choice.';

-- ---------------------------------------------------------------------------
-- claim_orders_for_profile — the answer to the anonymous buyer
--
-- Called from three places and identical in all three, because three copies of
-- "what does this payment entitle you to" is how two of them end up wrong.
--
-- A renewal EXTENDS. Somebody who buys a second year six months in keeps the
-- six months they already paid for; taking `greatest(expires_at, now())` as the
-- base is the whole of that rule.
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
      and lower(buyer_email) = lower(v_email)
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

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;

comment on function public.claim_orders_for_profile(uuid) is
  'Attaches paid orders to a newly known student and applies what they granted. '
  'Safe to call repeatedly: only orders with no student are considered.';

-- ---------------------------------------------------------------------------
-- handle_new_user — now also claims anything already paid for
--
-- Re-stated in full because `create or replace` takes the whole body. The only
-- change is the claim block at the end, and it swallows its own errors: a
-- failure to attach an order must never stop somebody signing in. An unclaimed
-- order is visible in the admin queue; a signup that 500s is not.
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

  if coalesce(requested_role, 'student') = 'student' then
    begin
      perform public.claim_orders_for_profile(new.id);
    exception when others then
      null;
    end;
  end if;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- RLS
--
-- A student sees their own orders and a parent their children's, because they
-- will ask what they paid and when. Tutors get nothing: a tutor has no business
-- in a student's billing, and giving them read access "for completeness" is how
-- a support conversation turns into a privacy incident.
--
-- `customers` has no read policy for anyone but an administrator. It holds the
-- email of every anonymous buyer, including people who never became students.
--
-- Note that an unclaimed order has `student_id is null`, and `null = uuid` is
-- null rather than true — so the student policy matches nothing and unmatched
-- buyers stay administrator-only by construction, not by a second rule that
-- somebody could forget to write.
-- ---------------------------------------------------------------------------
alter table public.customers enable row level security;
alter table public.orders enable row level security;
alter table public.order_payments enable row level security;

create policy "customers: admin all"
  on public.customers for all
  using (public.is_admin())
  with check (public.is_admin());

create policy "orders: student reads own"
  on public.orders for select
  using (student_id = public.current_student_id());

create policy "orders: parent reads children"
  on public.orders for select
  using (public.parent_of_student(student_id));

create policy "orders: admin all"
  on public.orders for all
  using (public.is_admin())
  with check (public.is_admin());

create or replace function public.can_read_order(p_order_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.orders o
    where o.id = p_order_id
      and (
        public.is_admin()
        or o.student_id = public.current_student_id()
        or public.parent_of_student(o.student_id)
      )
  );
$$;

create policy "order_payments: readable with the order"
  on public.order_payments for select
  using (public.can_read_order(order_id));

create policy "order_payments: admin all"
  on public.order_payments for all
  using (public.is_admin())
  with check (public.is_admin());

create trigger customers_touch
  before update on public.customers
  for each row execute function public.touch_updated_at();

create trigger orders_touch
  before update on public.orders
  for each row execute function public.touch_updated_at();
