# @tae/pdf-api

PDF → 텍스트/구조화 JSON REST API. Hono + pdf.js, Vercel Node 함수로 배포.

## 엔드포인트

| 메서드 | 경로 | 설명 |
| --- | --- | --- |
| GET | `/health` | 상태 |
| GET | `/v1/me` | 크레딧·키 정보 |
| POST | `/v1/convert` | 파일/URL/base64/raw 변환 |
| GET | `/v1/jobs/:id` | 작업 상태 |
| POST | `/v1/keys` | 관리자 키 발급 |

입력·응답·오류 코드 전체는 [docs/API.md](../../docs/API.md).

## 로컬 실행

```bash
pnpm --filter @tae/pdf-api dev       # http://localhost:8787
pnpm --filter @tae/pdf-api test      # 23개
pnpm --filter @tae/pdf-api build     # tsc + esbuild 번들
```

첫 API 키 발급:

```bash
PDF_API_ADMIN_TOKEN=dev-token pnpm --filter @tae/pdf-api dev

curl -X POST http://localhost:8787/v1/keys \
  -H "Authorization: Bearer dev-token" \
  -H "content-type: application/json" \
  -d '{"email":"me@example.com","credits":10}'
```

## 구조

```
src/app.ts                 Hono 앱(라우트·오류 처리)
src/server.ts              Node 서버(@hono/node-server)
src/vercel.ts              Vercel 진입점(hono/vercel)
src/lib/pdf.ts             pdf.js 텍스트 추출, 페이지/크레딧 계산
src/lib/parse-request.ts   입력 정규화, URL 다운로드, SSRF 차단
src/middleware/auth.ts     API 키/관리자 인증
src/middleware/rate-limit.ts
scripts/build.mjs          esbuild 번들 + pdf.worker.mjs 복사
```

## 배포

Root Directory `apps/pdf-api`, Build Command `pnpm run build`, Framework `Other`.
`vercel.json`이 `/api/index`로의 rewrite, `maxDuration: 60`, 서울 리전(`icn1`)을 설정합니다.
번들 크기: `api/index.js` 약 1.2MB + `pdf.worker.mjs` 약 2.3MB.

## 제약

- 최대 15MB / 200페이지(환경변수 조정 가능)
- 텍스트 레이어 없는 스캔 PDF는 OCR이 필요합니다(현재 미지원)
- 캔버스 렌더링은 하지 않으므로 `@napi-rs/canvas` 경고는 무해합니다
