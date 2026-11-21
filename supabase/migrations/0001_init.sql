-- 0001_init: core schema for the expense tracker.
-- Conventions: every user-owned row has user_id; money columns are currency-neutral.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- Access control: who may use the app
-- ---------------------------------------------------------------------------
create table public.allowed_emails (
  email text primary key check (email = lower(email)),
  invited_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  display_name text,
  base_currency char(3) not null default 'SGD',
  is_owner boolean not null default false,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Households: owner funds the household budget; members may pay first.
-- ---------------------------------------------------------------------------
create table public.households (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  currency char(3) not null default 'SGD',
  monthly_budget numeric(14,2) not null default 800 check (monthly_budget >= 0),
  created_at timestamptz not null default now()
);

create table public.household_members (
  household_id uuid not null references public.households(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  primary key (household_id, user_id)
);

-- ---------------------------------------------------------------------------
-- Categories
-- ---------------------------------------------------------------------------
create table public.categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  sort_order int not null default 100,
  unique (user_id, name)
);

-- ---------------------------------------------------------------------------
-- Ingestion
-- ---------------------------------------------------------------------------
create table public.ingest_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  label text not null default 'Apps Script',
  key_hash text not null unique,
  key_prefix text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);

create table public.script_heartbeats (
  user_id uuid primary key references auth.users(id) on delete cascade,
  last_seen_at timestamptz not null,
  scanned int not null default 0,
  sent int not null default 0,
  script_version text,
  last_error text
);

create table public.source_emails (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  gmail_message_id text not null,
  gmail_thread_id text,
  from_address text not null,
  subject text not null default '',
  received_at timestamptz not null,
  body_text text not null default '',
  gmail_labels text[] not null default '{}',
  status text not null check (status in ('transaction', 'ignored', 'rejected', 'needs_review', 'error')),
  parser text,
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, gmail_message_id)
);
create index source_emails_user_received on public.source_emails (user_id, received_at desc);

-- ---------------------------------------------------------------------------
-- Transactions
-- ---------------------------------------------------------------------------
create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  source_email_id uuid references public.source_emails(id) on delete set null,
  client_ref text not null,
  occurred_at timestamptz not null,
  amount numeric(14,2) not null check (amount >= 0),
  currency char(3) not null,
  fx_rate numeric(18,8),
  base_currency char(3) not null default 'SGD',
  base_amount numeric(14,2),
  kind text not null check (kind in ('spend', 'refund', 'investment', 'transfer', 'income')),
  merchant_raw text,
  merchant text,
  merchant_key text,
  counterparty_type text check (counterparty_type in ('business', 'individual', 'unknown')),
  payment_method text,
  source_role text not null default 'manual' check (source_role in ('receipt', 'rail', 'manual')),
  category_id uuid references public.categories(id) on delete set null,
  description text,
  status text not null default 'pending' check (status in ('pending', 'confirmed', 'rejected')),
  allocation text not null default 'personal' check (allocation in ('personal', 'work', 'shared', 'household')),
  claim_status text check (claim_status in ('to_claim', 'submitted', 'reimbursed')),
  household_id uuid references public.households(id) on delete set null,
  reimbursed_at timestamptz,
  duplicate_of uuid references public.transactions(id) on delete set null,
  confidence numeric(4,3),
  classifier text,
  needs_manual_amount boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  reviewed_at timestamptz,
  unique (user_id, client_ref),
  check (allocation <> 'work' or claim_status is not null),
  check (allocation <> 'household' or household_id is not null)
);
create index transactions_user_time on public.transactions (user_id, occurred_at desc);
create index transactions_user_status on public.transactions (user_id, status);
create index transactions_household on public.transactions (household_id, occurred_at desc) where household_id is not null;

create table public.shared_shares (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.transactions(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  person_name text not null,
  amount numeric(14,2) not null check (amount >= 0),
  settled_at timestamptz,
  created_at timestamptz not null default now()
);

create table public.merchant_rules (
  user_id uuid not null references auth.users(id) on delete cascade,
  merchant_key text not null,
  category_id uuid references public.categories(id) on delete set null,
  kind text check (kind in ('spend', 'refund', 'investment', 'transfer', 'income')),
  allocation text check (allocation in ('personal', 'work', 'shared', 'household')),
  auto_accept boolean not null default false,
  hits int not null default 0,
  updated_at timestamptz not null default now(),
  primary key (user_id, merchant_key)
);

-- ---------------------------------------------------------------------------
-- AI cost control + settings + FX
-- ---------------------------------------------------------------------------
create table public.ai_usage (
  id bigint generated always as identity primary key,
  user_id uuid references auth.users(id) on delete set null,
  model text not null,
  purpose text not null,
  input_tokens int not null default 0,
  output_tokens int not null default 0,
  cost_usd numeric(12,6) not null default 0,
  created_at timestamptz not null default now()
);
create index ai_usage_created on public.ai_usage (created_at);

create table public.app_settings (
  id boolean primary key default true check (id),
  ai_enabled boolean not null default true,
  ai_monthly_cap_usd numeric(10,2) not null default 1.00 check (ai_monthly_cap_usd >= 0),
  updated_at timestamptz not null default now()
);
insert into public.app_settings (id) values (true);

create table public.fx_rates (
  rate_date date not null,
  base char(3) not null,
  quote char(3) not null,
  rate numeric(18,8) not null,
  primary key (rate_date, base, quote)
);

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------
create or replace function public.is_household_member(hid uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.households h where h.id = hid and h.owner_id = auth.uid()
  ) or exists (
    select 1 from public.household_members m where m.household_id = hid and m.user_id = auth.uid()
  );
$$;

create or replace function public.is_owner()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select is_owner from public.profiles where id = auth.uid()), false);
$$;

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger transactions_touch before update on public.transactions
  for each row execute function public.touch_updated_at();

-- Default categories (PRD list + Bills/Groceries for Singapore usage)
create or replace function public.seed_categories(uid uuid)
returns void language sql security definer set search_path = public as $$
  insert into public.categories (user_id, name, sort_order)
  select uid, name, ord from unnest(array[
    'Food', 'Groceries', 'Transport', 'Shopping', 'Bills', 'Subscription', 'Health',
    'House', 'Gifts', 'Travel', 'Clothes', 'Entertainment', 'Invest', 'Work', 'Other'
  ]) with ordinality as t(name, ord)
  on conflict (user_id, name) do nothing;
$$;

-- New auth user: must be on the allow-list; first user becomes owner.
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
  return new;
end;
$$;
create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- Row-level security
-- ---------------------------------------------------------------------------
alter table public.allowed_emails enable row level security;
alter table public.profiles enable row level security;
alter table public.households enable row level security;
alter table public.household_members enable row level security;
alter table public.categories enable row level security;
alter table public.ingest_keys enable row level security;
alter table public.script_heartbeats enable row level security;
alter table public.source_emails enable row level security;
alter table public.transactions enable row level security;
alter table public.shared_shares enable row level security;
alter table public.merchant_rules enable row level security;
alter table public.ai_usage enable row level security;
alter table public.app_settings enable row level security;
alter table public.fx_rates enable row level security;

-- allow-list: owner manages, users can see their own entry
create policy allowed_emails_owner on public.allowed_emails for all to authenticated
  using (public.is_owner()) with check (public.is_owner());

-- profiles: read/update own; owner may read all (to see invitees)
create policy profiles_read on public.profiles for select to authenticated
  using (id = auth.uid() or public.is_owner());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- households
create policy households_read on public.households for select to authenticated
  using (public.is_household_member(id));
create policy households_owner_write on public.households for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());
create policy household_members_read on public.household_members for select to authenticated
  using (public.is_household_member(household_id));
create policy household_members_owner_write on public.household_members for all to authenticated
  using (exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid()))
  with check (exists (select 1 from public.households h where h.id = household_id and h.owner_id = auth.uid()));

-- simple own-row tables
create policy categories_own on public.categories for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy ingest_keys_own_read on public.ingest_keys for select to authenticated
  using (user_id = auth.uid());
create policy ingest_keys_own_revoke on public.ingest_keys for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy heartbeats_own on public.script_heartbeats for select to authenticated
  using (user_id = auth.uid());
create policy source_emails_own on public.source_emails for select to authenticated
  using (user_id = auth.uid());
create policy merchant_rules_own on public.merchant_rules for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy shared_shares_own on public.shared_shares for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- transactions: own rows; household members can read household rows
create policy transactions_read on public.transactions for select to authenticated
  using (user_id = auth.uid() or (household_id is not null and public.is_household_member(household_id)));
create policy transactions_insert on public.transactions for insert to authenticated
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
create policy transactions_update on public.transactions for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid() and (household_id is null or public.is_household_member(household_id)));
create policy transactions_delete on public.transactions for delete to authenticated
  using (user_id = auth.uid());

-- AI usage & settings: owner reads; settings updated by owner
create policy ai_usage_owner on public.ai_usage for select to authenticated
  using (public.is_owner() or user_id = auth.uid());
create policy app_settings_read on public.app_settings for select to authenticated using (true);
create policy app_settings_owner on public.app_settings for update to authenticated
  using (public.is_owner()) with check (public.is_owner());
create policy fx_rates_read on public.fx_rates for select to authenticated using (true);

-- Reimbursing a spouse's household spend is done by the household owner via a
-- checked function (the row belongs to the spouse, so plain RLS forbids it).
create or replace function public.mark_household_reimbursed(tx_ids uuid[], reimbursed boolean)
returns int language plpgsql security definer set search_path = public as $$
declare
  n int;
begin
  update public.transactions t
     set reimbursed_at = case when reimbursed then now() else null end
   where t.id = any(tx_ids)
     and t.allocation = 'household'
     and exists (select 1 from public.households h where h.id = t.household_id and h.owner_id = auth.uid());
  get diagnostics n = row_count;
  return n;
end;
$$;
revoke all on function public.mark_household_reimbursed(uuid[], boolean) from public;
grant execute on function public.mark_household_reimbursed(uuid[], boolean) to authenticated;

-- Internal helpers must not be callable directly by clients.
revoke all on function public.seed_categories(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user() from public, anon, authenticated;
