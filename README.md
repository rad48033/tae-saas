# TAE SaaS Monorepo

원문 하나를 **유튜브 영상(MP4)** 과 **블로그 / 인스타 / 페이스북** 콘텐츠로 바꿔 주는
콘텐츠 SaaS와, PDF를 텍스트/구조화 JSON으로 바꿔 주는 REST API 모음입니다.
pnpm 워크스페이스 + Turborepo 구조이며, 각 앱은 독립적으로 배포됩니다.

## Apps

| 앱 | 설명 | 스택 | 로컬 포트 |
| --- | --- | --- | --- |
| `apps/youtube-blog` | 유튜브 자막 · 블로그 본문 · 인스타 캡션 → **유튜브 영상 / 블로그 / 인스타 / 페이스북** | Next.js 15 (App Router) | 3000 |
| `apps/video-worker` | 스토리보드 → 이미지 · TTS · 자막 → **ffmpeg MP4** 렌더 워커 | Node HTTP + tsx (Docker) | 8080 |
| `apps/pdf-api` | PDF → 텍스트/구조화 JSON REST API | Hono + pdf.js | 8787 |

> `apps/readme-bot`(GitHub README 자동 생성)과 `packages/ui`는 다음 단계로 남겨 두었습니다.

## Packages

| 패키지 | 역할 |
| --- | --- |
| `packages/ai` | Claude 래퍼, 옴니채널 원문 타입, 프롬프트, zod 스키마, JSON 교정, 데모 생성기, 비용 계산 |
| `packages/video` | 스토리보드 · AI 이미지 · TTS · Whisper 자막 · ffmpeg 렌더, HTTP 워커와 CLI |
| `packages/db` | Supabase 클라이언트, 저장소 계층(운영/인메모리), API 키 해시, SQL 마이그레이션 |
| `packages/stripe` | LemonSqueezy 체크아웃·웹훅 서명 검증, 크레딧팩 카탈로그 |

## 구조

```
.
├── apps
│   ├── youtube-blog
│   │   ├── src/app                 # 페이지 + API 라우트
│   │   │   ├── api/convert         # 원문 → 콘텐츠/스토리보드
│   │   │   ├── api/video/render    # MP4 렌더 시작(워커 또는 인라인)
│   │   │   ├── api/video/status    # 렌더 진행률
│   │   │   ├── api/video/file      # MP4·SRT·ASS 다운로드
│   │   │   ├── api/credits
│   │   │   ├── api/checkout        # LemonSqueezy 체크아웃 생성
│   │   │   └── api/webhooks/lemonsqueezy
│   │   ├── src/components          # 변환 폼, 결과 뷰, 영상 결과 뷰, 요금제
│   │   └── src/lib                 # youtube, article, source-input, video, session, webhook
│   ├── video-worker                # Dockerfile + Railway/Fly.io 배포용 엔트리
│   └── pdf-api
│       ├── src/app.ts              # Hono 라우트
│       ├── src/lib/pdf.ts          # pdf.js 텍스트 추출
│       ├── src/lib/parse-request.ts# 멀티파트/JSON/URL + SSRF 방지
│       └── api/index.js            # Vercel 번들(빌드 산출물)
├── packages
│   ├── ai
│   ├── video
│   │   ├── src/storyboard.ts       # 장면 · 나레이션 · 영어 비주얼 프롬프트
│   │   ├── src/images              # OpenAI Images / 결정적 PNG
│   │   ├── src/audio               # OpenAI TTS / 말하는 리듬 WAV
│   │   ├── src/stt                 # Whisper 타임스탬프 / 결정적 정렬
│   │   ├── src/renderer            # ffmpeg zoompan·concat·ass
│   │   ├── src/worker.ts           # HTTP 워커
│   │   └── src/cli.ts              # doctor / storyboard / render / worker
│   ├── db
│   │   └── supabase/migrations/001_init.sql
│   └── stripe
├── scripts/smoke-video.mjs         # 앱 ↔ 렌더 E2E 스모크
└── docs
    ├── API.md                      # PDF API 레퍼런스
    ├── VIDEO.md                    # 영상 파이프라인 · 워커 API
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
pnpm dev:worker            # http://localhost:8080 (영상 렌더 워커)
```

### 키 없이도 돌아갑니다 (데모 모드)

- **ANTHROPIC_API_KEY 없음** → 규칙 기반 초안·스토리보드를 만들고 응답에 `provider: "demo"`를 표시합니다.
- **OPENAI_API_KEY 없음** → 키 없이 동작하는 대체를 씁니다: 장면 이미지는 Pollinations 공개 이미지 생성(무료, 장면당 최대 45초 대기·워터마크), 음성은 Google 무료 TTS(한국어 실제 음성), 자막은 나레이션 기준 정렬. 둘 다 실패하면 직접 그린 카드 이미지와 배경 음으로 넘어가고 MP4는 그대로 렌더됩니다.
- 외부 호출을 끄려면 `VIDEO_OFFLINE=1`(카드·배경 음), 이미지/음성만 따로 바꾸려면 `VIDEO_DEMO_IMAGE=card` · `VIDEO_DEMO_VOICE=bed`를 씁니다.
- **Supabase 없음** → 인메모리 저장소. 서버를 재시작하면 사용자·크레딧·API 키가 사라집니다.
- 키가 있는데 호출이 실패하면 **조용히 데모로 넘어가지 않고 오류를 반환**합니다.

## 스크립트

| 명령 | 설명 |
| --- | --- |
| `pnpm dev` | 모든 앱 개발 모드 |
| `pnpm build` | 전체 빌드 (Next 빌드 + PDF API 번들) |
| `pnpm typecheck` | 전체 `tsc --noEmit` |
| `pnpm test` | 전체 Vitest (**161개**) |
| `pnpm dev:blog` / `pnpm dev:pdf` / `pnpm dev:worker` | 앱별 개발 모드 |
| `pnpm video doctor` | ffmpeg·제공자 상태 |
| `pnpm video render --source … --aspect 9:16 --out .output/demo` | CLI 렌더 |

로컬에서 `.next`가 잠겨 있으면 `NEXT_DIST_DIR=.next-build pnpm build`로 우회할 수 있습니다.

## youtube-blog — 3가지 입력, 4가지 결과

| 입력 | 만들 수 있는 결과 |
| --- | --- |
| `youtube` (영상 URL · 자막) | 블로그 · 인스타 · 페이스북 |
| `blog` (글 URL · 본문) | **유튜브 영상** · 인스타 · 페이스북 |
| `instagram` (게시물 URL · 캡션) | **유튜브 영상** · 블로그 · 페이스북 |

| 결과 | 내용 |
| --- | --- |
| `youtube_video` | 9:16(1080×1920, 45~60초, 5~8장면) 또는 16:9(1920×1080, 90~180초, 8~12장면) 스토리보드 · 나레이션 · SRT/ASS · MP4 |
| `blog` | 인플루언서급 장문 SEO 글: 요약 · H2 4~5개 본문(2,000~3,500자) · 장단점 · 실행 결론 · FAQ 3~5개 · 태그 8~10개 |
| `instagram` | 훅 + 카드뉴스 10장(표지 · 핵심 7 · 주의 · 요약) + 여러 문단 캡션 + 해시태그 15~20개 |
| `facebook` | 약 20줄 스토리텔링 피드 글 + 핵심 불릿 4~6개 + 댓글 유도 질문 |

- 언어: 한국어 / English
- 크레딧: 텍스트 1개 = 1크레딧, 영상 기획 = `VIDEO_CONVERT_COST`(기본 1). 실패 시 자동 환불.
- 세션은 서명된 HttpOnly 쿠키(`tae_uid`)로 익명 사용자를 식별하고, 첫 방문에 체험 크레딧 2개를 지급합니다.

### 영상 파이프라인

```
원문 → 스토리보드 → 장면 이미지 → TTS → STT 자막 → ffmpeg(Ken Burns 줌/팬 + 자막) → MP4
```

- Vercel 서버리스는 ffmpeg 렌더를 돌릴 수 없어 `apps/video-worker`로 분리했습니다.
  `VIDEO_WORKER_URL`을 설정하면 렌더가 워커로 넘어가고, 로컬에서는 인라인으로 실행됩니다.
- 자세한 구조·API·환경변수는 [docs/VIDEO.md](docs/VIDEO.md), 배포는 [docs/DEPLOY.md](docs/DEPLOY.md#6-영상-렌더-워커-railway--flyio--cloud-run).

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
| `OPENAI_API_KEY` / `OPENAI_IMAGE_MODEL` / `OPENAI_TTS_MODEL` / `OPENAI_STT_MODEL` | 영상 | 없으면 키 없는 대체(무료 이미지·무료 TTS) |
| `VIDEO_DEMO_IMAGE` / `VIDEO_DEMO_VOICE` / `VIDEO_OFFLINE` | 영상 | `card` / `bed` / `1`이면 외부 무료 서비스 없이 렌더 |
| `VIDEO_IMAGE_CACHE_DIR` | 영상 | 무료 이미지 캐시 위치(기본 OS 임시폴더) |
| `VIDEO_WORKER_URL` / `VIDEO_WORKER_TOKEN` | youtube-blog | 없으면 프로덕션에서 스토리보드까지만 |
| `FFMPEG_PATH` | 워커 | 기본 PATH의 ffmpeg |
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

Vercel(2개 프로젝트) + 영상 워커(Railway/Fly.io/Cloud Run) + Supabase + LemonSqueezy + `taest.info`
도메인 설정을 단계별로 정리했습니다.
👉 [docs/DEPLOY.md](docs/DEPLOY.md)

## 보안 메모

- service role 키, Anthropic/OpenAI 키는 **서버에서만** 사용합니다. `NEXT_PUBLIC_` 접두사를 붙이지 마세요.
- PDF API와 블로그 URL 수집은 사설망/루프백 대역을 차단합니다(SSRF 완화). DNS 리바인딩까지 막으려면 프록시 계층이 필요합니다.
- 영상 워커는 `VIDEO_WORKER_TOKEN`을 설정하지 않으면 인증 없이 열립니다. 배포 시 반드시 설정하세요.
- 레이트 리밋은 인스턴스 메모리 기반입니다. 엄격한 제한이 필요하면 Upstash Redis로 교체하세요.
- 웹훅은 원문 바디 서명 검증 + 이벤트 ID 멱등 처리로 중복 지급을 막습니다.

## 테스트

```
packages/ai        39개 — JSON 추출/교정, 프롬프트, 옴니채널 스키마, 데모 생성기
packages/db        12개 — 크레딧 원장, API 키 해시, 웹훅 멱등, 작업 로그
packages/stripe    10개 — 서명 검증(고정 벡터), 이벤트 파싱, 체크아웃
packages/video     26개 — 스토리보드 스펙, 자막 포맷, PNG/WAV, ffmpeg 그래프, 파이프라인, 워커
apps/pdf-api       23개 — PDF 추출, 인증, 변환, 환불, SSRF, 관리자 키
apps/youtube-blog  51개 — URL/본문 추출, 세션, 웹훅, 내보내기, 영상 결과 뷰
```
