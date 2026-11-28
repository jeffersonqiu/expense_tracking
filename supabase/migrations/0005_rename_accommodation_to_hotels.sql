-- 0005: shorter label so the chip fits on phones: Accommodation -> Hotels. Safe to re-run.
update public.categories c set name = 'Hotels'
 where c.name = 'Accommodation'
   and not exists (select 1 from public.categories h where h.user_id = c.user_id and h.name = 'Hotels');

create or replace function public.seed_categories(uid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.categories (user_id, name, sort_order)
  select uid, name, ord from unnest(array[
    'Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Subscription', 'Health',
    'House', 'Gifts', 'Travel', 'Hotels', 'Clothes', 'Entertainment', 'Invest', 'Work', 'Other'
  ]) with ordinality as t(name, ord)
  on conflict (user_id, name) do nothing;
$$;
revoke all on function public.seed_categories(uuid) from public, anon, authenticated;
