# AI 유튜브 영상 파이프라인 (`@tae/video`)

원문(유튜브 자막 · 블로그 본문 · 인스타 캡션) 하나로 **9:16 쇼츠**와 **16:9 가로형** MP4를
만드는 파이프라인입니다. 모든 단계는 `제공자 인터페이스 + 실제 구현 + 결정적 데모 폴백`으로
되어 있어, API 키가 없어도 전체 흐름을 그대로 검증할 수 있습니다.

## 흐름

```
원문 ─▶ 1) storyboard ─▶ 2) images ─▶ 3) TTS ─▶ 4) STT/자막 ─▶ 5) ffmpeg ▶ video.mp4
          (Claude|데모)     (gpt-image-1|데모 PNG)  (OpenAI TTS|데모 WAV)  (Whisper|정렬)   (Ken Burns + 자막)
```

| 단계 | 실제 구현 | 폴백 | 산출물 |
| --- | --- | --- | --- |
| 스토리보드 | `packages/video/src/storyboard.ts` (Claude, zod 검증) | `demo/storyboard.ts` (결정적 분배) | `storyboard.json` |
| 이미지 | `images/openai.ts` (`gpt-image-1` / `dall-e-3`) | `images/demo.ts` (자체 PNG 인코더) | `images/scene-01.png` |
| 음성 | `audio/openai.ts` (`tts-1` / `gpt-4o-mini-tts`, WAV) | `audio/demo.ts` (말하는 리듬의 WAV) | `audio/scene-01.wav` |
| 자막 | `stt/openai.ts` (Whisper `verbose_json` + word 타임스탬프) | `stt/fallback.ts` (글자 수 비례 정렬) | `subtitles.srt` / `.ass` |
| 렌더 | `renderer/ffmpeg.ts` (zoompan · concat · `ass` 필터) | ffmpeg가 없으면 자산 + `render.sh` | `video.mp4` |

## 비율 프리셋

| | 9:16 쇼츠 | 16:9 가로형 |
| --- | --- | --- |
| 해상도 | 1080×1920 | 1920×1080 |
| 길이 | 45~60초 (목표 52초) | 90~180초 (목표 135초) |
| 장면 | 5~8개 | 8~12개 |
| 자막 | 64px · 22자/컷 | 58px · 34자/컷 |

나레이션 글자 수로 장면 길이를 추정한 뒤(`speechCharsPerSecond`) 총 길이를 목표 범위로
정규화하고, TTS 실측 길이가 더 길면 장면을 늘려 자막·음성이 어긋나지 않게 다시 계산합니다.

## CLI

```bash
# ffmpeg/제공자 상태
pnpm --filter @tae/video exec tsx src/cli.ts doctor

# 스토리보드만
pnpm --filter @tae/video exec tsx src/cli.ts storyboard \
  --source fixtures/demo-source.ko.md --source-type blog --aspect 9:16

# 실제 렌더
FFMPEG_PATH=/usr/bin/ffmpeg pnpm --filter @tae/video exec tsx src/cli.ts render \
  --source fixtures/demo-source.ko.md --source-type blog --aspect 16:9 \
  --out .output/demo-16x9

# 워커
pnpm --filter @tae/video exec tsx src/cli.ts worker --port 8080 --dir .output
```

`--quality preview`는 절반 해상도·ultrafast로 빠르게 확인할 때 씁니다.
`--json`을 붙이면 결과 전체를 JSON으로 출력합니다.

## 워커 HTTP API

`apps/video-worker`가 이 서버를 띄웁니다(`docs/DEPLOY.md`의 배포 절 참고).

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| `GET` | `/health` | ffmpeg 버전, 제공자 모드, 대기/실행 중 작업 수 |
| `POST` | `/v1/render` | `{ "storyboard": {...}, "quality": "final" }` → `202 { job }` |
| `GET` | `/v1/jobs` | 최근 작업 목록 |
| `GET` | `/v1/jobs/:id` | 상태(`queued`/`running`/`succeeded`/`failed`), 진행률, 파일 |
| `GET` | `/v1/jobs/:id/files/:name` | `video.mp4`, `subtitles.srt`, `subtitles.ass`, `storyboard.json` |

`VIDEO_WORKER_TOKEN`이 설정되어 있으면 `Authorization: Bearer <token>`이 필요합니다.
작업 상태는 `<VIDEO_OUTPUT_DIR>/<jobId>/job.json`에 남아 워커가 재시작해도 유지됩니다.

## youtube-blog 연동

1. `POST /api/convert`에 `format: "youtube_video"`와 `aspectRatio`를 보내면
   스토리보드 + 자막(SRT/ASS)을 즉시 돌려주고 크레딧을 차감합니다.
2. 결과 화면의 **MP4 렌더 시작**이 `POST /api/video/render`로 스토리보드를 워커에 넘깁니다.
3. `GET /api/video/status?jobId=...`로 진행률을 폴링하고,
   `GET /api/video/file?jobId=...&name=video.mp4`로 미리보기·다운로드합니다.

서버 모드 선택:

| 조건 | 모드 | 동작 |
| --- | --- | --- |
| `VIDEO_WORKER_URL` 있음 | worker | 렌더를 워커에 위임 (프로덕션 권장) |
| `VIDEO_INLINE=1` 또는 `NODE_ENV !== production` | inline | Next 프로세스에서 백그라운드 렌더 (로컬 전용) |
| 그 외 | disabled | 스토리보드·자막까지만 제공하고 이유를 UI에 표시 |

## 환경변수

| 변수 | 기본 | 설명 |
| --- | --- | --- |
| `OPENAI_API_KEY` | — | 이미지·TTS·STT. 없으면 데모 |
| `OPENAI_IMAGE_MODEL` | `gpt-image-1` | `dall-e-3`도 지원 |
| `OPENAI_IMAGE_QUALITY` | — | `low`/`medium`/`high` (gpt-image-1) |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | `gpt-4o-mini-tts` / `alloy` | |
| `OPENAI_STT_MODEL` | `whisper-1` | |
| `FFMPEG_PATH` | PATH의 `ffmpeg` | 워커 Docker 이미지에는 ffmpeg가 포함됩니다 |
| `VIDEO_SUBTITLE_FONT` | `Noto Sans CJK KR` | ASS 폰트 이름 |
| `VIDEO_WORKER_URL` / `VIDEO_WORKER_TOKEN` | — | youtube-blog → 워커 |
| `VIDEO_OUTPUT_DIR` | `.video-output` / `/data/video-jobs` | 저장 경로 |
| `VIDEO_CONVERT_COST` | `1` | 영상 기획 1회 크레딧 |
| `VIDEO_DEMO` | — | `1`이면 키가 있어도 데모만 사용 |

## 한계

- ffmpeg가 없으면 MP4를 만들지 않고 이미지·음성·자막·`render.sh`만 남깁니다(상태 `assets_only`).
- 데모 이미지는 글자를 그리지 않습니다(폰트 의존을 없애기 위해). 실제 이미지는 OpenAI 모델이 만듭니다.
- Whisper가 단어 타임스탬프를 주지 않으면 구간 타임스탬프 → 나레이션 정렬 순서로 폴백합니다.
- 긴 영상(16:9, 3분)은 CPU 2코어 기준 1~3분 걸립니다. 워커 동시 실행 수는 `VIDEO_WORKER_CONCURRENCY`로 제한합니다.
