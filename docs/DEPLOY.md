# 배포 가이드 — Vercel + Supabase + LemonSqueezy + taest.info

두 앱을 각각 Vercel 프로젝트로 올리는 기준입니다. 순서대로 따라 하면 `blog.taest.info`(웹)와
`api.taest.info`(REST API)가 동작합니다.

- 예상 소요: 40~60분
- 필요한 계정: GitHub(`rad48033`), Vercel, Supabase, LemonSqueezy, Anthropic, 도메인(`taest.info`)

---

## 0. 사전 준비

```bash
git switch feat/mvp-youtube-blog-pdf-api
pnpm install
pnpm typecheck && pnpm test      # 161개 통과 확인
pnpm build                       # Next 빌드 + PDF API 번들 + 영상 패키지 타입검사
```

`.env.example`을 복사해 로컬 `.env`를 만들고, 아래 값들을 채워 넣습니다.

```bash
cp .env.example .env
```

---

## 1. Supabase

1. 대시보드에서 **일시정지된 `tae-saas` 프로젝트를 Resume** 합니다(무료 플랜은 장기 미사용 시 자동 정지).
2. **SQL Editor**를 열고 `packages/db/supabase/migrations/001_init.sql` 전체를 붙여넣고 실행합니다.
   CLI를 쓰려면:

   ```bash
   npx supabase login
   npx supabase link --project-ref <project-ref>
   npx supabase --workdir packages/db db push
   ```

3. **Project Settings → API**에서 다음 값을 복사합니다.

   | 값 | 환경변수 |
   | --- | --- |
   | Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
   | anon public key | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
   | service_role key | `SUPABASE_SERVICE_ROLE_KEY` (서버 전용, 절대 노출 금지) |

4. 확인: `conversion_jobs`, `usage_credits`, `api_keys` 테이블이 생겼는지 봅니다.

> 무료 플랜은 1주일가량 접속이 없으면 다시 정지될 수 있습니다. 정지되면 두 앱이 503을 반환합니다
> (`/api/health`, `/health`에서 `store: supabase` 확인 가능).

---

## 2. 텍스트 생성 LLM (Claude · GPT · Gemini 중 택 1)

세 제공자 중 **키가 있는 것**을 자동으로 씁니다. 순서는 Claude → OpenAI → Gemini 이고,
`AI_PROVIDER=anthropic|openai|gemini|demo`로 고정할 수 있습니다(지정한 키가 없으면 자동 순서로 돌아감).

| 제공자 | 환경변수 | 기본 모델 |
| --- | --- | --- |
| Anthropic Claude | `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL` | `claude-sonnet-4-5` |
| OpenAI GPT | `OPENAI_API_KEY`, `OPENAI_TEXT_MODEL` | `gpt-4o-mini` |
| Google Gemini | `GEMINI_API_KEY`, `GEMINI_MODEL` | `gemini-flash-latest` |

1. 키를 만듭니다: https://console.anthropic.com · https://platform.openai.com/api-keys · https://aistudio.google.com/apikey
2. 위 환경변수에 넣습니다. 세 가지 모두 3종 출력(블로그·인스타·페이스북)과 PDF 구조화, 영상 대본에 쓰입니다.
3. Gemini는 모델 별칭(`gemini-flash-latest`)을 기본값으로 둡니다. 특정 버전은 신규 사용자에게 닫힐 수 있습니다
   (`gemini-2.5-flash` → `no longer available to new users`). 고정하려면 `GEMINI_MODEL=gemini-3.8-flash`.

> 키가 하나도 없으면 두 앱은 **데모 모드**로 동작합니다. 배포 후 `/api/health`의 `services.ai`가
> `anthropic` / `openai` / `gemini` 중 무엇인지 확인하세요.
> 키는 있는데 호출이 실패하면(잔액 0, 모델 중단 등) 데모로 숨기지 않고 오류를 그대로 돌려줍니다.

---

## 3. LemonSqueezy

### 3-1. 상품(Variant) 만들기

Store → Products → New product. 아래 3개를 만들고 **각 Variant ID**를 복사합니다.

| 팩 | 크레딧 | 가격(USD) | 환경변수 |
| --- | --- | --- | --- |
| Starter | 30 | $9 | `LEMONSQUEEZY_VARIANT_STARTER` |
| Pro | 150 | $29 | `LEMONSQUEEZY_VARIANT_PRO` |
| Scale | 600 | $79 | `LEMONSQUEEZY_VARIANT_SCALE` |

가격·크레딧 수량을 바꾸려면 `packages/stripe/src/packs.ts`만 수정하면 UI와 웹훅 지급이 함께 바뀝니다.

### 3-2. API 키

Settings → API → 새 API 키를 만들어 `LEMONSQUEEZY_API_KEY`, `LEMONSQUEEZY_STORE_ID`에 넣습니다.
`LEMONSQUEEZY_STORE_SLUG`는 `https://<slug>.lemonsqueezy.com`의 slug입니다(예: `taest`).

### 3-3. 웹훅

Settings → Webhooks → `+`:

- **URL**: `https://blog.taest.info/api/webhooks/lemonsqueezy`
- **Signing secret**: 생성 후 `LEMONSQUEEZY_WEBHOOK_SECRET`에 저장
- **Events**: `order_created` (필수), `order_refunded`(선택, 현재는 무시 처리)

웹훅은 `X-Signature`(HMAC-SHA256 hex)를 원문 바디로 검증하고, `order_created:{order_id}`를
멱등 키로 사용해 재전송되어도 크레딧이 두 번 지급되지 않습니다.

> 정산 계좌(Stripe Express)가 등록되지 않으면 판매 대금이 보류됩니다. LemonSqueezy 대시보드의
> payout 설정을 먼저 완료하세요.

---

## 4. Vercel — youtube-blog

1. **Add New Project** → GitHub `rad48033/tae-saas` 선택
2. **Root Directory**: `apps/youtube-blog`
3. **Framework Preset**: Next.js (자동 감지)
4. **Build Command**: 기본값(`next build`) 그대로
5. **Environment Variables**:

   ```
   NEXT_PUBLIC_SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   # 텍스트 LLM (셋 중 최소 하나)
   AI_PROVIDER=gemini
   ANTHROPIC_API_KEY
   ANTHROPIC_MODEL=claude-sonnet-4-5
   GEMINI_API_KEY
   GEMINI_MODEL=gemini-flash-latest
   # 영상 미디어(선택): OpenAI 이미지·TTS·Whisper, 없으면 Gemini TTS·전사 + 무료 이미지
   OPENAI_API_KEY
   GEMINI_TTS_MODEL=gemini-3.8-flash-tts
   GEMINI_TTS_VOICE=Kore
   GEMINI_STT_MODEL=gemini-3.5-transcribe
   SESSION_SECRET=<openssl rand -hex 32>
   NEXT_PUBLIC_APP_URL=https://blog.taest.info
   NEXT_PUBLIC_PDF_APP_URL=https://api.taest.info
   TRIAL_CREDITS=2
   LEMONSQUEEZY_API_KEY
   LEMONSQUEEZY_STORE_ID
   LEMONSQUEEZY_STORE_SLUG=taest
   LEMONSQUEEZY_WEBHOOK_SECRET
   LEMONSQUEEZY_VARIANT_STARTER
   LEMONSQUEEZY_VARIANT_PRO
   LEMONSQUEEZY_VARIANT_SCALE
   # 영상 생성(선택): 없으면 데모 이미지·음성으로 렌더
   OPENAI_API_KEY
   OPENAI_IMAGE_MODEL=gpt-image-1
   OPENAI_TTS_MODEL=gpt-4o-mini-tts
   OPENAI_STT_MODEL=whisper-1
   # 영상 워커(6장에서 배포) — 없으면 스토리보드/자막까지만
   VIDEO_WORKER_URL=https://<worker-host>
   VIDEO_WORKER_TOKEN=<openssl rand -hex 32>
   VIDEO_CONVERT_COST=1
   ```

6. 배포 후 **Settings → Domains**에서 `blog.taest.info` 추가, DNS에 CNAME을 설정합니다.
7. `taest.info` 루트도 이 앱으로 보내려면 도메인을 추가하고, 리다이렉트는 Vercel Domains 설정에서 처리합니다.

> 모노레포이므로 프로젝트 설정에서 **"Include source files outside of the Root Directory in the Build Step"** 을
> 켜야 `packages/*`를 읽습니다. 루트의 `pnpm-lock.yaml`으로 설치됩니다.

### 확인

```bash
curl -s https://blog.taest.info/api/health
# {"status":"ok","services":{"store":"supabase","ai":"anthropic","billing":"configured"}}

curl -s -c /tmp/c.txt https://blog.taest.info/api/credits
# {"balance":2,...,"mode":"anthropic","store":"supabase"}
```

---

## 5. Vercel — pdf-api

1. **Add New Project** → 같은 저장소 선택
2. **Root Directory**: `apps/pdf-api`
3. **Framework Preset**: Other
4. **Build Command**: `pnpm run build` (`vercel.json`에도 지정되어 있음)
   - `tsc --noEmit` + esbuild 번들 → `api/index.js` + `api/pdf.worker.mjs`
5. **Environment Variables**:

   ```
   NEXT_PUBLIC_SUPABASE_URL
   SUPABASE_SERVICE_ROLE_KEY
   AI_PROVIDER=gemini
   ANTHROPIC_API_KEY
   ANTHROPIC_MODEL=claude-sonnet-4-5
   GEMINI_API_KEY
   GEMINI_MODEL=gemini-flash-latest
   PDF_API_ADMIN_TOKEN=<openssl rand -hex 32>
   ALLOWED_ORIGINS=https://blog.taest.info
   PDF_MAX_UPLOAD_BYTES=15728640
   PDF_MAX_PAGES=200
   ```

6. **Settings → Domains**: `api.taest.info`
7. 배포 후 상태 확인:

   ```bash
   curl -s https://api.taest.info/health
   ```

8. 관리자 토큰으로 첫 API 키를 발급합니다.

   ```bash
   curl -s -X POST https://api.taest.info/v1/keys \
     -H "Authorization: Bearer $PDF_API_ADMIN_TOKEN" \
     -H "content-type: application/json" \
     -d '{"email":"rad48033@gmail.com","name":"production","credits":100}'
   # {"key":"tae_live_...", ...}  ← 이 값은 다시 볼 수 없습니다
   ```

9. 발급한 키로 변환 테스트:

   ```bash
   curl -s -X POST https://api.taest.info/v1/convert \
     -H "Authorization: Bearer $TAE_API_KEY" \
     -F "file=@sample.pdf" -F "schema=invoice" | jq
   ```

### 참고: 서버리스 제약

- 요청 본문 한도(Vercel 기본 4.5MB) 때문에 큰 PDF는 `url` 입력을 권장합니다.
- `maxDuration` 60초, `regions: icn1`(서울)로 설정되어 있습니다.
- pdf.js 워커는 번들 옆에 함께 배포됩니다(`api/pdf.worker.mjs`). 지우지 마세요.

---

## 6. 영상 렌더 워커 (Railway / Fly.io / Cloud Run)

Vercel 서버리스는 ffmpeg 렌더(수 분)를 돌릴 수 없어서 MP4 생성만 별도 워커로 분리했습니다.
`apps/video-worker`가 `@tae/video`의 HTTP 워커를 그대로 띄웁니다.

### 6-1. Railway (가장 간단)

1. New Project → Deploy from GitHub repo → `rad48033/tae-saas`
2. 루트 `railway.json`이 Dockerfile(`apps/video-worker/Dockerfile`)을 사용하도록 지정되어 있습니다.
   빌드가 자동 감지되지 않으면 Settings → Build → Dockerfile 경로를 직접 넣습니다.
3. **Volumes → `/data`** 를 추가합니다(작업 산출물 보존).
4. Variables:

   ```
   VIDEO_WORKER_TOKEN=<openssl rand -hex 32>
   VIDEO_OUTPUT_DIR=/data/video-jobs
   OPENAI_API_KEY=<선택: 없으면 데모 이미지·음성>
   OPENAI_IMAGE_MODEL=gpt-image-1
   OPENAI_TTS_MODEL=gpt-4o-mini-tts
   OPENAI_STT_MODEL=whisper-1
   ```

5. 배포 후 확인:

   ```bash
   curl -s https://<worker-host>/health
   # {"status":"ok","ffmpeg":"ffmpeg version 7…","providers":{...}}
   ```

6. youtube-blog(Vercel)에 `VIDEO_WORKER_URL=https://<worker-host>`, `VIDEO_WORKER_TOKEN`(같은 값)을 넣고 재배포합니다.

### 6-2. Fly.io

```bash
fly launch --dockerfile apps/video-worker/Dockerfile --name tae-video-worker
fly volumes create video_data --size 10 --region nrt
fly secrets set VIDEO_WORKER_TOKEN=... OPENAI_API_KEY=...
fly deploy
```

`apps/video-worker/README.md`의 `fly.toml` 예시(memory 2gb, `/data` 마운트)를 참고하세요.

### 6-3. Cloud Run

```bash
gcloud builds submit --tag gcr.io/PROJECT/tae-video-worker -f apps/video-worker/Dockerfile .
gcloud run deploy tae-video-worker --image gcr.io/PROJECT/tae-video-worker \
  --memory 2Gi --cpu 2 --timeout 900 --concurrency 1
```

Cloud Run은 파일 시스템이 휘발성이므로 영구 저장이 필요하면 GCS 어댑터를 추가해야 합니다.
현재 구성은 Railway/Fly.io의 볼륨을 권장합니다.

### 6-4. 로컬 검증

```bash
FFMPEG_PATH=$(which ffmpeg) pnpm --filter @tae/video exec tsx src/cli.ts render \
  --source packages/video/fixtures/demo-source.ko.md --source-type blog --aspect 9:16 --out .output/smoke-9x16
```

워커 없이 youtube-blog만 띄우면 `NODE_ENV !== production`에서 인라인 렌더가 자동으로 켜집니다.
프로덕션에서 인라인을 강제하려면 `VIDEO_INLINE=1`을 설정하세요(단일 인스턴스·상주 서버에서만).

---

## 7. 배포 후 점검 체크리스트

- [ ] `https://blog.taest.info` 접속 → 요금 카드에 Variant ID 경고가 없음
- [ ] 데모가 아닌 `Claude 작성` 배지로 콘텐츠 생성 1회 성공
- [ ] 크레딧이 2 → 1로 줄고, 실패 시 다시 2로 돌아옴
- [ ] LemonSqueezy 테스트 모드 결제 → 웹훅 200, 크레딧 증가
- [ ] 같은 웹훅 재전송 → `duplicate: true`, 크레딧 변화 없음
- [ ] 블로그 글 → 유튜브 영상(9:16) 스토리보드·SRT 생성, 크레딧 1 차감
- [ ] `VIDEO_WORKER_URL` 연결 후 **MP4 렌더 시작** → `/health`의 ffmpeg 버전 확인, MP4 미리보기·다운로드 성공
- [ ] `api.taest.info/health` 200, `/v1/convert` 200
- [ ] 잘못된 API 키 → 401, 크레딧 0 사용자 → 402

---

## 8. 유튜브 자막 제한

유튜브는 데이터센터 IP에서의 자막 다운로드(`timedtext`)를 2025년 이후 강하게 제한합니다.
이 저장소의 앱은 다음 순서로 시도합니다.

1. `youtubei/v1/player` (ANDROID 클라이언트) → `captionTracks`
2. 워치 페이지의 `ytInitialPlayerResponse` → `captionTracks`
3. `api/timedtext?...&fmt=json3`

모두 실패하면 422와 함께 **"자막 직접 붙여넣기"** 안내를 반환하고, UI가 해당 입력칸으로 이동시킵니다.
사용자는 유튜브에서 `더보기 → 스크립트 표시`로 복사한 텍스트를 붙여넣어 바로 결과를 얻을 수 있습니다.

자동화를 유지하려면 다음 중 하나를 고려하세요.

- **프록시/주거용 IP**를 경유해 자막 요청 (약관·비용 검토 필요)
- **서드파티 자막 API**(Supadata, youtube-transcript.io 등)를 `fetchTranscript` 대체 구현으로 연결
- **브라우저 확장/클라이언트 측 추출** 후 서버로 텍스트만 전송 (CORS·약관 확인)

`src/lib/youtube.ts`의 `fetchTranscript()`만 교체하면 나머지 파이프라인은 그대로 동작합니다.

---

## 9. 운영 팁

- **SESSION_SECRET 회전**: 값을 바꾸면 기존 익명 세션이 모두 로그아웃되고 체험 크레딧이 재지급될 수 있습니다.
  회전 시 `users` 정리를 함께 고려하세요.
- **레이트 리밋**: `apps/*/src/lib/rate-limit.ts`는 인스턴스 메모리 기반입니다. 여러 인스턴스에서 엄격히 제한하려면
  Upstash Redis로 교체하세요.
- **비용**: Sonnet 기준 콘텐츠 1편은 입력 1.5만 토큰·출력 3천 토큰 수준(약 $0.09). `conversion_jobs.cost_usd`에
  누적되므로 Supabase에서 합계를 조회해 마진을 확인할 수 있습니다.
- **로그**: 두 앱 모두 `conversion_jobs`에 provider/model/token/cost/duration을 남깁니다. 실패 코드는
  `error_code`에 저장됩니다.

## 10. 문제 해결

| 증상 | 원인 / 해결 |
| --- | --- |
| `/api/credits` 503 "SESSION_SECRET" | Vercel 환경변수 누락. 추가 후 재배포 |
| `store: "memory"`로 표시 | Supabase URL/서비스 키 미설정 또는 프로젝트 정지 |
| 체크아웃 503 "Variant ID" | `LEMONSQUEEZY_VARIANT_*` 미설정 |
| 웹훅 401 | 서명 시크릿 불일치. LemonSqueezy에 입력한 값과 환경변수 비교 |
| 웹훅 200 `unmatched` | Variant ID가 `packs.ts`와 연결되지 않음 |
| PDF 415 | `%PDF` 헤더 없음. 파일이 실제 PDF인지 확인 |
| PDF 413 | 15MB 초과. `url` 입력 또는 한도 상향 |
| `taest.info` 401 | Vercel Deployment Protection이 켜져 있음 → Settings → Deployment Protection에서 해제 |
| 영상 렌더 버튼이 비활성 | `VIDEO_WORKER_URL` 미설정(프로덕션) → 6장 워커 배포 후 재배포 |
| 렌더 503 "워커에 연결하지 못했습니다" | 워커가 꺼졌거나 `VIDEO_WORKER_TOKEN` 불일치. `/health`로 확인 |
| MP4 없이 "MP4 없음" | 워커 이미지에 ffmpeg 누락. 이미지에 `ffmpeg` 패키지 포함 여부 확인 |
| 한글이 네모로 보임 | 워커에 CJK 폰트 누락. `fonts-noto-cjk` 설치 또는 `VIDEO_SUBTITLE_FONT` 지정 |
