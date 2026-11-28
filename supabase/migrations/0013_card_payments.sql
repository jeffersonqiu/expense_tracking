-- 0013: card bill payments (paying off a credit card) are their own kind: tracked and
-- grouped, never counted as spending (the card purchases themselves are). Safe to re-run.
alter table public.transactions drop constraint if exists transactions_kind_check;
alter table public.transactions add constraint transactions_kind_check
  check (kind in ('spend', 'refund', 'investment', 'transfer', 'income', 'card_payment'));
