-- ---------------------------------------------------------------------------
-- Turn a payment into a portal account
--
-- auto_invite_paid_buyers was added with the payments tables and then read by
-- nothing, so it sat in the settings doing exactly as much as a comment. This
-- turns it on and makes it mean something.
--
-- What it switches on: when somebody pays and no portal account matches the
-- student, one is invited automatically. handle_new_user() then builds the
-- profile and the student row, and claim_orders_for_profile() attaches the
-- order and applies whatever it bought. The buyer gets an email, clicks it, and
-- their purchase is already there.
--
-- Default on, because the alternative is what happens today: the money arrives,
-- the entitlement is recorded against nobody, and a person has to notice. An
-- invitation is not an account — it has to be accepted from the buyer's own
-- inbox — so the worst case of a mistyped address is a stranger receiving an
-- invitation they cannot use, which the admin queue shows anyway.
-- ---------------------------------------------------------------------------

alter table public.app_settings
  alter column auto_invite_paid_buyers set default true;

update public.app_settings set auto_invite_paid_buyers = true;

comment on column public.app_settings.auto_invite_paid_buyers is
  'Whether a paid order from an unrecognised email invites a student account '
  'automatically. On: the buyer is emailed and their purchase is waiting when '
  'they accept. Off: it waits in the administrator queue instead.';

-- ---------------------------------------------------------------------------
-- Who the order is FOR, as distinct from who paid
--
-- buyer_email is the card holder. When a parent buys for a child those are two
-- different people, and matching a claim on the payer would mean the child's
-- own profile never finds the order that bought their lessons.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists student_email text;

comment on column public.orders.student_email is
  'The student this was bought for, when checkout collected it and it differs '
  'from the payer. Null means the buyer is the student.';

create index if not exists orders_student_email_idx
  on public.orders (lower(student_email))
  where student_email is not null;

-- ---------------------------------------------------------------------------
-- Claim on the student's address, falling back to the payer's
--
-- Otherwise identical to the version in the payments migration: only unclaimed
-- paid orders, and a renewal still extends rather than resets.
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

    v_claimed := v_claimed + 1;
  end loop;

  return v_claimed;
end;
$$;
