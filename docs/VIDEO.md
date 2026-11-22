# AI 유튜브 영상 파이프라인 (`@tae/video`)

원문(유튜브 자막 · 블로그 본문 · 인스타 캡션) 하나로 **9:16 쇼츠**와 **16:9 가로형** MP4를
만드는 파이프라인입니다. 모든 단계는 `제공자 인터페이스 + 실제 구현 + 결정적 데모 폴백`으로
되어 있어, API 키가 없어도 전체 흐름을 그대로 검증할 수 있습니다.

## 흐름

```
원문 ─▶ 1) 참조 이미지 ─▶ 2) storyboard ─▶ 3) images ─▶ 4) TTS ─▶ 5) STT/자막 ─▶ 6) ffmpeg ▶ video.mp4
        (실제 제품 사진)   (Gemini|Claude|GPT|데모)  (gpt-image-2 high 1088×1920|무료 이미지|PNG)  (alloy 1.25배속 TTS|WAV)  (Whisper 단어 타임스탬프|정렬)  (Ken Burns + 자막)
```

| 단계 | 실제 구현 | 폴백 | 산출물 |
| --- | --- | --- | --- |
| 참조 이미지 | `references.ts` (URL·로컬 경로·data URL → 바이트, 사설망 차단·12MB·6장) | 없음( 참조 없으면 텍스트 생성) | `manifest.json`의 `references` |
| 스토리보드 | `packages/video/src/storyboard.ts` (Claude, zod 검증) | `demo/storyboard.ts` (결정적 분배) | `storyboard.json` |
| 이미지 | `images/openai.ts` (`gpt-image-2` **high** 네이티브 1088×1920 · 참조 이미지가 있으면 `POST /images/edits`) | `images/demo.ts` (자체 PNG 인코더) | `images/scene-01.png` |
| 음성 | `audio/openai.ts` (`gpt-4o-mini-tts`, `alloy`, 1.25배속, WAV) | `audio/demo.ts` (말하는 리듬의 WAV) | `audio/scene-01.wav` |
| 자막 | `stt/openai.ts` (Whisper `verbose_json` 단어 타임스탬프 + 대본 문구) | `stt/fallback.ts` (글자 수 비례 정렬) | `subtitles.srt` / `.ass` |
| 렌더 | `renderer/ffmpeg.ts` (zoompan · concat · `ass` · loudnorm · BT.709) | ffmpeg가 없으면 자산 + `render.sh` | `video.mp4` |

### Gemini 대본 + GPT 미디어 하이브리드

```bash
AI_PROVIDER=gemini          # 대본·스토리보드(GEMINI_KEY)
VIDEO_PROVIDER=openai       # 이미지 gpt-image-2 + TTS alloy 1.25배속 + Whisper 자막
```

- 대본은 Gemini가 쓰고, 화면·목소리·자막 타이밍은 OpenAI가 만듭니다.
- `OPENAI_IMAGE_MODEL=gpt-image-2`는 16의 배수 크기면 임의 해상도를 받으므로 9:16은
  **1088×1920**, 16:9는 **1920×1088**을 네이티브로 생성합니다(1080×1920은 16의 배수가 아니어서 거부).
  최종 영상(1080×1920)은 ffmpeg에서 8px만 잘라 쓰므로 확대가 없습니다.
- 이미지 품질은 **기본 `high`**입니다(`OPENAI_IMAGE_QUALITY` 미설정 시). 장당 200~330원(1088×1920)이고,
  대본 8장면 기준 1편에 약 1,600~2,700원이 이미지에 들어갑니다. 비용을 줄이려면 `low`/`medium`.
- 자막은 Whisper 단어 타임스탬프로 **언제** 띄울지 정하고, 글자는 TTS에 넣은 대본을 그대로 씁니다.
  ("아연"을 "아이온"으로 잘못 받아쓰는 문제를 막고, 대본에 없는 말이 자막에 뜨지 않습니다.)

### 실제 제품 사진(참조 이미지) 반영

텍스트 프롬프트만으로 그리면 모델이 **가짜 패키지**를 상상합니다. 실제 제품 컷이 필요하면
참조 이미지를 함께 넣어 OpenAI Images **편집** 경로로 생성합니다.

```ts
import { runVideoPipeline } from "@tae/video";

await runVideoPipeline({
  source, aspectRatio: "9:16", outputDir: ".output/reel",
  referenceImages: [
    { path: "./ref/box-front.jpg", label: "제품 박스 정면", role: "product" },
    { url: "https://example.com/post/box-table.jpg", label: "제품 실사용", role: "product" },
  ],
});
```

- `role`: `product`(패키지 외관 고정) · `scene`(실제 공간) · `style`(색감). 기본 `product`.
- 참조가 있으면 `POST /v1/images/edits`에 `model=gpt-image-2`, `size=1088x1920`, `quality=high`,
  `image[]`(최대 16장)로 보내고, 프롬프트에 *"the exact package in the attached reference photo…
  same box shape, color, logo and Korean printed text"* 지시를 붙입니다. 스토리보드의 마무리 문구도
  `no logos` 대신 **패키지 로고·인쇄 문구 유지**로 바뀝니다(로고 삭제 방지).
- `gpt-image-2`는 `input_fidelity` 파라미터를 받지 않습니다(`400 invalid_input_fidelity_model`).
  `gpt-image-1`·`gpt-image-1.5`에서만 `input_fidelity=high`를 붙입니다.
- 스토리보드에도 사진 주소(`references`)가 기록되어, 워커가 같은 사진을 다시 내려받아 렌더합니다.
  로컬 파일·base64는 그 작업 디렉터리에서만 유효하므로 URL로 넘기는 것이 안전합니다.
- youtube-blog는 블로그·웹 글에서 `og:image`·본문 `<img>`를 자동 수집하고, 화면의
  **제품 사진 주소** 칸(최대 6장)으로 직접 넣을 수도 있습니다. 인스타는 로그인 벽 때문에
  자동 수집이 안 되므로 사진 주소를 직접 넣습니다.

## 비율 프리셋

| | 9:16 쇼츠 | 16:9 가로형 |
| --- | --- | --- |
| 해상도 | 1080×1920 | 1920×1080 |
| 길이 | 30~60초 (목표 45초) | 90~180초 (목표 135초) |
| 장면 | 6~10개 (권장 8) | 8~12개 |
| 장면 최대 길이 | 7초 | 22초 |
| 자막 | 76px · 18자/컷 · 2줄 · 최대 2.5초 | 60px · 34자/컷 · 2줄 · 최대 4.2초 |

나레이션 글자 수로 장면 길이를 추정한 뒤(`speechCharsPerSecond`) 총 길이를 목표 범위로
정규화합니다. TTS 실측 길이가 나오면 **실측 음성 + 0.22초 여운**으로 장면 길이를 다시 잡습니다.
1.25배속으로 짧아진 음성 뒤에 무음이 길게 남던 문제를 없애고, 장면 최대 길이를 넘는 음성만
`atempo`로 맞춥니다.

### 렌더 화질·색·음량

| 항목 | 설정 |
| --- | --- |
| 스케일 | `scale=1080:1920:force_original_aspect_ratio=increase:flags=lanczos` (확대 없음) |
| 인코딩 | `libx264 -preset medium -crf 18 -profile:v high` (미리보기 `ultrafast·crf 28`) |
| 색 | `yuv420p` · `-color_range tv` · `bt709` 3종 태그 + `out_color_matrix=bt709` |
| 음량 | `loudnorm=I=-14:TP=-1.5:LRA=11` (플랫폼 표준 -14 LUFS) |
| 오디오 | AAC 192kbps · 48kHz 스테레오 |
| 자막 | 흰 글자 + 검정 외곽선 5px + 그림자 1 (박스 모드는 `subtitle.box`) |

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

# 실제 제품 사진을 참조 이미지로 넣어 렌더 (쉼표로 여러 장)
FFMPEG_PATH=/usr/bin/ffmpeg pnpm --filter @tae/video exec tsx src/cli.ts render \
  --source fixtures/demo-source.ko.md --source-type instagram --aspect 9:16 \
  --ref ./ref/box-front.jpg,https://example.com/ref/table.jpg --out .output/reel

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
| `POST` | `/v1/render` | `{ "storyboard": {...}, "quality": "final", "referenceImages": [{ "url": "…" }] }` → `202 { job }` |
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
| `OPENAI_API_KEY` | — | 이미지·TTS·STT. 없으면 아래 대체 경로 |
| `GEMINI_API_KEY` | — | OpenAI 키가 없을 때 TTS(`gemini-3.8-flash-tts`)·전사(`gemini-3.5-transcribe`)·스토리보드 |
| `GEMINI_TTS_MODEL` / `GEMINI_TTS_VOICE` | `gemini-3.8-flash-tts` / (언어별 Kore·Puck) | Gemini 음성 모델·프리셋 보이스 |
| `GEMINI_STT_MODEL` | `gemini-3.5-transcribe` | Gemini 음성 전사 모델 |
| `OPENAI_IMAGE_FALLBACK_MODEL` | — | 기본 이미지 모델이 조직 인증·모델 중단으로 실패할 때 대체 (`dall-e-3`는 더 이상 제공되지 않음) |
| `AI_PROVIDER` | 자동 | 스토리보드 LLM 강제 선택(anthropic·openai·gemini·demo) |
| `VIDEO_PROVIDER` | `auto` | 미디어 경로 강제: `auto`·`openai`·`gemini`·`free`. OpenAI 키는 있는데 크레딧이 0이면 `gemini`로 지정 |
| `OPENAI_IMAGE_MODEL` | `gpt-image-2` | 9:16 1088×1920 · 16:9 1920×1088 네이티브. `gpt-image-1.5`/`gpt-image-1-mini`/`dall-e-3`도 지원 |
| `OPENAI_IMAGE_FALLBACK_MODEL` | `gpt-image-1-mini` | 기본 모델이 실패할 때 대체 |
| `OPENAI_IMAGE_QUALITY` | `high` | `low`/`medium`/`high`/`auto`. low는 장당 6원 수준이지만 제품 경계가 뭉개지고, high는 장당 200~330원(1088×1920)으로 릴스 화면에 바로 쓰는 결이 나옵니다 |
| `OPENAI_TTS_MODEL` / `OPENAI_TTS_VOICE` | `gpt-4o-mini-tts` / `alloy` | |
| `OPENAI_TTS_SPEED` | `1.25` | 릴스 템포. `1`이면 원속 |
| `OPENAI_STT_MODEL` | `whisper-1` | 단어 타임스탬프가 있는 모델. `gpt-4o-mini-transcribe`는 구간 단위로 뭉칩니다 |
| `FFMPEG_PATH` | PATH의 `ffmpeg` | 워커 Docker 이미지에는 ffmpeg가 포함됩니다 |
| `VIDEO_SUBTITLE_FONT` | `Noto Sans CJK KR` | ASS 폰트 이름 |
| `VIDEO_WORKER_URL` / `VIDEO_WORKER_TOKEN` | — | youtube-blog → 워커 |
| `VIDEO_OUTPUT_DIR` | `.video-output` / `/data/video-jobs` | 저장 경로 |
| `VIDEO_CONVERT_COST` | `9` | 영상 1편 총 크레딧(기획+렌더) |
| `VIDEO_STORYBOARD_COST` | `3` | 스토리보드·대본·자막 단계 차감 |
| `VIDEO_PREVIEW_COST` | `1` | 미리보기(저해상도) 렌더 차감 |
| `VIDEO_RENDER_COST` | `VIDEO_CONVERT_COST - VIDEO_STORYBOARD_COST` | MP4 렌더 차감(기본 6). 렌더 실패 시 자동 환불 |
| `VIDEO_DEMO` | — | `1`이면 키가 있어도 데모만 사용 |
| `VIDEO_DEMO_IMAGE` | `pollinations` | 키 없을 때 이미지: `pollinations`(무료 AI 이미지) / `card`(직접 그린 카드) |
| `VIDEO_DEMO_VOICE` | `google` | 키 없을 때 음성: `google`(무료 TTS, 한국어 실제 음성) / `bed`(배경 음) |
| `VIDEO_OFFLINE` | — | `1`이면 외부 무료 서비스를 부르지 않고 카드·배경 음으로만 렌더 |
| `VIDEO_IMAGE_CACHE_DIR` | OS 임시폴더 | 무료 이미지 캐시(프롬프트 해시). 재렌더는 캐시를 재사용합니다 |
| `POLLINATIONS_IMAGE_URL` / `POLLINATIONS_MODEL` | 공개 엔드포인트 / `sana` | 무료 이미지 엔드포인트 교체 |

## 한계

- ffmpeg가 없으면 MP4를 만들지 않고 이미지·음성·자막·`render.sh`만 남깁니다(상태 `assets_only`).
- 키 없는 이미지(Pollinations 무료 엔드포인트)는 **IP당 45초에 1장**으로 제한되고 결과 이미지에 `pollinations.ai` 워터마크가 붙습니다. 프롬프트 해시로 디스크에 캐시해 재렌더는 즉시 끝납니다.
- 우선순위: OpenAI(이미지·TTS·Whisper) → Gemini(TTS·전사, GEMINI_API_KEY가 있을 때) → 무료 Google TTS → 배경 음.
- 키 없는 음성(Google 번역 읽어주기)은 비공식 무료 엔드포인트입니다. 요청당 200자로 나뉘고, 실패하면 배경 음으로 넘어갑니다. 상업적 배포에는 `OPENAI_API_KEY`를 쓰세요.
- Gemini 이미지 모델(`gemini-3.1-flash-image` 등)은 무료 등급에서 한도가 0이라 기본 경로로 쓰지 않습니다. 이미지는 OpenAI 키가 없으면 Pollinations(무료, 워터마크) 또는 카드입니다.
- 데모 카드 이미지는 폰트 없이 그리므로 글자를 넣지 않습니다(큰 장면 번호만 그림). 실제 이미지는 OpenAI 모델이 만듭니다.
- Whisper가 단어 타임스탬프를 주지 않으면 구간 타임스탬프 → 나레이션 정렬 순서로 폴백합니다.
- 참조 이미지를 넣으면 실제 패키지를 유지하지만, 인쇄된 아주 작은 글자는 모델이 일부 흐릴 수 있습니다.
  중요한 문구는 장면 자막으로도 한 번 더 보여 주세요.
- 참조 이미지가 없으면 `gpt-image-2`는 여전히 패키지를 상상해 그립니다(가짜 브랜드가 나올 수 있음).
- 긴 영상(16:9, 3분)은 CPU 2코어 기준 1~3분 걸립니다. 워커 동시 실행 수는 `VIDEO_WORKER_CONCURRENCY`로 제한합니다.
