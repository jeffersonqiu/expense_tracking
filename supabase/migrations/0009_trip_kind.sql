-- 0009: trips are Personal or Business. A business trip can hold personal spends;
-- a personal trip never holds work spends. Tagging a work spend to a trip makes it
-- a business trip once accepted, and a trip can't go back to personal while it has work spends.
-- Safe to re-run.

alter table public.trips add column if not exists kind text not null default 'personal';
alter table public.trips drop constraint if exists trips_kind_check;
alter table public.trips add constraint trips_kind_check check (kind in ('personal', 'business'));

update public.trips t set kind = 'business'
 where kind <> 'business'
   and exists (select 1 from public.transactions x where x.trip_id = t.id and x.allocation = 'work' and x.status = 'confirmed');

-- Own trip only; a work spend upgrades its trip to business.
create or replace function public.check_trip_owner()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.trip_id is not null then
    if not exists (select 1 from public.trips t where t.id = new.trip_id and t.user_id = new.user_id) then
      raise exception 'trip belongs to another user';
    end if;
    if new.allocation = 'work' and new.status = 'confirmed' then
      update public.trips set kind = 'business' where id = new.trip_id and kind <> 'business';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists transactions_trip_owner on public.transactions;
create trigger transactions_trip_owner before insert or update of trip_id, allocation, status on public.transactions
  for each row execute function public.check_trip_owner();

create or replace function public.trips_kind_guard()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.kind = 'personal' and old.kind = 'business'
     and exists (select 1 from public.transactions x where x.trip_id = new.id and x.allocation = 'work' and x.status = 'confirmed') then
    raise exception 'trip has work spends';
  end if;
  return new;
end;
$$;
drop trigger if exists trips_kind_guard on public.trips;
create trigger trips_kind_guard before update of kind on public.trips
  for each row execute function public.trips_kind_guard();
