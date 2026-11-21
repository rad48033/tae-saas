# PDF API 레퍼런스

Base URL: `https://api.taest.info` (로컬: `http://localhost:8787`)

PDF에서 텍스트를 추출하고, Claude로 원하는 스키마의 JSON을 만듭니다.
모든 응답은 JSON이며, 실패 시 `{ "error": { "code", "message", "requestId" } }` 형태입니다.

## 인증

```
Authorization: Bearer tae_live_...
```

`X-API-Key: tae_live_...` 헤더도 허용합니다. 키는 서버에 SHA-256 해시로만 저장되며 평문은 발급 시 한 번만
보입니다.

## 엔드포인트

| 메서드 | 경로 | 설명 | 인증 |
| --- | --- | --- | --- |
| GET | `/health` | 상태·저장소·AI 모드 | 없음 |
| GET | `/v1/me` | 내 크레딧·키 정보 | API 키 |
| POST | `/v1/convert` | PDF 변환 | API 키 |
| GET | `/v1/jobs/:id` | 작업 상태 | API 키 |
| POST | `/v1/keys` | API 키 발급(관리자) | 관리자 토큰 |

### GET /health

```json
{
  "status": "ok",
  "version": "0.1.0",
  "time": "2026-11-21T15:20:54.162Z",
  "services": { "store": "supabase", "ai": "anthropic", "model": "claude-sonnet-4-5" }
}
```

### POST /v1/convert

세 가지 입력 방식을 지원합니다.

**1) 파일 업로드 (multipart/form-data)**

| 필드 | 필수 | 설명 |
| --- | --- | --- |
| `file` | ✔ | PDF 파일 (최대 15MB) |
| `mode` | | `structured`(기본) / `text` |
| `schema` | | `generic`(기본) / `invoice` / `receipt` / `resume` / `contract` |
| `language` | | 문서 언어 힌트 (`ko`, `en`, …) |
| `instructions` | | 추가 추출 지시 (최대 2,000자) |

```bash
curl -X POST http://localhost:8787/v1/convert \
  -H "Authorization: Bearer $TAE_API_KEY" \
  -F "file=@invoice.pdf" \
  -F "schema=invoice"
```

**2) URL (application/json)**

```bash
curl -X POST http://localhost:8787/v1/convert \
  -H "Authorization: Bearer $TAE_API_KEY" \
  -H "content-type: application/json" \
  -d '{"url":"https://example.com/invoice.pdf","schema":"invoice"}'
```

사설망·루프백 주소는 400으로 차단합니다(SSRF 완화).

**3) base64 또는 raw 바디**

```bash
curl -X POST http://localhost:8787/v1/convert \
  -H "Authorization: Bearer $TAE_API_KEY" \
  -H "content-type: application/pdf" \
  --data-binary @invoice.pdf
```

#### 응답 (200)

```json
{
  "jobId": "622fc36d-66b3-4799-923b-07c96dcccbce",
  "status": "succeeded",
  "document": {
    "pageCount": 3,
    "characters": 414,
    "mode": "structured",
    "schema": "invoice",
    "title": null,
    "author": null
  },
  "data": {
    "invoiceNumber": "INV-2026-0042",
    "issueDate": "2026-03-14",
    "currency": "USD",
    "lineItems": [{ "description": "Design retainer", "quantity": "1", "amount": "1,200.00" }],
    "subtotal": "1,239.00",
    "tax": "123.90",
    "total": "1,362.90"
  },
  "usage": {
    "creditsCharged": 1,
    "creditsRemaining": 4,
    "inputTokens": 1200,
    "outputTokens": 320,
    "costUsd": 0.0084
  },
  "meta": { "provider": "anthropic", "model": "claude-sonnet-4-5", "durationMs": 3021 }
}
```

- `mode: "text"`이면 `data`가 `{ "pages": [{ "page": 1, "text": "…" }] }`입니다(결정적 추출, AI 미사용).
- 헤더: `X-Credits-Charged`, `X-Credits-Remaining`, `X-Request-Id`.

#### 스키마

| schema | 주요 필드 |
| --- | --- |
| `generic` | title, documentType, language, summary, sections[], keyValues[], entities{people,organizations,dates,amounts}, tables[], actionItems[] |
| `invoice` | invoiceNumber, issueDate, dueDate, currency, vendor{}, customer{}, lineItems[], subtotal, discount, tax, total, amountDue, paymentTerms, bankAccount |
| `receipt` | merchant, receiptNumber, purchasedAt, currency, items[], subtotal, tax, total, paymentMethod |
| `resume` | name, headline, email, phone, location, summary, skills[], experience[], education[] |
| `contract` | title, parties[], effectiveDate, term, summary, obligations[], termination, governingLaw, signatures[] |

모든 필드는 "없으면 빈 문자열/빈 배열"로 반환되어 클라이언트에서 분기 없이 다룰 수 있습니다.
Claude 응답이 스키마를 벗어나면 한 번 교정 요청을 하고, 그래도 실패하면 `ai_failed`(502)를 반환합니다.

### GET /v1/jobs/:id

```json
{
  "job": {
    "id": "…",
    "status": "succeeded",
    "creditsCharged": 1,
    "output": { "schema": "invoice", "pageCount": 3 },
    "errorCode": null
  }
}
```

### POST /v1/keys (관리자)

```bash
curl -X POST https://api.taest.info/v1/keys \
  -H "Authorization: Bearer $PDF_API_ADMIN_TOKEN" \
  -H "content-type: application/json" \
  -d '{"email":"user@example.com","name":"production","credits":100}'
```

```json
{
  "key": "tae_live_...",
  "apiKey": { "id": "…", "name": "production", "prefix": "tae_live_abc123…" },
  "user": { "id": "…", "email": "user@example.com" },
  "credits": { "balance": 100 }
}
```

`key`는 이 응답에서만 확인할 수 있습니다.

## 크레딧

- 10페이지당 1크레딧, 최소 1크레딧(3페이지 = 1, 11페이지 = 2).
- 변환 전에 차감하고, 실패하면 자동 환불합니다.
- 잔액 부족 시 402와 `requiredCredits`, `balance`를 반환합니다.

## 오류 코드

| 코드 | HTTP | 설명 |
| --- | --- | --- |
| `unauthorized` | 401 | 키 없음/형식 오류/폐기됨 |
| `forbidden` | 403 | 관리자 토큰 미설정 |
| `invalid_request` | 400 | 본문·옵션 오류, 사설망 URL |
| `payload_too_large` | 413 | 15MB 초과 |
| `unsupported_media_type` | 415 | PDF 아님 |
| `pdf_parse_failed` | 422 | 손상/암호/스캔 이미지, 텍스트 없음 |
| `insufficient_credits` | 402 | 크레딧 부족 |
| `rate_limited` | 429 | 기본 30회/분(키 기준) |
| `ai_failed` | 502 | Claude 응답 실패/시간 초과 |
| `not_found` | 404 | 없는 엔드포인트·작업 |
| `internal_error` | 500 | 서버 오류 |

## 제한

- 최대 15MB, 최대 200페이지 (환경변수로 조정 가능).
- 스캔 이미지 PDF는 OCR이 없어 `pdf_parse_failed`가 납니다. 텍스트 레이어가 있는 PDF를 사용하세요.
- Vercel 배포 시 요청 본문 4.5MB 제한이 있으므로 큰 파일은 `url` 입력을 사용하세요.
