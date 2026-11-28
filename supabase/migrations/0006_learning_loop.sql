-- 0006: AI learning loop. Every review decision is logged; a weekly job distils
-- the log into user-specific knowledge facts that the AI reads when deciding.
-- Safe to re-run.

-- What the AI suggested at ingest time (compared with the final decision later).
alter table public.transactions add column if not exists suggestion jsonb;

-- One row per review decision (accept / reject / edit).
create table if not exists public.decision_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  transaction_id uuid references public.transactions(id) on delete set null,
  decided_at timestamptz not null default now(),
  decision text not null check (decision in ('accept', 'reject', 'save')),
  -- context the model saw / can learn from
  merchant text,
  merchant_key text,
  amount numeric(14,2),
  currency char(3),
  occurred_at timestamptz,
  local_time text,                -- e.g. "Sat 12:29" (Singapore)
  counterparty_type text,
  payment_method text,
  snippet text,                   -- short email excerpt
  -- suggestion vs final
  suggested jsonb,                -- {category, allocation, pot, project, confidence:{...}, source}
  final_category text,
  final_kind text,
  final_allocation text,
  final_pot text,
  final_project text,
  corrected_category boolean not null default false,
  corrected_allocation boolean not null default false,
  corrected_pot boolean not null default false
);
create index if not exists decision_log_user_time on public.decision_log (user_id, decided_at desc);

-- Knowledge base: facts with conditions, evidence and recency (a light knowledge graph).
create table if not exists public.knowledge_facts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  subject_type text not null check (subject_type in ('merchant', 'brand', 'person', 'place', 'trip', 'pattern', 'lesson')),
  subject text not null,          -- e.g. "joyful cck", "ritz carlton", "Jakarta trip Nov 2026"
  statement text not null,        -- plain-language fact the AI reads
  conditions text,                -- e.g. "weekday lunch, amount > S$60"
  category text,
  allocation text check (allocation in ('personal', 'work', 'shared', 'household')),
  pot text check (pot in ('allowance', 'bills', 'project')),
  support int not null default 1 check (support >= 0),
  contradictions int not null default 0 check (contradictions >= 0),
  source text not null default 'learned' check (source in ('learned', 'imported')),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists knowledge_facts_user on public.knowledge_facts (user_id, active);

-- History of learning runs.
create table if not exists public.learn_runs (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  started_at timestamptz not null default now(),
  decisions_seen int not null default 0,
  corrections_seen int not null default 0,
  facts_added int not null default 0,
  facts_updated int not null default 0,
  facts_retired int not null default 0,
  model text,
  cost_usd numeric(12,6) not null default 0,
  summary text,
  error text
);
create index if not exists learn_runs_user on public.learn_runs (user_id, started_at desc);

alter table public.decision_log enable row level security;
alter table public.knowledge_facts enable row level security;
alter table public.learn_runs enable row level security;

drop policy if exists decision_log_own on public.decision_log;
create policy decision_log_own on public.decision_log for select to authenticated using (user_id = auth.uid());
drop policy if exists decision_log_insert on public.decision_log;
create policy decision_log_insert on public.decision_log for insert to authenticated with check (user_id = auth.uid());
drop policy if exists knowledge_facts_own on public.knowledge_facts;
create policy knowledge_facts_own on public.knowledge_facts for select to authenticated using (user_id = auth.uid());
-- Users may switch a fact off ("this is wrong"); facts are written by the learning job.
drop policy if exists knowledge_facts_toggle on public.knowledge_facts;
create policy knowledge_facts_toggle on public.knowledge_facts for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());
drop policy if exists learn_runs_own on public.learn_runs;
create policy learn_runs_own on public.learn_runs for select to authenticated using (user_id = auth.uid());

-- Keep what "Remember for this merchant" taught so far, as modest starting facts.
insert into public.knowledge_facts (user_id, subject_type, subject, statement, category, allocation, pot, support, source)
select r.user_id, 'merchant', r.merchant_key,
       'Previously remembered choice for ' || r.merchant_key
         || coalesce(': category ' || c.name, '')
         || coalesce(', allocation ' || r.allocation, '')
         || coalesce(', household pot ' || r.household_pot, ''),
       c.name, r.allocation, r.household_pot, 2, 'imported'
from public.merchant_rules r
left join public.categories c on c.id = r.category_id
where not exists (
  select 1 from public.knowledge_facts f
  where f.user_id = r.user_id and f.subject = r.merchant_key and f.source = 'imported'
);

-- Learning plus everyday suggestions: raise the default monthly AI cap to US$2.
update public.app_settings set ai_monthly_cap_usd = 2.00 where ai_monthly_cap_usd < 2.00;
