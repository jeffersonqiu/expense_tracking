-- 0007: trips. A spend can be tagged with a trip and a bucket (daily / transport /
-- hotels) independently of its allocation. Trip spending is tracked on its own
-- budget, separate from everyday personal spending. Safe to re-run.

create table if not exists public.trips (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null check (length(name) between 1 and 80),
  start_date date not null,
  end_date date,
  budget numeric(14,2) check (budget is null or budget >= 0),
  links text,
  things_to_bring text,
  remarks text,
  -- Totals carried over from before the app (e.g. imported from a spreadsheet), in base currency
  baseline_daily numeric(14,2) not null default 0,
  baseline_transport numeric(14,2) not null default 0,
  baseline_hotels numeric(14,2) not null default 0,
  baseline_unsplit numeric(14,2) not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, name, start_date),
  check (end_date is null or end_date >= start_date)
);
create index if not exists trips_user_start on public.trips (user_id, start_date desc);

alter table public.transactions
  add column if not exists trip_id uuid references public.trips(id) on delete set null,
  add column if not exists trip_bucket text check (trip_bucket in ('daily', 'transport', 'hotels'));
alter table public.transactions drop constraint if exists transactions_trip_bucket_check2;
alter table public.transactions add constraint transactions_trip_bucket_check2
  check ((trip_id is null) = (trip_bucket is null));
create index if not exists transactions_trip on public.transactions (trip_id) where trip_id is not null;

alter table public.decision_log
  add column if not exists final_trip text,
  add column if not exists final_trip_bucket text,
  add column if not exists corrected_trip boolean not null default false;

alter table public.trips enable row level security;
drop policy if exists trips_own on public.trips;
create policy trips_own on public.trips for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- A spend can only be tagged with the owner's own trip.
create or replace function public.check_trip_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.trip_id is not null and not exists (select 1 from public.trips t where t.id = new.trip_id and t.user_id = new.user_id) then
    raise exception 'trip belongs to another user';
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_trip_owner on public.transactions;
create trigger transactions_trip_owner before insert or update of trip_id on public.transactions
  for each row execute function public.check_trip_owner();
