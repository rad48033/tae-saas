# 영상 렌더 워커 (Railway / Fly.io / Cloud Run)

`@tae/video`의 HTTP 워커를 그대로 띄우는 앱입니다. Vercel 서버리스는 ffmpeg 렌더를
돌릴 수 없어서, MP4 생성만 이 워커로 분리했습니다.

- API: `POST /v1/render` · `GET /v1/jobs/:id` · `GET /v1/jobs/:id/files/*` · `GET /health`
- 저장 경로: `VIDEO_OUTPUT_DIR` (영구 볼륨 필요. 기본 `/data/video-jobs`)
- 인증: `VIDEO_WORKER_TOKEN`을 설정하면 `Authorization: Bearer <token>` 필요

## 환경변수

| 변수 | 필수 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` | 선택 | 이미지(gpt-image-1/dall-e-3)·TTS·Whisper STT. 없으면 데모 생성 |
| `OPENAI_IMAGE_MODEL` | 선택 | 기본 `gpt-image-1` |
| `OPENAI_TTS_MODEL` | 선택 | 기본 `gpt-4o-mini-tts` |
| `OPENAI_STT_MODEL` | 선택 | 기본 `whisper-1` |
| `ANTHROPIC_API_KEY` | 선택 | 스토리보드는 youtube-blog에서 만들어 넘기므로 워커에는 불필요 |
| `VIDEO_WORKER_TOKEN` | 권장 | youtube-blog와 같은 값 |
| `VIDEO_OUTPUT_DIR` | 권장 | 영구 볼륨 경로 |
| `VIDEO_SUBTITLE_FONT` | 선택 | 기본 `Noto Sans CJK KR` (이미지에 fonts-noto-cjk 포함) |
| `FFMPEG_PATH` | 선택 | 기본은 PATH의 ffmpeg |

## Railway

1. New Project → Deploy from GitHub repo → `rad48033/tae-saas`
2. Settings → Build: **Dockerfile**, path `apps/video-worker/Dockerfile` (루트 `railway.json`에 지정됨)
3. Volumes → `/data` 마운트
4. Variables: `VIDEO_WORKER_TOKEN`, `OPENAI_API_KEY`, `VIDEO_OUTPUT_DIR=/data/video-jobs`
5. 배포 후 `https://<service>.up.railway.app/health`가 200인지 확인
6. youtube-blog(Vercel)에 `VIDEO_WORKER_URL=https://<service>.up.railway.app`, `VIDEO_WORKER_TOKEN=...` 추가 후 재배포

## Fly.io

```bash
fly launch --dockerfile apps/video-worker/Dockerfile --name tae-video-worker
fly volumes create video_data --size 10 --region nrt
fly secrets set VIDEO_WORKER_TOKEN=... OPENAI_API_KEY=...
fly deploy
```

`fly.toml` 예시:

```toml
app = "tae-video-worker"
primary_region = "nrt"

[build]
  dockerfile = "Dockerfile"

[mounts]
  source = "video_data"
  destination = "/data"

[[vm]]
  memory = "2gb"
  cpus = 2

[http_service]
  internal_port = 8080
  force_https = true
  auto_stop_machines = false
```

## Cloud Run

```bash
gcloud builds submit --tag gcr.io/PROJECT/tae-video-worker -f apps/video-worker/Dockerfile .
gcloud run deploy tae-video-worker \
  --image gcr.io/PROJECT/tae-video-worker \
  --memory 2Gi --cpu 2 --timeout 900 --concurrency 1 \
  --set-env-vars VIDEO_SUBTITLE_FONT="Noto Sans CJK KR" \
  --update-secrets ...
```

Cloud Run은 파일 시스템이 휘발성이므로 GCS 업로드 어댑터가 필요합니다(현재는 Railway/Fly.io의
영구 볼륨 구성을 권장).

## 로컬 실행

```bash
pnpm install
FFMPEG_PATH=$(which ffmpeg) pnpm --filter @tae/video-worker dev
# 또는 저장소 루트에서
pnpm --filter @tae/video worker -- --port 8080 --dir .output
```

로컬에서 youtube-blog를 띄울 때는 워커 없이도 인라인 렌더가 동작합니다
(`NODE_ENV !== "production"`이면 자동, 또는 `VIDEO_INLINE=1`).
