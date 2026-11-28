-- 0003: split Household spending into pots (allowance / bills / project).
-- Safe to re-run.

create table if not exists public.household_projects (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  budget numeric(14,2) check (budget is null or budget >= 0),
  status text not null default 'open' check (status in ('open', 'closed')),
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists household_projects_household on public.household_projects (household_id, status);

alter table public.transactions
  add column if not exists household_pot text check (household_pot in ('allowance', 'bills', 'project')),
  add column if not exists project_id uuid references public.household_projects(id) on delete set null;

alter table public.merchant_rules
  add column if not exists household_pot text check (household_pot in ('allowance', 'bills', 'project')),
  add column if not exists project_id uuid references public.household_projects(id) on delete set null;

-- Existing household spends were all against the allowance.
update public.transactions set household_pot = 'allowance'
 where allocation = 'household' and household_pot is null;

alter table public.transactions drop constraint if exists transactions_pot_check;
alter table public.transactions add constraint transactions_pot_check check (
  (allocation = 'household' or household_pot is null)
  and (household_pot = 'project' or project_id is null)
);

alter table public.household_projects enable row level security;
-- Everyone in the household can see and start projects (either partner may pay a contractor).
drop policy if exists household_projects_member on public.household_projects;
create policy household_projects_member on public.household_projects for all to authenticated
  using (public.is_household_member(household_id))
  with check (public.is_household_member(household_id));
