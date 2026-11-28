-- Supabase grants these by default (as default privileges), so a migration's own
-- REVOKE sticks. Mirror that for local tests: run this BEFORE the migrations.
grant usage on schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to authenticated, service_role;
alter default privileges in schema public grant all on sequences to authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
