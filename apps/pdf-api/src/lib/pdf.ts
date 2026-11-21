import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

import { ApiError } from "./errors";

export interface ExtractedPage {
  page: number;
  text: string;
}

export interface ExtractedPdf {
  pageCount: number;
  pages: ExtractedPage[];
  characterCount: number;
  title: string | null;
  author: string | null;
}

export interface ExtractOptions {
  maxPages?: number;
  /** 번들 배포 시 워커 파일 위치를 지정합니다. */
  workerPath?: string | null;
}

let workerConfigured = false;

function configureWorker(workerPath?: string | null): void {
  if (workerConfigured || !workerPath) return;
  pdfjs.GlobalWorkerOptions.workerSrc = workerPath;
  workerConfigured = true;
}

/**
 * pdf.js로 페이지별 텍스트를 추출합니다.
 * 렌더링 없이 텍스트만 필요하므로 워커는 pdf.js 기본 해석 경로를 사용합니다.
 */
export async function extractPdf(data: Uint8Array, options: ExtractOptions = {}): Promise<ExtractedPdf> {
  configureWorker(options.workerPath);

  let document: Awaited<ReturnType<typeof pdfjs.getDocument>["promise"]> | null = null;
  try {
    document = await pdfjs.getDocument({
      data,
      isEvalSupported: false,
      useSystemFonts: false,
      verbosity: 0,
    }).promise;

    const maxPages = options.maxPages ?? 200;
    if (document.numPages > maxPages) {
      throw new ApiError(
        "invalid_request",
        `PDF 페이지 수(${document.numPages})가 한도(${maxPages})를 넘습니다.`,
        422,
        { maxPages, pageCount: document.numPages },
      );
    }

    const pages: ExtractedPage[] = [];
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      let text = "";

      for (const item of content.items) {
        if (!("str" in item)) continue;
        text += item.str;
        text += item.hasEOL ? "\n" : " ";
      }

      pages.push({ page: pageNumber, text: cleanPageText(text) });
      page.cleanup();
    }

    const metadata = await document.getMetadata().catch(() => null);
    const info = metadata?.info as { Title?: string; Author?: string } | undefined;

    return {
      pageCount: document.numPages,
      pages,
      characterCount: pages.reduce((total, page) => total + page.text.length, 0),
      title: info?.Title?.trim() || null,
      author: info?.Author?.trim() || null,
    };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    if (isPasswordError(error)) {
      throw new ApiError("pdf_parse_failed", "암호가 걸린 PDF는 처리할 수 없습니다.", 422);
    }
    throw new ApiError(
      "pdf_parse_failed",
      "PDF를 읽지 못했습니다. 손상되었거나 스캔 이미지로만 이루어진 파일일 수 있습니다.",
      422,
      { reason: error instanceof Error ? error.message : String(error) },
    );
  } finally {
    await document?.destroy().catch(() => undefined);
  }
}

function isPasswordError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "name" in error && (error as { name?: string }).name === "PasswordException";
}

/** 페이지 텍스트의 과도한 공백을 정리합니다. 줄바꿈은 문단 구조로 남깁니다. */
export function cleanPageText(text: string): string {
  return text
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 10페이지당 1크레딧(최소 1). */
export function creditsForPages(pageCount: number): number {
  return Math.max(1, Math.ceil(pageCount / 10));
}
