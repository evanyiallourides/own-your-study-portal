-- ---------------------------------------------------------------------------
-- Notification kind for IA review escalations
--
-- Its own migration, and before the one that creates the tables, for the same
-- reason the payment kinds got theirs: `alter type ... add value` cannot be
-- used in the transaction that adds it. Splitting it is the documented way
-- round that rather than a filing preference.
-- ---------------------------------------------------------------------------

alter type public.notification_kind add value if not exists 'ia_review_requested';
