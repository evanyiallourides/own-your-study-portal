-- ---------------------------------------------------------------------------
-- Wise as a payment provider
--
-- USD, EUR and GBP orders move to Wise: USD has no bank-debit scheme at all
-- for an Australian Stripe account, and EUR/GBP's are still waiting on
-- Stripe's own dashboard verification. AUD orders keep using Stripe exactly
-- as they do today. Widening the domain is the entire schema change that
-- split requires — 'stripe' and 'gocardless' keep meaning exactly what they
-- meant, and nothing that already exists has to move.
--
-- The domain's check constraint was never named when it was created, so
-- Postgres chose a name for it. Looked up here rather than hardcoded: a wrong
-- guess fails the whole migration, and there is no cost to asking Postgres
-- what it actually called it.
-- ---------------------------------------------------------------------------
do $$
declare
  v_constraint_name text;
begin
  select conname into v_constraint_name
  from pg_constraint
  where contypid = 'public.payment_provider'::regtype
    and contype = 'c';

  execute format(
    'alter domain public.payment_provider drop constraint %I',
    v_constraint_name
  );
end $$;

alter domain public.payment_provider
  add constraint payment_provider_check
  check (value in ('stripe', 'gocardless', 'wise'));
