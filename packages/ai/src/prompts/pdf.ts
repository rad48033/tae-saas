import type { PdfStructureSchemaId } from "../schemas/pdf";
import { truncateForPrompt } from "../text";

export interface PdfPage {
  page: number;
  text: string;
}

export interface PdfStructureInput {
  pages: PdfPage[];
  schema: PdfStructureSchemaId;
  language?: string;
  instructions?: string;
  sourceName?: string;
}

export interface PdfPrompt {
  system: string;
  prompt: string;
  maxTokens: number;
}

export const MAX_PDF_CHARS = 120_000;

const SCHEMA_GUIDES: Record<PdfStructureSchemaId, string> = {
  generic: `일반 문서 요약·구조화:
{
  "title": "문서 제목", "documentType": "invoice|contract|report|resume|...", "language": "ko|en|...",
  "summary": "3~5문장 요약",
  "sections": [{"heading": "소제목", "summary": "문단 요약", "bullets": ["핵심 항목"]}],
  "keyValues": [{"label": "항목명", "value": "값"}],
  "entities": {"people": [], "organizations": [], "dates": [], "amounts": []},
  "tables": [{"title": "표 제목", "columns": ["열"], "rows": [["셀"]]}],
  "actionItems": ["해야 할 일"]
}`,
  invoice: `인보이스(청구서) 추출:
{
  "documentType": "invoice", "invoiceNumber": "", "issueDate": "", "dueDate": "", "currency": "KRW|USD|...",
  "vendor": {"name": "", "address": "", "email": "", "taxId": ""},
  "customer": {"name": "", "address": "", "email": "", "taxId": ""},
  "lineItems": [{"description": "", "quantity": "", "unitPrice": "", "amount": "", "taxRate": ""}],
  "subtotal": "", "discount": "", "tax": "", "total": "", "amountDue": "",
  "paymentTerms": "", "bankAccount": "", "notes": ""
}`,
  receipt: `영수증 추출:
{
  "documentType": "receipt", "merchant": "", "receiptNumber": "", "purchasedAt": "", "currency": "",
  "items": [{"name": "", "quantity": "", "amount": ""}],
  "subtotal": "", "tax": "", "total": "", "paymentMethod": ""
}`,
  resume: `이력서 추출:
{
  "documentType": "resume", "name": "", "headline": "", "email": "", "phone": "", "location": "", "links": [],
  "summary": "", "skills": [],
  "experience": [{"company": "", "role": "", "period": "", "highlights": []}],
  "education": [{"school": "", "degree": "", "period": ""}]
}`,
  contract: `계약서 추출:
{
  "documentType": "contract", "title": "", "parties": [{"name": "", "role": ""}],
  "effectiveDate": "", "term": "", "summary": "",
  "obligations": [{"party": "", "description": ""}],
  "termination": "", "governingLaw": "",
  "signatures": [{"party": "", "name": "", "date": ""}]
}`,
};

export function buildPdfPrompt(input: PdfStructureInput): PdfPrompt {
  const combined = input.pages.map((page) => `[${page.page}페이지]\n${page.text}`).join("\n\n");
  const { text, truncated } = truncateForPrompt(combined, MAX_PDF_CHARS);

  const system = [
    "당신은 문서 추출 엔진입니다. PDF에서 뽑아낸 텍스트를 읽고 요청된 JSON 스키마로만 답합니다.",
    "",
    "규칙:",
    "1. 문서에 적힌 값만 사용합니다. 없는 값은 빈 문자열(\"\") 또는 빈 배열([])로 둡니다. 추측해서 채우지 않습니다.",
    "2. 금액·수량·날짜는 문서에 인쇄된 표기를 그대로 문자열로 옮깁니다(예: \"1,239.00\", \"2026-03-14\").",
    "3. 페이지 순서를 유지하고, 표는 columns/rows 구조로 옮깁니다.",
    "4. 언어는 문서 언어를 따릅니다. 요약(summary)은 문서 언어가 한국어면 한국어, 아니면 영어로 씁니다.",
    "5. 결과는 설명이나 코드펜스 없이 JSON 객체 하나만 출력합니다.",
    "",
    `요청 스키마(${input.schema}):`,
    SCHEMA_GUIDES[input.schema],
  ].join("\n");

  const prompt = [
    input.sourceName ? `문서: ${input.sourceName}` : "문서: (파일명 없음)",
    input.language ? `문서 언어 힌트: ${input.language}` : "",
    input.instructions ? `추가 지시: ${input.instructions}` : "",
    `총 ${input.pages.length}페이지${truncated ? " (텍스트가 길어 일부 생략됨)" : ""}`,
    "",
    "[PDF 텍스트]",
    '"""',
    text,
    '"""',
    "",
    `위 내용을 ${input.schema} 스키마의 JSON으로 추출하세요.`,
  ]
    .filter((line) => line !== "")
    .join("\n");

  return { system, prompt, maxTokens: 4096 };
}
