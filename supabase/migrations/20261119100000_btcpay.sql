-- Bitcoin is optional and stays disabled until live configuration is explicitly supplied.
alter domain public.payment_provider drop constraint payment_provider_check;
alter domain public.payment_provider add constraint payment_provider_check
  check (value in ('stripe', 'gocardless', 'wise', 'btcpay'));

alter table public.orders add column btcpay_status text;
alter table public.orders add column btcpay_additional_status text;
create unique index orders_btcpay_invoice_unique on public.orders(provider_checkout_id)
  where provider = 'btcpay' and provider_checkout_id is not null;

-- Only the authenticated server-side reconciler may invoke this function.
-- The row lock and transaction make duplicate/concurrent webhook deliveries safe.
create function public.settle_btcpay_order(
  p_order_id uuid, p_invoice_id text, p_amount_minor integer,
  p_currency text, p_additional_status text
) returns void language plpgsql security definer set search_path = public as $$
declare
  o public.orders%rowtype;
  student_profile uuid;
begin
  select * into o from public.orders where id = p_order_id and provider = 'btcpay' for update;
  if not found then raise exception 'BTCPay order not found'; end if;
  if o.provider_checkout_id is distinct from p_invoice_id
     or o.amount_total_minor is distinct from p_amount_minor
     or o.currency is distinct from p_currency
     or p_additional_status is null or p_additional_status not in ('None', 'PaidOver')
     or o.plan <> 'full' then raise exception 'Invoice mismatch'; end if;
  if o.status in ('paid', 'completed', 'refunded') then return; end if;
  if o.status <> 'pending' then raise exception 'Order requires manual review'; end if;
  insert into public.order_payments(order_id, provider_object_id, kind, amount_minor, currency, detail)
    values(o.id, p_invoice_id, 'payment', p_amount_minor, p_currency,
      case when p_additional_status = 'PaidOver' then 'Bitcoin settled; excess requires manual refund review'
           else 'Bitcoin settled' end);
  update public.orders set status = 'paid', amount_paid_minor = p_amount_minor,
    provider_payment_id = p_invoice_id, btcpay_status = 'Settled',
    btcpay_additional_status = p_additional_status where id = o.id;
  select id into student_profile from public.profiles
    where lower(email) = lower(coalesce(o.student_email, o.buyer_email)) and role = 'student' limit 1;
  if student_profile is not null then perform public.claim_orders_for_profile(student_profile); end if;
  insert into public.notifications(profile_id, kind, title, body)
    select id, 'payment_received', 'Bitcoin payment received',
      'Order ' || o.id::text || ' settled. ' ||
      case when student_profile is null then 'Invite or link the student in Orders. ' else '' end ||
      case when p_additional_status = 'PaidOver' then 'Review the overpayment in BTCPay.' else '' end
    from public.profiles where role = 'admin';
end $$;
revoke all on function public.settle_btcpay_order(uuid,text,integer,text,text) from public, anon, authenticated;
grant execute on function public.settle_btcpay_order(uuid,text,integer,text,text) to service_role;
