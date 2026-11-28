-- 0012: Giving becomes an allocation with three branches:
--   parents  = allowance to parents/family
--   regular  = recurring giving (e.g. a monthly donation to a foundation)
--   adhoc    = one-off gifts and donations
-- Spends already filed under the Giving category move over as ad hoc. Safe to re-run.

alter table public.transactions add column if not exists giving_kind text;
alter table public.transactions drop constraint if exists transactions_giving_kind_check;
alter table public.transactions add constraint transactions_giving_kind_check
  check (giving_kind in ('parents', 'regular', 'adhoc'));

alter table public.transactions drop constraint if exists transactions_allocation_check;
alter table public.transactions add constraint transactions_allocation_check
  check (allocation in ('personal', 'work', 'shared', 'household', 'trip', 'giving'));

update public.transactions t set allocation = 'giving', giving_kind = 'adhoc'
  from public.categories c
 where c.id = t.category_id and c.name = 'Giving'
   and t.allocation in ('personal', 'shared') and t.trip_id is null;

alter table public.transactions drop constraint if exists transactions_giving_check;
alter table public.transactions add constraint transactions_giving_check
  check ((allocation = 'giving') = (giving_kind is not null));

alter table public.knowledge_facts drop constraint if exists knowledge_facts_allocation_check;
alter table public.knowledge_facts add constraint knowledge_facts_allocation_check
  check (allocation in ('personal', 'work', 'shared', 'household', 'trip', 'giving'));

-- Learned facts can name a giving branch in the same "pot" slot as a household pot.
alter table public.knowledge_facts drop constraint if exists knowledge_facts_pot_check;
alter table public.knowledge_facts add constraint knowledge_facts_pot_check
  check (pot in ('allowance', 'bills', 'project', 'parents', 'regular', 'adhoc'));
