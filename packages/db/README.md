# @tae/db

Supabase 클라이언트와 저장소 계층, 그리고 Postgres 스키마.

## 구성

| 파일 | 역할 |
| --- | --- |
| `src/client.ts` | service role Supabase 클라이언트(서버 전용) |
| `src/store.ts` | 두 앱이 공유하는 저장소 계약 |
| `src/supabase-store.ts` | 운영 구현. 크레딧 증감은 RPC로 원자 처리 |
| `src/memory-store.ts` | 로컬/테스트용 인메모리 구현 |
| `src/keys.ts` | API 키 발급·SHA-256 해시 |
| `supabase/migrations/001_init.sql` | 테이블·함수·RLS |

## 마이그레이션 적용

```bash
npx supabase login
npx supabase link --project-ref <프로젝트 ref>
npx supabase --workdir packages/db db push
```

Supabase 대시보드 SQL Editor에 `supabase/migrations/001_init.sql`을 붙여넣어도 됩니다(한 번만).

## 설계 메모

- 크레딧 차감은 `consume_credits()` 함수 안에서 `balance >= p_amount` 조건과 함께 UPDATE 하므로,
  동시 요청이 와도 잔액이 음수가 되지 않습니다.
- 모든 `amount`는 양수 지급 / 음수 사용으로 통일해 원장 합계 = 잔액이 되도록 했습니다.
- 웹훅은 `webhook_events.id`(=이벤트 ID) 기본키로 중복 지급을 막습니다.
