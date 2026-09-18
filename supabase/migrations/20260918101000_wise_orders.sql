-- ---------------------------------------------------------------------------
-- Wise orders: the reference a buyer quotes, and the transfers nobody claimed
--
-- Stripe tells us which order a payment belongs to because the Checkout
-- Session carries `client_reference_id`. A bank transfer carries nothing but
-- whatever text the payer typed into their own bank's reference field, so an
-- order bound for Wise is given a short reference at checkout time and the
-- buyer is asked to quote it. That reference is the only link back to the
-- order once the money leaves their bank.
--
-- A reference that never arrives, or arrives misspelt, is not a hypothetical:
-- it is the normal failure mode of a bank transfer. wise_unmatched_transfers
-- is where a payment lands when nothing matches it, so an administrator has
-- something to search rather than a paragraph in a log.
-- ---------------------------------------------------------------------------
alter table public.orders
  add column if not exists payment_reference text;

create unique index if not exists orders_payment_reference_idx
  on public.orders (payment_reference)
  where payment_reference is not null;

comment on column public.orders.payment_reference is
  'The reference a Wise buyer is asked to quote on their transfer. Null for '
  'every order that is not paid through Wise.';

create table public.wise_unmatched_transfers (
  id                  uuid primary key default gen_random_uuid(),
  wise_transfer_id    text not null unique,
  amount_minor        integer not null,
  currency            text not null,
  -- Whatever text actually arrived on the transfer, verbatim and possibly
  -- empty or garbled — this is what an administrator reads to work out whose
  -- payment it is.
  reference_received  text,
  occurred_at         timestamptz not null,
  matched_order_id    uuid references public.orders (id) on delete set null,
  matched_at          timestamptz,
  matched_by          uuid references public.profiles (id),
  created_at          timestamptz not null default now()
);

-- This partial index *is* the queue: money that arrived and has not been
-- attached to an order yet. The same shape as orders_unmatched_idx.
create index wise_unmatched_transfers_open_idx
  on public.wise_unmatched_transfers (occurred_at desc)
  where matched_order_id is null;

comment on table public.wise_unmatched_transfers is
  'A Wise transfer credited to the business account whose reference did not '
  'match any order. Cleared by an administrator attaching it to one by hand.';

alter table public.wise_unmatched_transfers enable row level security;

-- Admin-only, no student or parent policy at all: this is pre-attribution
-- buyer data, the same reasoning that leaves `customers` administrator-only.
create policy "wise_unmatched_transfers: admin all"
  on public.wise_unmatched_transfers for all
  using (public.is_admin())
  with check (public.is_admin());
