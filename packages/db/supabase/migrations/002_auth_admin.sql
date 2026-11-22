-- ============================================================================
-- tae-saas 002 — 회원 인증(이메일·네이버·카카오) + 관리자
--   users: password_hash / role / signup_provider / email_verified_at / last_login_at
--   oauth_accounts / admin_audit_logs
--
-- 적용:
--   Supabase SQL Editor에 그대로 붙여넣거나
--   psql "$DATABASE_URL" -f packages/db/supabase/migrations/002_auth_admin.sql
-- ============================================================================

begin;

create extension if not exists pgcrypto;

-- ── users: 인증·권한 컬럼 ─────────────────────────────────────────────────
alter table public.users add column if not exists password_hash text;
alter table public.users add column if not exists role text not null default 'user';
alter table public.users add column if not exists signup_provider text;
alter table public.users add column if not exists email_verified_at timestamptz;
alter table public.users add column if not exists last_login_at timestamptz;

-- 기존 행(익명 체험 세션 / 이메일 사용자)에 가입 경로를 채웁니다.
update public.users
   set signup_provider = case when email is null then 'guest' else 'email' end
 where signup_provider is null;

alter table public.users alter column signup_provider set default 'guest';
alter table public.users alter column signup_provider set not null;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'users_role_check') then
    alter table public.users
      add constraint users_role_check check (role in ('user', 'admin'));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'users_signup_provider_check') then
    alter table public.users
      add constraint users_signup_provider_check
      check (signup_provider in ('email', 'naver', 'kakao', 'guest'));
  end if;
end;
$$;

comment on column public.users.password_hash is
  'scrypt 해시. 형식: scrypt$N$r$p$salt_base64$hash_base64 (소셜 전용 계정은 NULL)';
comment on column public.users.role is 'user | admin — /admin 접근 권한';
comment on column public.users.signup_provider is 'email | naver | kakao | guest(체험 세션)';

create index if not exists users_role_idx on public.users (role);
create index if not exists users_created_idx on public.users (created_at desc);

-- ── 소셜 계정 연결 ────────────────────────────────────────────────────────
create table if not exists public.oauth_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  provider text not null check (provider in ('naver', 'kakao')),
  provider_user_id text not null,
  email text,
  nickname text,
  raw jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  last_login_at timestamptz,
  unique (provider, provider_user_id)
);

comment on table public.oauth_accounts is
  '네이버·카카오 계정 연결. provider + provider_user_id 가 사용자의 신원 키입니다.';

create index if not exists oauth_accounts_user_idx on public.oauth_accounts (user_id);
create index if not exists oauth_accounts_email_idx on public.oauth_accounts (lower(email));

-- ── 관리자 조작 감사 로그 ─────────────────────────────────────────────────
create table if not exists public.admin_audit_logs (
  id uuid primary key default gen_random_uuid(),
  admin_user_id uuid references public.users (id) on delete set null,
  action text not null,
  target_user_id uuid references public.users (id) on delete set null,
  amount integer,
  reason text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists admin_audit_logs_created_idx
  on public.admin_audit_logs (created_at desc);
create index if not exists admin_audit_logs_target_idx
  on public.admin_audit_logs (target_user_id, created_at desc);

-- ── 관리자 대시보드 요약 ──────────────────────────────────────────────────
create or replace function public.admin_overview()
returns jsonb
language sql
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'totalUsers', (select count(*) from public.users),
    'todayUsers', (
      select count(*) from public.users
       where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    ),
    'weekUsers', (select count(*) from public.users where created_at >= now() - interval '7 days'),
    'adminUsers', (select count(*) from public.users where role = 'admin'),
    'members', (select count(*) from public.users where signup_provider <> 'guest'),
    'guests', (select count(*) from public.users where signup_provider = 'guest'),
    'totalJobs', (select count(*) from public.conversion_jobs),
    'todayJobs', (
      select count(*) from public.conversion_jobs
       where created_at >= date_trunc('day', now() at time zone 'Asia/Seoul') at time zone 'Asia/Seoul'
    ),
    'textJobs', (
      select count(*) from public.conversion_jobs
       where coalesce(output->>'format', input->>'format', '') not in ('youtube_video')
    ),
    'videoJobs', (
      select count(*) from public.conversion_jobs
       where coalesce(output->>'format', input->>'format', '') = 'youtube_video'
    ),
    'succeededJobs', (select count(*) from public.conversion_jobs where status = 'succeeded'),
    'failedJobs', (select count(*) from public.conversion_jobs where status = 'failed'),
    'creditBalance', (select coalesce(sum(balance), 0) from public.usage_credits),
    'creditGranted', (select coalesce(sum(lifetime_granted), 0) from public.usage_credits),
    'creditUsed', (select coalesce(sum(lifetime_used), 0) from public.usage_credits)
  );
$$;

revoke all on function public.admin_overview() from public;
grant execute on function public.admin_overview() to service_role;

-- ── RLS: 새 테이블은 서버(service role) 전용 ──────────────────────────────
alter table public.oauth_accounts enable row level security;
alter table public.admin_audit_logs enable row level security;

drop policy if exists oauth_accounts_select_self on public.oauth_accounts;
create policy oauth_accounts_select_self on public.oauth_accounts
  for select using (auth.uid() = user_id);

-- admin_audit_logs는 정책 없음 = 클라이언트 접근 차단.

commit;
