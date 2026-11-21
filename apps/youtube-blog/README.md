# @tae/youtube-blog

유튜브 자막 · 블로그 본문 · 인스타 캡션을 **유튜브 영상(MP4) / 블로그 / 인스타 / 페이스북**으로
바꾸는 Next.js 15 앱.

## 기능

- 3가지 입력
  - `youtube`: 영상 URL 파싱(`watch`, `youtu.be`, `shorts`, `embed`, `live`, 11자리 ID), 자막 자동 추출(3단 폴백) + **자막 직접 붙여넣기**
  - `blog`: 글 URL에서 본문 추출(SSRF 차단, 엔티티/태그 정리) 또는 붙여넣은 본문
  - `instagram`: 게시물 URL에서 캡션 추출(메타 태그) 또는 붙여넣은 카드·캡션 텍스트
- 입력별로 가능한 결과만 노출: 유튜브 → 텍스트 3종, 블로그·인스타 → **유튜브 영상** + 나머지 텍스트
- 결과물
  - `youtube_video`: 9:16(1080×1920, 45~60초, 5~8장면) / 16:9(1920×1080, 90~180초, 8~12장면)
    스토리보드 · 나레이션 · SRT/ASS · MP4 렌더(워커)
  - `blog`: 인플루언서급 장문 SEO 글 (본문 2,000~3,500자, H2 4~5개, FAQ 3~5개, 태그 8~10개)
  - `instagram`: 훅 · 카드뉴스 10장 · 여러 문단 캡션 · 해시태그 15~20개
  - `facebook`: 약 20줄 스토리텔링 피드 · 불릿 4~6개 · 댓글 유도 질문
- 한국어 / English
- 익명 세션(서명 쿠키) + 체험 크레딧 + 크레딧 차감/환불
- LemonSqueezy 체크아웃 + 웹훅(서명 검증·멱등)

## API 라우트

| 경로 | 설명 |
| --- | --- |
| `POST /api/convert` | `{sourceType, url?, text?, transcript?, title?, author?, format, aspectRatio?, language, focusKeyword?, audience?}` |
| `POST /api/video/render` | `{storyboard, quality}` → `202 {jobId, mode}` |
| `GET /api/video/status?jobId=` | 진행률·산출물 |
| `GET /api/video/file?jobId=&name=video.mp4` | MP4/SRT/ASS/스토리보드 스트리밍 (`&download=1`) |
| `GET /api/credits` | 잔액·모드 |
| `POST /api/checkout` | `{packId}` → `{url}` |
| `POST /api/webhooks/lemonsqueezy` | 주문 → 크레딧 지급 |
| `GET /api/health` | 상태 |

## 로컬 실행

```bash
pnpm --filter @tae/youtube-blog dev      # http://localhost:3000
pnpm --filter @tae/youtube-blog test     # 51개
pnpm --filter @tae/youtube-blog build
```

영상 MP4까지 확인하려면 ffmpeg가 필요합니다. 개발 모드에서는 인라인 렌더가 자동으로 켜집니다.

```bash
FFMPEG_PATH=$(which ffmpeg) pnpm dev:blog
```

프로덕션(Vercel)에서는 `apps/video-worker`를 배포하고 `VIDEO_WORKER_URL`·`VIDEO_WORKER_TOKEN`을
설정해야 렌더가 켜집니다. 자세한 내용은 루트 `docs/VIDEO.md`.

환경변수는 모노레포 루트 `.env`를 읽습니다(`next.config.mjs`에서 로드).

## 구조

```
src/app/layout.tsx, page.tsx        랜딩(히어로·입력/출력·요금·FAQ)
src/app/api/*                       라우트 핸들러(convert, video/*, credits, checkout, webhook)
src/components/converter.tsx        입력 폼(입력 유형·형식·비율) + 상태
src/components/result-view.tsx      블로그/인스타/페이스북 결과
src/components/video-result-view.tsx 스토리보드·자막·렌더/미리보기
src/lib/youtube.ts                  메타/자막 추출
src/lib/article.ts                  블로그·인스타 HTML → 본문/캡션
src/lib/source-input.ts             입력 유형별 SourceDocument 정규화
src/lib/video.ts                    렌더 디스패치(워커/인라인)·상태·파일
src/lib/storyboard.ts               Claude 또는 데모 스토리보드
src/lib/session*.ts                 서명 세션 쿠키
src/lib/format-export.ts            복사/다운로드 직렬화
```

## 알려진 제약

- 유튜브가 데이터센터 IP의 자막 다운로드를 제한합니다. 자동 추출이 실패하면 422와 함께
  "스크립트 표시 → 복사 → 붙여넣기" 안내가 나옵니다.
- 인스타그램은 로그인 벽 때문에 캡션(메타 태그)만 읽을 수 있습니다. 카드 이미지 속 문구는 붙여넣어야 합니다.
- Vercel 서버리스에서는 ffmpeg 렌더가 불가능합니다. 워커 배포가 필요합니다.

자세한 대응은 루트 `docs/DEPLOY.md`, 영상 파이프라인은 `docs/VIDEO.md` 참고.
