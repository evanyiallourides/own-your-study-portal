-- ---------------------------------------------------------------------------
-- A purchase makes two accounts, not one
--
-- auto_enrol_buyers turned a payment into a student. It stopped there, and the
-- half it left out is the half that paid: a parent who buys twenty hours for
-- their child got no account at all, so the parent dashboard was unreachable
-- by exactly the people it was built for. An administrator had to write the
-- profile, the parents row and the link by hand, because nothing in the
-- application could.
--
-- The relationship is already recorded. An order carries buyer_email and, when
-- they differ, student_email — that pair IS the assertion "I am this child's
-- parent". What was missing is the buyer's answer to whether the assertion is
-- a parental one, and something that acts on it.
-- ---------------------------------------------------------------------------

-- ---------------------------------------------------------------------------
-- Did the buyer say they were the parent?
--
-- Checkout asks, because nobody else is in a position to know. Somebody paying
-- for an adult friend's tuition has bought lessons, not a standing view of how
-- that friend is getting on, and the two cases are indistinguishable from the
-- payment alone.
--
-- Null is not false: false is "they were asked and said no", null is "the order
-- predates the question". Neither creates a link, but only one of them is worth
-- an administrator's attention.
-- ---------------------------------------------------------------------------

alter table public.orders
  add column if not exists buyer_is_guardian boolean;

comment on column public.orders.buyer_is_guardian is
  'Whether the buyer said at checkout that they are the student''s parent or '
  'guardian. Only meaningful when student_email is set and differs from '
  'buyer_email. Null means the order was taken before the question existed.';

-- ---------------------------------------------------------------------------
-- link_parent_for_profile — the deferred half
--
-- Both people are invited at the same moment and accept whenever they get
-- round to it, in either order, possibly days apart. So this cannot run once:
-- it runs for every new profile and asks the same question from whichever side
-- has just arrived.
--
--   a new parent  -> which of my orders named a student who now has an account?
--   a new student -> which orders named me, bought by a parent who has one?
--
-- Idempotent by the primary key on parent_students, so a second order for the
-- same pair adds nothing and a redelivered webhook cannot double-link.
-- ---------------------------------------------------------------------------
create or replace function public.link_parent_for_profile(p_profile_id uuid)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email     text;
  v_role      public.user_role;
  v_parent_id uuid;
  v_linked    integer := 0;
begin
  select p.email, p.role into v_email, v_role
  from public.profiles p
  where p.id = p_profile_id;

  if v_email is null then
    return 0;
  end if;

  if v_role = 'parent' then
    select id into v_parent_id from public.parents where profile_id = p_profile_id;
    if v_parent_id is null then
      return 0;
    end if;

    insert into public.parent_students (parent_id, student_id, relationship)
    select distinct v_parent_id, s.id, 'Bought their tuition'
      from public.orders o
      join public.profiles sp on lower(sp.email) = lower(o.student_email)
      join public.students s   on s.profile_id = sp.id
     where o.buyer_is_guardian is true
       and o.student_email is not null
       and lower(o.buyer_email) = lower(v_email)
       and lower(o.student_email) <> lower(v_email)
    on conflict do nothing;

    get diagnostics v_linked = row_count;

  elsif v_role = 'student' then
    insert into public.parent_students (parent_id, student_id, relationship)
    select distinct pa.id, s.id, 'Bought their tuition'
      from public.orders o
      join public.profiles pp on lower(pp.email) = lower(o.buyer_email)
      join public.parents pa   on pa.profile_id = pp.id
      join public.students s   on s.profile_id = p_profile_id
     where o.buyer_is_guardian is true
       and o.student_email is not null
       and lower(o.student_email) = lower(v_email)
       and lower(o.buyer_email) <> lower(v_email)
    on conflict do nothing;

    get diagnostics v_linked = row_count;
  end if;

  return v_linked;
end;
$$;

comment on function public.link_parent_for_profile(uuid) is
  'Links a parent to the children they paid for, from the orders themselves. '
  'Runs for a new profile of either role, since the two accept independently. '
  'Safe to call repeatedly.';

-- ---------------------------------------------------------------------------
-- handle_new_user — now also links the family
--
-- Re-stated in full because `create or replace` takes the whole body. Every
-- line below is carried over from the payments migration unchanged; the only
-- addition is the link block at the end. It swallows its own errors exactly as
-- the claim above it does, and for the same reason: an unlinked parent shows on
-- the student's page and is one click to fix, whereas a signup that 500s locks
-- somebody out of an account they have already paid for.
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

  -- Either role can complete a family: a parent accepting after their child,
  -- or a child accepting after their parent. So this one is not guarded by
  -- role — the function itself decides which question to ask.
  begin
    perform public.link_parent_for_profile(new.id);
  exception when others then
    null;
  end;

  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administrators manage the links
--
-- An automatic grant needs an undo, and until now parent_students had no admin
-- policy at all beyond select — the seed wrote it and nothing else could.
-- ---------------------------------------------------------------------------

drop policy if exists "parent_students: admin all" on public.parent_students;

create policy "parent_students: admin all"
  on public.parent_students for all
  using (public.is_admin())
  with check (public.is_admin());
