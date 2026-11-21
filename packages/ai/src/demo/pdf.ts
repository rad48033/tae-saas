import type { PdfStructureInput } from "../prompts/pdf";
import type { PdfStructureSchemaId } from "../schemas/pdf";

/**
 * 결정적(휴리스틱) PDF 구조화. API 키가 없을 때 데모용으로만 사용합니다.
 * 실제 서비스 품질은 Claude 경로가 담당하며, 이 결과는 항상 provider: "demo"로 표시됩니다.
 */
export function buildDemoPdfStructure(input: PdfStructureInput): unknown {
  const text = input.pages.map((page) => page.text).join("\n");
  const dates = unique(text.match(/\b\d{4}[-./]\d{1,2}[-./]\d{1,2}\b/g) ?? []).slice(0, 10);
  const amounts = unique(text.match(/(?:₩|\$|USD|KRW)?\s?\d{1,3}(?:,\d{3})+(?:\.\d+)?/g) ?? []).slice(0, 20);
  const firstLines = input.pages
    .flatMap((page) => page.text.split("\n").map((line) => line.trim()).filter(Boolean))
    .slice(0, 12);

  switch (input.schema) {
    case "invoice":
    case "receipt":
      return buildDemoInvoice(text, dates, amounts, input.schema);
    case "contract":
      return {
        documentType: "contract",
        title: firstLines[0] ?? input.sourceName ?? "",
        parties: [],
        effectiveDate: dates[0] ?? "",
        term: "",
        summary: firstLines.slice(1, 4).join(" "),
        obligations: [],
        termination: "",
        governingLaw: "",
        signatures: [],
      };
    case "resume":
      return {
        documentType: "resume",
        name: firstLines[0] ?? "",
        headline: firstLines[1] ?? "",
        email: text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "",
        phone: text.match(/(?:\+82[-\s]?)?0?\d{1,2}[-.\s]?\d{3,4}[-.\s]?\d{4}/)?.[0] ?? "",
        location: "",
        links: [],
        summary: firstLines.slice(2, 6).join(" "),
        skills: [],
        experience: [],
        education: [],
      };
    default:
      return buildDemoGeneric(input, firstLines, dates, amounts);
  }
}

function buildDemoGeneric(
  input: PdfStructureInput,
  firstLines: string[],
  dates: string[],
  amounts: string[],
): unknown {
  const sentences = input.pages
    .flatMap((page) => page.text.split(/(?<=[.!?。])\s+/))
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 20);

  return {
    title: firstLines[0] ?? input.sourceName ?? "",
    documentType: "unknown",
    language: /[가-힣]/.test(input.pages[0]?.text ?? "") ? "ko" : "en",
    summary: sentences.slice(0, 3).join(" "),
    sections: input.pages.map((page) => ({
      heading: `${page.page}페이지`,
      summary: firstSentence(page.text),
      bullets: page.text
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line.length > 0 && line.length <= 200)
        .slice(0, 6),
    })),
    keyValues: firstLines
      .map((line) => {
        const match = /^([^:]{1,40}):\s*(.+)$/.exec(line);
        return match ? { label: match[1]?.trim() ?? "", value: match[2]?.trim() ?? "" } : null;
      })
      .filter((entry): entry is { label: string; value: string } => entry !== null)
      .slice(0, 20),
    entities: { people: [], organizations: [], dates, amounts },
    tables: [],
    actionItems: [],
  };
}

function buildDemoInvoice(text: string, dates: string[], amounts: string[], schema: "invoice" | "receipt"): unknown {
  const totalMatch = /(?:total|합계|총액|청구\s*금액)[^\d]{0,20}([\d,.]+)/i.exec(text);
  const numberMatch = /(?:invoice|receipt|청구|영수증)[^\n]{0,30}?([A-Z0-9][A-Z0-9-]{3,})/i.exec(text);

  if (schema === "receipt") {
    return {
      documentType: "receipt",
      merchant: text.split("\n")[0] ?? "",
      receiptNumber: numberMatch?.[1] ?? "",
      purchasedAt: dates[0] ?? "",
      currency: detectCurrency(text),
      items: [],
      subtotal: "",
      tax: "",
      total: totalMatch?.[1] ?? amounts.at(-1) ?? "",
      paymentMethod: "",
    };
  }

  return {
    documentType: "invoice",
    invoiceNumber: numberMatch?.[1] ?? "",
    issueDate: dates[0] ?? "",
    dueDate: dates[1] ?? "",
    currency: detectCurrency(text),
    vendor: { name: "", address: "", email: text.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0] ?? "", taxId: "" },
    customer: { name: "", address: "", email: "", taxId: "" },
    lineItems: [],
    subtotal: "",
    discount: "",
    tax: "",
    total: totalMatch?.[1] ?? amounts.at(-1) ?? "",
    amountDue: totalMatch?.[1] ?? "",
    paymentTerms: "",
    bankAccount: "",
    notes: "데모 모드에서 규칙 기반으로 추출한 결과입니다.",
  };
}

function detectCurrency(text: string): string {
  if (/₩|KRW|원/.test(text)) return "KRW";
  if (/\$|USD/.test(text)) return "USD";
  if (/€|EUR/.test(text)) return "EUR";
  return "";
}

function firstSentence(text: string): string {
  const match = /^(.{0,300}?[.!?。])\s/.exec(text.trim());
  return match?.[1] ?? text.trim().slice(0, 200);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export type { PdfStructureSchemaId };
