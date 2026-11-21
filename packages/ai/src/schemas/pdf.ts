import { z } from "zod";

/**
 * PDF 구조화 결과의 스키마 모음.
 * 추출기는 완벽하지 않으므로 대부분의 필드에 기본값을 두고,
 * "없으면 빈 문자열/빈 배열"로 일관되게 반환합니다.
 */

const text = () => z.string().max(2000).default("");
const textList = (max = 20) => z.array(z.string().max(2000)).max(max).default([]);

const money = () => z.string().max(60).default("");

export const genericDocumentSchema = z.object({
  title: z.string().max(300).default(""),
  documentType: z.string().max(80).default("unknown"),
  language: z.string().max(20).default(""),
  summary: z.string().max(3000).default(""),
  sections: z
    .array(
      z.object({
        heading: z.string().max(300).default(""),
        summary: z.string().max(3000).default(""),
        bullets: textList(12),
      }),
    )
    .max(40)
    .default([]),
  keyValues: z
    .array(z.object({ label: z.string().max(200), value: text() }))
    .max(60)
    .default([]),
  entities: z
    .object({
      people: textList(30),
      organizations: textList(30),
      dates: textList(30),
      amounts: textList(30),
    })
    .default({ people: [], organizations: [], dates: [], amounts: [] }),
  tables: z
    .array(
      z.object({
        title: z.string().max(200).default(""),
        columns: textList(20),
        rows: z.array(z.array(z.string().max(500))).max(200).default([]),
      }),
    )
    .max(10)
    .default([]),
  actionItems: textList(20),
});

export const partySchema = z.object({
  name: z.string().max(300).default(""),
  address: z.string().max(600).default(""),
  email: z.string().max(200).default(""),
  taxId: z.string().max(80).default(""),
});

export const invoiceDocumentSchema = z.object({
  documentType: z.literal("invoice").default("invoice"),
  invoiceNumber: z.string().max(80).default(""),
  issueDate: z.string().max(40).default(""),
  dueDate: z.string().max(40).default(""),
  currency: z.string().max(10).default(""),
  vendor: partySchema.default({ name: "", address: "", email: "", taxId: "" }),
  customer: partySchema.default({ name: "", address: "", email: "", taxId: "" }),
  lineItems: z
    .array(
      z.object({
        description: z.string().max(500).default(""),
        quantity: money(),
        unitPrice: money(),
        amount: money(),
        taxRate: z.string().max(20).default(""),
      }),
    )
    .max(200)
    .default([]),
  subtotal: money(),
  discount: money(),
  tax: money(),
  total: money(),
  amountDue: money(),
  paymentTerms: z.string().max(500).default(""),
  bankAccount: z.string().max(300).default(""),
  notes: z.string().max(2000).default(""),
});

export const receiptDocumentSchema = z.object({
  documentType: z.literal("receipt").default("receipt"),
  merchant: z.string().max(300).default(""),
  receiptNumber: z.string().max(80).default(""),
  purchasedAt: z.string().max(60).default(""),
  currency: z.string().max(10).default(""),
  items: z
    .array(
      z.object({
        name: z.string().max(300).default(""),
        quantity: money(),
        amount: money(),
      }),
    )
    .max(200)
    .default([]),
  subtotal: money(),
  tax: money(),
  total: money(),
  paymentMethod: z.string().max(80).default(""),
});

export const resumeDocumentSchema = z.object({
  documentType: z.literal("resume").default("resume"),
  name: z.string().max(200).default(""),
  headline: z.string().max(300).default(""),
  email: z.string().max(200).default(""),
  phone: z.string().max(60).default(""),
  location: z.string().max(200).default(""),
  links: textList(10),
  summary: z.string().max(3000).default(""),
  skills: textList(40),
  experience: z
    .array(
      z.object({
        company: z.string().max(200).default(""),
        role: z.string().max(200).default(""),
        period: z.string().max(120).default(""),
        highlights: textList(10),
      }),
    )
    .max(30)
    .default([]),
  education: z
    .array(
      z.object({
        school: z.string().max(200).default(""),
        degree: z.string().max(200).default(""),
        period: z.string().max(120).default(""),
      }),
    )
    .max(20)
    .default([]),
});

export const contractDocumentSchema = z.object({
  documentType: z.literal("contract").default("contract"),
  title: z.string().max(300).default(""),
  parties: z
    .array(z.object({ name: z.string().max(300).default(""), role: z.string().max(120).default("") }))
    .max(10)
    .default([]),
  effectiveDate: z.string().max(60).default(""),
  term: z.string().max(300).default(""),
  summary: z.string().max(3000).default(""),
  obligations: z
    .array(z.object({ party: z.string().max(200).default(""), description: z.string().max(1000).default("") }))
    .max(60)
    .default([]),
  termination: z.string().max(1000).default(""),
  governingLaw: z.string().max(200).default(""),
  signatures: z
    .array(
      z.object({
        party: z.string().max(200).default(""),
        name: z.string().max(200).default(""),
        date: z.string().max(60).default(""),
      }),
    )
    .max(10)
    .default([]),
});

export const pdfStructureSchemas = {
  generic: genericDocumentSchema,
  invoice: invoiceDocumentSchema,
  receipt: receiptDocumentSchema,
  resume: resumeDocumentSchema,
  contract: contractDocumentSchema,
} as const;

export type PdfStructureSchemaId = keyof typeof pdfStructureSchemas;

export type PdfStructureData = {
  generic: z.infer<typeof genericDocumentSchema>;
  invoice: z.infer<typeof invoiceDocumentSchema>;
  receipt: z.infer<typeof receiptDocumentSchema>;
  resume: z.infer<typeof resumeDocumentSchema>;
  contract: z.infer<typeof contractDocumentSchema>;
};

export const pdfStructureSchemaIds = Object.keys(pdfStructureSchemas) as PdfStructureSchemaId[];

export function isPdfStructureSchemaId(value: string): value is PdfStructureSchemaId {
  return value in pdfStructureSchemas;
}
