-- 0008: "Trip" becomes an allocation (replacing "Shared" for new spends).
-- Old shared spends stay valid so history is kept. Safe to re-run.

update public.transactions set allocation = 'trip'
 where trip_id is not null and allocation in ('personal', 'shared');

alter table public.transactions drop constraint if exists transactions_allocation_check;
alter table public.transactions add constraint transactions_allocation_check
  check (allocation in ('personal', 'work', 'shared', 'household', 'trip'));
alter table public.transactions drop constraint if exists transactions_trip_allocation_check;
alter table public.transactions add constraint transactions_trip_allocation_check
  check (allocation <> 'trip' or trip_id is not null);

alter table public.knowledge_facts drop constraint if exists knowledge_facts_allocation_check;
alter table public.knowledge_facts add constraint knowledge_facts_allocation_check
  check (allocation in ('personal', 'work', 'shared', 'household', 'trip'));

-- Deleting a trip keeps its spends: they become personal (work stays work) with no trip.
create or replace function public.untag_trip_spends()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.transactions
     set trip_id = null, trip_bucket = null,
         allocation = case when allocation = 'trip' then 'personal' else allocation end
   where trip_id = old.id;
  return old;
end;
$$;
drop trigger if exists trips_untag_spends on public.trips;
create trigger trips_untag_spends before delete on public.trips
  for each row execute function public.untag_trip_spends();
