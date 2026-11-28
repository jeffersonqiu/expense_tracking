-- 0010: "Gifts" becomes "Giving": allowance to parents/family, gifts and donations.
-- Existing gifts keep their category (renamed in place). Safe to re-run.
update public.categories c set name = 'Giving'
 where c.name = 'Gifts'
   and not exists (select 1 from public.categories g where g.user_id = c.user_id and g.name = 'Giving');

-- Keep what the app has learned pointing at the new name.
update public.knowledge_facts set category = 'Giving' where category = 'Gifts';
update public.knowledge_facts set statement = replace(statement, 'Gifts', 'Giving') where statement like '%Gifts%';
update public.decision_log set final_category = 'Giving' where final_category = 'Gifts';

create or replace function public.seed_categories(uid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.categories (user_id, name, sort_order)
  select uid, name, ord from unnest(array[
    'Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Subscription', 'Health',
    'House', 'Giving', 'Travel', 'Hotels', 'Clothes', 'Entertainment', 'Invest', 'Work', 'Other'
  ]) with ordinality as t(name, ord)
  on conflict (user_id, name) do nothing;
$$;
revoke all on function public.seed_categories(uuid) from public, anon, authenticated;
