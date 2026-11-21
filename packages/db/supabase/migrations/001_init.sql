-- ============================================================================
-- tae-saas 초기 스키마
--   users / api_keys / usage_credits / credit_transactions / orders
--   conversion_jobs / webhook_events
--
-- 적용:
--   supabase link --project-ref <ref>
--   supabase db push            (또는 SQL Editor에 그대로 붙여넣기)
-- ============================================================================

create extension if not exists pgcrypto;

-- ── 공통: updated_at 트리거 ────────────────────────────────────────────────
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ── 사용자 ────────────────────────────────────────────────────────────────
create table if not exists public.users (
  id uuid primary key default gen_random_uuid(),
  email text unique,
  display_name text,
  marketing_opt_in boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.users is '앱 사용자. 웹(익명 세션)과 API 키 발급 대상이 같은 테이블을 씁니다.';

drop trigger if exists users_set_updated_at on public.users;
create trigger users_set_updated_at
before update on public.users
for each row execute function public.set_updated_at();

-- ── API 키 ────────────────────────────────────────────────────────────────
create table if not exists public.api_keys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  name text not null default 'default',
  key_prefix text not null,
  key_hash text not null unique,
  scopes text[] not null default array['convert']::text[],
  last_used_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

comment on column public.api_keys.key_hash is 'SHA-256(hex). 평문 키는 발급 시 한 번만 노출합니다.';

create index if not exists api_keys_user_idx on public.api_keys (user_id, created_at desc);

-- ── 크레딧 잔액 ───────────────────────────────────────────────────────────
create table if not exists public.usage_credits (
  user_id uuid primary key references public.users (id) on delete cascade,
  balance integer not null default 0 check (balance >= 0),
  lifetime_granted integer not null default 0,
  lifetime_used integer not null default 0,
  updated_at timestamptz not null default now()
);

-- ── 크레딧 원장 ───────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'credit_transaction_kind') then
    create type public.credit_transaction_kind as enum
      ('signup_bonus', 'purchase', 'consume', 'refund', 'adjustment');
  end if;
end;
$$;

create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  kind public.credit_transaction_kind not null,
  amount integer not null,
  balance_after integer not null,
  job_id uuid,
  order_id uuid,
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

comment on column public.credit_transactions.amount is '양수 = 지급, 음수 = 차감';

create index if not exists credit_transactions_user_idx
  on public.credit_transactions (user_id, created_at desc);

-- 신규 가입 보너스는 사용자당 1회만
create unique index if not exists credit_transactions_signup_once
  on public.credit_transactions (user_id)
  where kind = 'signup_bonus';

-- ── 주문(LemonSqueezy) ────────────────────────────────────────────────────
create table if not exists public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.users (id) on delete set null,
  provider text not null default 'lemonsqueezy',
  provider_order_id text not null unique,
  variant_id text,
  pack_id text,
  status text not null,
  total_cents integer,
  currency text,
  buyer_email text,
  raw jsonb not null default '{}'::jsonb,
  credits_granted integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists orders_user_idx on public.orders (user_id, created_at desc);

-- ── 변환 작업 로그 ────────────────────────────────────────────────────────
do $$
begin
  if not exists (select 1 from pg_type where typname = 'job_app') then
    create type public.job_app as enum ('youtube_blog', 'pdf_api');
  end if;
  if not exists (select 1 from pg_type where typname = 'job_status') then
    create type public.job_status as enum ('queued', 'running', 'succeeded', 'failed');
  end if;
end;
$$;

create table if not exists public.conversion_jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  app public.job_app not null,
  status public.job_status not null default 'queued',
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  error_code text,
  error_message text,
  provider text,
  model text,
  credits_charged integer not null default 0,
  input_tokens integer,
  output_tokens integer,
  cost_usd numeric(10, 6),
  duration_ms integer,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists conversion_jobs_user_idx
  on public.conversion_jobs (user_id, created_at desc);

-- ── 웹훅 이벤트(멱등 처리) ────────────────────────────────────────────────
create table if not exists public.webhook_events (
  id text primary key,
  provider text not null,
  event_name text not null,
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'received',
  error text,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);

-- ============================================================================
-- 크레딧 함수 (원자 처리)
--   모든 앱은 service role로만 호출합니다. RLS를 우회하는 대신
--   함수는 security definer + search_path 고정으로 안전하게 작성합니다.
-- ============================================================================

create or replace function public.grant_credits(
  p_user_id uuid,
  p_amount integer,
  p_kind public.credit_transaction_kind,
  p_description text default null,
  p_order_id uuid default null,
  p_metadata jsonb default '{}'::jsonb
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount = 0 then
    select balance into v_balance from public.usage_credits where user_id = p_user_id;
    return coalesce(v_balance, 0);
  end if;

  insert into public.usage_credits (user_id, balance, lifetime_granted, lifetime_used)
  values (p_user_id, greatest(p_amount, 0), greatest(p_amount, 0), greatest(-p_amount, 0))
  on conflict (user_id) do update
    set balance = public.usage_credits.balance + p_amount,
        lifetime_granted = public.usage_credits.lifetime_granted + greatest(p_amount, 0),
        lifetime_used = public.usage_credits.lifetime_used + greatest(-p_amount, 0),
        updated_at = now()
    where public.usage_credits.balance + p_amount >= 0
  returning balance into v_balance;

  if v_balance is null then
    raise exception 'insufficient_credits' using errcode = 'P0001';
  end if;

  insert into public.credit_transactions (user_id, kind, amount, balance_after, order_id, description, metadata)
  values (p_user_id, p_kind, p_amount, v_balance, p_order_id, p_description, coalesce(p_metadata, '{}'::jsonb));

  return v_balance;
end;
$$;

create or replace function public.grant_signup_bonus(p_user_id uuid, p_amount integer)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  begin
    return public.grant_credits(p_user_id, p_amount, 'signup_bonus', '신규 가입 체험 크레딧');
  exception
    when unique_violation then
      select balance into v_balance from public.usage_credits where user_id = p_user_id;
      return coalesce(v_balance, 0);
  end;
end;
$$;

create or replace function public.consume_credits(
  p_user_id uuid,
  p_amount integer,
  p_job_id uuid default null,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  update public.usage_credits
     set balance = balance - p_amount,
         lifetime_used = lifetime_used + p_amount,
         updated_at = now()
   where user_id = p_user_id
     and balance >= p_amount
  returning balance into v_balance;

  if v_balance is null then
    return -1; -- 잔액 부족
  end if;

  insert into public.credit_transactions (user_id, kind, amount, balance_after, job_id, description)
  values (p_user_id, 'consume', -p_amount, v_balance, p_job_id, p_description);

  return v_balance;
end;
$$;

create or replace function public.refund_credits(
  p_user_id uuid,
  p_amount integer,
  p_job_id uuid default null,
  p_description text default null
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_balance integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount' using errcode = '22023';
  end if;

  insert into public.usage_credits (user_id, balance, lifetime_granted, lifetime_used)
  values (p_user_id, p_amount, 0, 0)
  on conflict (user_id) do update
    set balance = public.usage_credits.balance + p_amount,
        lifetime_used = greatest(public.usage_credits.lifetime_used - p_amount, 0),
        updated_at = now()
  returning balance into v_balance;

  insert into public.credit_transactions (user_id, kind, amount, balance_after, job_id, description)
  values (p_user_id, 'refund', p_amount, v_balance, p_job_id, p_description);

  return v_balance;
end;
$$;

revoke all on function public.grant_credits(uuid, integer, public.credit_transaction_kind, text, uuid, jsonb) from public;
revoke all on function public.grant_signup_bonus(uuid, integer) from public;
revoke all on function public.consume_credits(uuid, integer, uuid, text) from public;
revoke all on function public.refund_credits(uuid, integer, uuid, text) from public;

grant execute on function public.grant_credits(uuid, integer, public.credit_transaction_kind, text, uuid, jsonb) to service_role;
grant execute on function public.grant_signup_bonus(uuid, integer) to service_role;
grant execute on function public.consume_credits(uuid, integer, uuid, text) to service_role;
grant execute on function public.refund_credits(uuid, integer, uuid, text) to service_role;

-- ============================================================================
-- RLS: 앱은 service role로 접근하지만, 나중에 Supabase Auth로
-- 브라우저에서 직접 읽을 때를 위해 본인 행만 조회 가능하도록 둡니다.
-- ============================================================================
alter table public.users enable row level security;
alter table public.api_keys enable row level security;
alter table public.usage_credits enable row level security;
alter table public.credit_transactions enable row level security;
alter table public.orders enable row level security;
alter table public.conversion_jobs enable row level security;
alter table public.webhook_events enable row level security;

drop policy if exists users_select_self on public.users;
create policy users_select_self on public.users
  for select using (auth.uid() = id);

drop policy if exists api_keys_select_self on public.api_keys;
create policy api_keys_select_self on public.api_keys
  for select using (auth.uid() = user_id);

drop policy if exists usage_credits_select_self on public.usage_credits;
create policy usage_credits_select_self on public.usage_credits
  for select using (auth.uid() = user_id);

drop policy if exists credit_transactions_select_self on public.credit_transactions;
create policy credit_transactions_select_self on public.credit_transactions
  for select using (auth.uid() = user_id);

drop policy if exists orders_select_self on public.orders;
create policy orders_select_self on public.orders
  for select using (auth.uid() = user_id);

drop policy if exists conversion_jobs_select_self on public.conversion_jobs;
create policy conversion_jobs_select_self on public.conversion_jobs
  for select using (auth.uid() = user_id);

-- webhook_events는 서버 전용입니다(정책 없음 = 클라이언트 접근 차단).
