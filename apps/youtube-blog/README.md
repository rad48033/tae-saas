# @tae/youtube-blog

유튜브 링크 하나로 **블로그 포스팅 / 인스타 포스팅 / 페이스북 포스팅**을 만드는 Next.js 15 앱.

## 기능

- 유튜브 URL 파싱(`watch`, `youtu.be`, `shorts`, `embed`, `live`, 11자리 ID)
- oEmbed + youtubei player로 제목·채널·길이 수집
- 자막 자동 추출(3단 폴백) + **자막 직접 붙여넣기** 지원
- 형식별 프롬프트/스키마
  - `blog`: SEO 제목·메타·목차·본문·핵심 요약·FAQ·태그
  - `instagram`: 훅·카드뉴스 5~7장·캡션·CTA·해시태그 15~20개
  - `facebook`: 스토리 본문·핵심 불릿·댓글 유도 질문
- 한국어 / English
- 익명 세션(서명 쿠키) + 체험 크레딧 + 크레딧 차감/환불
- LemonSqueezy 체크아웃 + 웹훅(서명 검증·멱등)

## API 라우트

| 경로 | 설명 |
| --- | --- |
| `POST /api/convert` | `{url, format, language, focusKeyword?, audience?, transcript?}` |
| `GET /api/credits` | 잔액·모드 |
| `POST /api/checkout` | `{packId}` → `{url}` |
| `POST /api/webhooks/lemonsqueezy` | 주문 → 크레딧 지급 |
| `GET /api/health` | 상태 |

## 로컬 실행

```bash
pnpm --filter @tae/youtube-blog dev      # http://localhost:3000
pnpm --filter @tae/youtube-blog test     # 33개
pnpm --filter @tae/youtube-blog build
```

환경변수는 모노레포 루트 `.env`를 읽습니다(`next.config.mjs`에서 로드).

## 구조

```
src/app/layout.tsx, page.tsx        랜딩(히어로·기능·요금·FAQ)
src/app/api/*                       라우트 핸들러
src/components/converter.tsx        입력 폼 + 상태
src/components/result-view.tsx      형식별 결과 렌더링
src/lib/youtube.ts                  메타/자막 추출
src/lib/transcript.ts               붙여넣은 자막 정규화
src/lib/session*.ts                 서명 세션 쿠키
src/lib/webhook.ts                  LemonSqueezy 처리
src/lib/format-export.ts            복사/다운로드 직렬화
```

## 알려진 제약

유튜브가 데이터센터 IP의 자막 다운로드를 제한합니다. 자동 추출이 실패하면 422와 함께
"스크립트 표시 → 복사 → 붙여넣기" 안내가 나옵니다. 자세한 대응은 루트 `docs/DEPLOY.md` 참고.
