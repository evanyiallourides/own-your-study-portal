-- ---------------------------------------------------------------------------
-- Notification kinds for payments
--
-- Its own migration, and first, because `alter type ... add value` cannot be
-- used in the same transaction that goes on to use the new value. Splitting it
-- is the documented way round that, not a stylistic choice.
-- ---------------------------------------------------------------------------

alter type public.notification_kind add value if not exists 'payment_received';
alter type public.notification_kind add value if not exists 'payment_failed';
alter type public.notification_kind add value if not exists 'order_unmatched';
