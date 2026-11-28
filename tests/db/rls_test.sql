\set ON_ERROR_STOP on
-- Setup as superuser
insert into public.allowed_emails(email) values ('owner@example.com');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000a', 'owner@example.com');
insert into public.households(id, name, owner_id) values ('10000000-0000-0000-0000-000000000001', 'Home', '00000000-0000-0000-0000-00000000000a');
-- Invite carrying the household: wife joins it automatically on first sign-in
insert into public.allowed_emails(email, household_id) values ('wife@example.com', '10000000-0000-0000-0000-000000000001');
insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000b', 'wife@example.com');
select count(*) = 1 as ok from public.household_members where user_id = '00000000-0000-0000-0000-00000000000b' \gset
\if :ok \else \echo 'FAIL invitee not added to household' \q \endif
do $$ begin
  insert into auth.users(id, email) values ('00000000-0000-0000-0000-00000000000c', 'stranger@example.com');
  raise exception 'uninvited user was allowed';
exception when others then
  if sqlerrm not like '%not invited%' then raise; end if;
end $$;

select is_owner from public.profiles where email = 'owner@example.com' \gset
\if :is_owner
\else
  \echo 'FAIL first user should be owner' \q
\endif
select count(*) = 16 as ok from public.categories where user_id = '00000000-0000-0000-0000-00000000000a' \gset
\if :ok \else \echo 'FAIL categories not seeded' \q \endif


-- Wife's household spend, owner's personal spend
insert into public.transactions(id, user_id, client_ref, occurred_at, amount, currency, kind, allocation, household_id) values
  ('20000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000b', 'w1', now(), 50, 'SGD', 'spend', 'household', '10000000-0000-0000-0000-000000000001'),
  ('20000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'o1', now(), 20, 'SGD', 'spend', 'personal', null),
  ('20000000-0000-0000-0000-000000000003', '00000000-0000-0000-0000-00000000000b', 'w2', now(), 9, 'SGD', 'spend', 'personal', null);

insert into public.knowledge_facts(user_id, subject_type, subject, statement) values
  ('00000000-0000-0000-0000-00000000000a', 'merchant', 'joyful cck', 'Owner fact');
insert into public.decision_log(user_id, decision, merchant) values ('00000000-0000-0000-0000-00000000000a', 'accept', 'x');

insert into public.trips(id, user_id, name, start_date) values ('30000000-0000-0000-0000-000000000001', '00000000-0000-0000-0000-00000000000a', 'Bangkok', '2026-10-20');

-- As wife
set role authenticated;
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000b', false);
select count(*) as n from public.transactions \gset
\if :{?n} \endif
select (:n = 2) as ok \gset
\if :ok \else \echo 'FAIL wife should see her 2 rows only, saw' :n \q \endif
select count(*) = 0 as ok from public.transactions where id = '20000000-0000-0000-0000-000000000002' \gset
\if :ok \else \echo 'FAIL wife sees owner personal row' \q \endif
select public.mark_household_reimbursed(array['20000000-0000-0000-0000-000000000001']::uuid[], true) = 0 as ok \gset
\if :ok \else \echo 'FAIL wife could mark reimbursed' \q \endif
select (select count(*) from public.knowledge_facts) + (select count(*) from public.decision_log) + (select count(*) from public.trips) = 0 as ok \gset
\if :ok \else \echo 'FAIL wife sees owner knowledge, decisions or trips' \q \endif
do $$ begin
  update public.transactions set trip_id = '30000000-0000-0000-0000-000000000001', trip_bucket = 'daily' where id = '20000000-0000-0000-0000-000000000003';
  raise exception 'tagged own spend with someone else''s trip';
exception when raise_exception then
  if sqlerrm not like '%another user%' then raise; end if;
end $$;
do $$ begin
  insert into public.knowledge_facts(user_id, subject_type, subject, statement) values ('00000000-0000-0000-0000-00000000000b', 'merchant', 'x', 'self-written');
  raise exception 'users can write facts directly';
exception when insufficient_privilege then null;
end $$;
update public.app_settings set ai_monthly_cap_usd = 100;
select ai_monthly_cap_usd = 2.00 as ok from public.app_settings \gset
\if :ok \else \echo 'FAIL non-owner changed settings' \q \endif
do $$ begin
  perform public.seed_categories('00000000-0000-0000-0000-00000000000a');
  raise exception 'seed_categories callable';
exception when insufficient_privilege then null;
end $$;

-- Wife can start a project in her household; existing household spend became 'allowance'
insert into public.household_projects(household_id, name, budget) values ('10000000-0000-0000-0000-000000000001', 'Renovation', 15000);
select count(*) = 1 as ok from public.household_projects \gset
\if :ok \else \echo 'FAIL member cannot create project' \q \endif

-- As owner
select set_config('request.jwt.claim.sub', '00000000-0000-0000-0000-00000000000a', false);
select count(*) = 1 as ok from public.household_projects \gset
\if :ok \else \echo 'FAIL owner cannot see project' \q \endif
do $$ begin
  update public.transactions set household_pot = 'bills' where id = '20000000-0000-0000-0000-000000000002';
  raise exception 'pot allowed on a personal spend';
exception when check_violation then null;
end $$;
select count(*) = 2 as ok from public.transactions \gset
\if :ok \else \echo 'FAIL owner should see own + household row' \q \endif
select count(*) = 0 as ok from public.transactions where id = '20000000-0000-0000-0000-000000000003' \gset
\if :ok \else \echo 'FAIL owner sees wife personal row' \q \endif
select public.mark_household_reimbursed(array['20000000-0000-0000-0000-000000000001']::uuid[], true) = 1 as ok \gset
\if :ok \else \echo 'FAIL owner could not mark reimbursed' \q \endif
update public.transactions set amount = 1 where id = '20000000-0000-0000-0000-000000000001';
reset role;
select amount = 50 as ok from public.transactions where id = '20000000-0000-0000-0000-000000000001' \gset
\if :ok \else \echo 'FAIL owner edited wife row amount' \q \endif
-- A work spend on a trip makes it a business trip; it can't go back to personal while it has work spends.
insert into public.trips(id, user_id, name, start_date) values ('30000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-00000000000a', 'Jakarta', '2026-11-26');
update public.transactions set allocation = 'work', claim_status = 'to_claim', trip_id = '30000000-0000-0000-0000-000000000002', trip_bucket = 'daily', status = 'pending'
 where id = '20000000-0000-0000-0000-000000000002';
select kind = 'personal' as ok from public.trips where id = '30000000-0000-0000-0000-000000000002' \gset
\if :ok \else \echo 'FAIL a pending work suggestion changed the trip type' \q \endif
update public.transactions set status = 'confirmed' where id = '20000000-0000-0000-0000-000000000002';
select kind = 'business' as ok from public.trips where id = '30000000-0000-0000-0000-000000000002' \gset
\if :ok \else \echo 'FAIL work spend did not make the trip business' \q \endif
do $$ begin
  update public.trips set kind = 'personal' where id = '30000000-0000-0000-0000-000000000002';
  raise exception 'downgraded a trip with work spends';
exception when raise_exception then
  if sqlerrm not like '%work spends%' then raise; end if;
end $$;
update public.transactions set allocation = 'personal', claim_status = null, trip_id = null, trip_bucket = null
 where id = '20000000-0000-0000-0000-000000000002';

-- Trip allocation needs a trip; deleting a trip keeps its spends as personal.
do $$ begin
  update public.transactions set allocation = 'trip' where id = '20000000-0000-0000-0000-000000000002';
  raise exception 'trip allocation without a trip';
exception when check_violation then null;
end $$;
update public.transactions set allocation = 'trip', trip_id = '30000000-0000-0000-0000-000000000001', trip_bucket = 'hotels'
 where id = '20000000-0000-0000-0000-000000000002';
delete from public.trips where id = '30000000-0000-0000-0000-000000000001';
select allocation = 'personal' and trip_id is null and trip_bucket is null as ok from public.transactions where id = '20000000-0000-0000-0000-000000000002' \gset
\if :ok \else \echo 'FAIL deleting a trip did not untag its spends' \q \endif
\echo 'DB TESTS PASSED'
