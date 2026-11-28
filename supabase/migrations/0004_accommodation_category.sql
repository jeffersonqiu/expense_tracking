-- 0004: add an "Accommodation" category (hotels, Airbnb), placed right after Travel.
-- Safe to re-run.

-- Existing users: make room after Travel, then insert.
with need as (
  select distinct c.user_id
  from public.categories c
  where not exists (select 1 from public.categories a where a.user_id = c.user_id and a.name = 'Accommodation')
), travel as (
  select c.user_id, c.sort_order as t
  from public.categories c join need n on n.user_id = c.user_id
  where c.name = 'Travel'
), shifted as (
  update public.categories c set sort_order = c.sort_order + 1
  from travel t
  where c.user_id = t.user_id and c.sort_order > t.t
  returning c.user_id
)
insert into public.categories (user_id, name, sort_order)
select n.user_id, 'Accommodation', coalesce(t.t + 1, 100)
from need n left join travel t on t.user_id = n.user_id
on conflict (user_id, name) do nothing;

-- New users get it from the start.
create or replace function public.seed_categories(uid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.categories (user_id, name, sort_order)
  select uid, name, ord from unnest(array[
    'Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Subscription', 'Health',
    'House', 'Gifts', 'Travel', 'Accommodation', 'Clothes', 'Entertainment', 'Invest', 'Work', 'Other'
  ]) with ordinality as t(name, ord)
  on conflict (user_id, name) do nothing;
$$;
revoke all on function public.seed_categories(uuid) from public, anon, authenticated;
