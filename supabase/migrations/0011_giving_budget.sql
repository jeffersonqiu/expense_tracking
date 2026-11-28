-- 0011: a monthly Giving budget per user, and tighter profile edits. Safe to re-run.

alter table public.profiles add column if not exists giving_monthly_budget numeric(14,2);
alter table public.profiles drop constraint if exists profiles_giving_budget_check;
alter table public.profiles add constraint profiles_giving_budget_check
  check (giving_monthly_budget is null or giving_monthly_budget >= 0);

-- Users may edit only these profile fields themselves (never is_owner or email).
revoke update on public.profiles from anon, authenticated;
grant update (display_name, base_currency, giving_monthly_budget) on public.profiles to authenticated;
