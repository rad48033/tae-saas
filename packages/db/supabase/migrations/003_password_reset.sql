-- ============================================================================
-- tae-saas 003 — 비밀번호 찾기 / 재설정
--   users.password_changed_at  : 비밀번호를 바꾼 시각(이 시각 이전 세션 쿠키 무효)
--   password_resets            : 일회용 재설정 토큰(원문이 아니라 sha256 해시 보관)
--
-- 적용:
--   Supabase SQL Editor에 그대로 붙여넣거나
--   psql "$DATABASE_URL" -f packages/db/supabase/migrations/003_password_reset.sql
-- ============================================================================

begin;

alter table public.users add column if not exists password_changed_at timestamptz;

comment on column public.users.password_changed_at is
  '비밀번호 변경 시각. 이 시각보다 먼저 발급된 세션 토큰은 서버가 거부합니다.';

create table if not exists public.password_resets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users (id) on delete cascade,
  -- 원문 토큰은 저장하지 않습니다(sha256 hex 64자).
  token_hash text not null unique,
  -- email = 메일로 발송됨, admin = 관리자 확인 후 전달, link = 관리자가 화면에서 링크 발급
  delivery text not null default 'admin' check (delivery in ('email', 'admin', 'link')),
  requested_ip text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

comment on table public.password_resets is
  '비밀번호 재설정 요청. used_at이 채워지면 다시 쓸 수 없습니다(일회용).';

create index if not exists password_resets_user_idx
  on public.password_resets (user_id, created_at desc);
create index if not exists password_resets_pending_idx
  on public.password_resets (expires_at desc)
  where used_at is null;

-- RLS: 서버(service role) 전용. 정책을 만들지 않아 클라이언트 접근은 막힙니다.
alter table public.password_resets enable row level security;

revoke all on table public.password_resets from anon, authenticated;

commit;
