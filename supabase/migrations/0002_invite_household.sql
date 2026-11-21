-- 0002: an invite can carry a household; the invitee joins it on first sign-in.
alter table public.allowed_emails
  add column if not exists household_id uuid references public.households(id) on delete set null;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  first_user boolean;
begin
  if not exists (select 1 from public.allowed_emails where email = lower(new.email)) then
    raise exception 'email not invited';
  end if;
  select not exists (select 1 from public.profiles) into first_user;
  insert into public.profiles (id, email, display_name, is_owner)
  values (new.id, lower(new.email), coalesce(new.raw_user_meta_data->>'full_name', new.email), first_user);
  perform public.seed_categories(new.id);
  insert into public.household_members (household_id, user_id)
  select a.household_id, new.id from public.allowed_emails a
   where a.email = lower(new.email) and a.household_id is not null
  on conflict do nothing;
  return new;
end;
$$;
revoke all on function public.handle_new_user() from public, anon, authenticated;
