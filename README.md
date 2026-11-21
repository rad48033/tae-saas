# TAE SaaS Monorepo

유튜브 영상과 PDF를 바로 쓸 수 있는 콘텐츠/데이터로 바꿔 주는 마이크로 SaaS 모음입니다.
pnpm 워크스페이스 + Turborepo 구조이며, 각 앱은 Vercel에 독립적으로 배포됩니다.

## Apps

| 앱 | 설명 | 스택 | 로컬 포트 |
| --- | --- | --- | --- |
| `apps/youtube-blog` | 유튜브 링크 → **블로그 / 인스타 / 페이스북** 콘텐츠 | Next.js 15 (App Router) | 3000 |
| `apps/pdf-api` | PDF → 텍스트/구조화 JSON REST API | Hono + pdf.js | 8787 |

> `apps/readme-bot`(GitHub README 자동 생성)과 `packages/ui`는 다음 단계로 남겨 두었습니다.

## Packages

| 패키지 | 역할 |
| --- | --- |
| `packages/ai` | Claude 래퍼, 프롬프트, zod 스키마, JSON 교정, 데모 생성기, 비용 계산 |
| `packages/db` | Supabase 클라이언트, 저장소 계층(운영/인메모리), API 키 해시, SQL 마이그레이션 |
| `packages/stripe` | LemonSqueezy 체크아웃·웹훅 서명 검증, 크레딧팩 카탈로그 |

## 구조

```
.
├── apps
│   ├── youtube-blog
│   │   ├── src/app                 # 페이지 + API 라우트
│   │   │   ├── api/convert         # 유튜브 → 콘텐츠 변환
│   │   │   ├── api/credits
│   │   │   ├── api/checkout        # LemonSqueezy 체크아웃 생성
│   │   │   └── api/webhooks/lemonsqueezy
│   │   ├── src/components          # 변환 폼, 결과 뷰, 요금제
│   │   └── src/lib                 # youtube, session, webhook, rate-limit
│   └── pdf-api
│       ├── src/app.ts              # Hono 라우트
│       ├── src/lib/pdf.ts          # pdf.js 텍스트 추출
│       ├── src/lib/parse-request.ts# 멀티파트/JSON/URL + SSRF 방지
│       └── api/index.js            # Vercel 번들(빌드 산출물)
├── packages
│   ├── ai
│   ├── db
│   │   └── supabase/migrations/001_init.sql
│   └── stripe
└── docs
    ├── API.md
    └── DEPLOY.md
```

## 빠른 시작

Node 20.11+ (권장 22), pnpm 9.

```bash
corepack enable
corepack prepare pnpm@9.12.3 --activate
pnpm install

cp .env.example .env      # 값이 비어 있어도 데모 모드로 동작합니다
pnpm dev:blog              # http://localhost:3000
pnpm dev:pdf               # http://localhost:8787
```

### 키 없이도 돌아갑니다 (데모 모드)

- **ANTHROPIC_API_KEY 없음** → 규칙 기반 초안을 만들고 응답에 `provider: "demo"`를 표시합니다.
  UI에도 "데모 모드" 배지가 뜹니다. 문장 품질만 다를 뿐 전체 흐름은 동일합니다.
- **Supabase 없음** → 인메모리 저장소. 서버를 재시작하면 사용자·크레딧·API 키가 사라집니다.
- 키가 있는데 Claude 호출이 실패하면 **조용히 데모로 넘어가지 않고 오류를 반환**합니다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `pnpm dev` | 모든 앱 개발 모드 |
| `pnpm build` | 전체 빌드 (Next 빌드 + PDF API 번들) |
| `pnpm typecheck` | 전체 `tsc --noEmit` |
| `pnpm test` | 전체 Vitest (111개) |
| `pnpm dev:blog` / `pnpm dev:pdf` | 앱별 개발 모드 |

로컬에서 `.next`가 잠겨 있으면 `NEXT_DIST_DIR=.next-build pnpm build`로 우회할 수 있습니다.

## youtube-blog — 3가지 발행 형식

| 형식 | 결과물 |
| --- | --- |
| `blog` | SEO 제목·메타 설명·H2/H3 목차·본문(마크다운)·핵심 요약·FAQ·태그 |
| `instagram` | 훅 + 카드뉴스 5~7장(제목/본문) + 캡션 + CTA + 해시태그 15~20개 |
| `facebook` | 스토리텔링 본문 3~5문단 + 핵심 불릿 3~6개 + 댓글 유도 질문 |

- 언어: 한국어 / English
- 크레딧 1개 = 콘텐츠 1개. 실패 시 자동 환불.
- 세션은 서명된 HttpOnly 쿠키(`tae_uid`)로 익명 사용자를 식별하고, 첫 방문에 체험 크레딧 2개를 지급합니다.

### ⚠️ 유튜브 자막 자동 추출에 대해

유튜브는 2025년 이후 서버(데이터센터 IP)에서의 자막 다운로드에 제한을 두고 있습니다.
이 앱은 ① youtubei player ② 워치 페이지의 `ytInitialPlayerResponse` ③ `timedtext` 순서로 시도하지만,
유튜브가 막는 영상/환경에서는 실패할 수 있습니다. 이때는 **"자막 직접 붙여넣기"**(유튜브 → 더보기 → 스크립트 표시 →
복사)로 바로 콘텐츠를 만들 수 있게 해 두었습니다. 자세한 대응책은 [docs/DEPLOY.md](docs/DEPLOY.md#유튜브-자막-제한)를 보세요.

## pdf-api — REST API

```bash
curl -X POST http://localhost:8787/v1/convert \
  -H "Authorization: Bearer $TAE_API_KEY" \
  -F "file=@invoice.pdf" \
  -F "schema=invoice"
```

- `GET /health`, `GET /v1/me`, `POST /v1/convert`, `GET /v1/jobs/:id`, `POST /v1/keys`(관리자)
- 입력: 멀티파트 파일 / JSON `{url}` / JSON `{base64}` / raw PDF
- 모드: `text`(결정적 추출) · `structured`(Claude 구조화, 스키마 5종)
- 크레딧: 10페이지당 1개(최소 1), 실패 시 환불
- API 키: `tae_live_…` 평문은 발급 시 1회만 노출, DB에는 SHA-256만 저장

전체 레퍼런스는 [docs/API.md](docs/API.md).

## 환경변수

`.env.example` 참고. 핵심만:

| 변수 | 사용처 | 비고 |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | 두 앱 | 없으면 인메모리 |
| `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` | 두 앱 | 없으면 데모 모드 |
| `SESSION_SECRET` | youtube-blog | 프로덕션 필수 |
| `LEMONSQUEEZY_*` | youtube-blog | 체크아웃/웹훅 |
| `PDF_API_ADMIN_TOKEN` | pdf-api | `/v1/keys` 발급용 |

## 데이터베이스

`packages/db/supabase/migrations/001_init.sql` 하나로 다음을 만듭니다.

- `users`, `api_keys`, `usage_credits`, `credit_transactions`, `orders`, `conversion_jobs`, `webhook_events`
- 크레딧 원자 처리를 위한 `grant_credits` / `consume_credits` / `refund_credits` / `grant_signup_bonus`
- RLS 정책(본인 행 조회) + service role 전용 함수 실행 권한

```bash
npx supabase link --project-ref <ref>
npx supabase --workdir packages/db db push
```

## 배포

Vercel(2개 프로젝트) + Supabase + LemonSqueezy + `taest.info` 도메인 설정을 단계별로 정리했습니다.
👉 [docs/DEPLOY.md](docs/DEPLOY.md)

## 보안 메모

- service role 키와 Anthropic 키는 **서버에서만** 사용합니다. `NEXT_PUBLIC_` 접두사를 붙이지 마세요.
- PDF API는 URL 입력 시 사설망/루프백 대역을 차단합니다(SSRF 완화). DNS 리바인딩까지 막으려면 프록시 계층이 필요합니다.
- 레이트 리밋은 인스턴스 메모리 기반입니다. 엄격한 제한이 필요하면 Upstash Redis로 교체하세요.
- 웹훅은 원문 바디 서명 검증 + 이벤트 ID 멱등 처리로 중복 지급을 막습니다.

## 테스트

```
packages/ai       33개 — JSON 추출/교정, 프롬프트, 형식별 스키마, 데모 생성기
packages/db       12개 — 크레딧 원장, API 키 해시, 웹훅 멱등, 작업 로그
packages/stripe   10개 — 서명 검증(고정 벡터), 이벤트 파싱, 체크아웃
apps/pdf-api      23개 — PDF 추출, 인증, 변환, 환불, SSRF, 관리자 키
apps/youtube-blog 33개 — URL 파싱, 자막 파싱, 세션, 웹훅, 내보내기
```
