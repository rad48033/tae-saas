import type { ConvertRequestPayload, ConvertResult, OutputFormat } from "./api-types";
import { draftFormats } from "./api-types";

/**
 * 보관함에 남는 결과. 서버 저장소가 아니라 이 기기(localStorage)에 남겨
 * 로그인 없이도 "방금 만든 것"을 다시 열고 복사·다운로드할 수 있게 합니다.
 */
export const ARCHIVE_KEY = "taest.archive.v1";
export const ARCHIVE_LIMIT = 30;

export interface ArchiveItem {
  id: string;
  /** 같은 원문으로 만든 결과를 한 카드로 묶는 키 */
  groupKey: string;
  jobId: string;
  savedAt: string;
  title: string;
  author: string;
  sourceType: string;
  url: string | null;
  formats: OutputFormat[];
  creditsCharged: number;
  request: ConvertRequestPayload;
  result: ConvertResult;
}

/** 테스트에서 브라우저 없이 쓰기 위한 최소 저장소 인터페이스 */
export interface ArchiveStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** 같은 원문·같은 결과를 묶는 키(보관함 카드 중복 방지) */
export function archiveGroupKey(result: ConvertResult): string {
  return result.source.url ?? `${result.source.sourceType}:${result.source.title}:${result.source.textChars}`;
}

export function archiveItemFrom(
  result: ConvertResult,
  request: ConvertRequestPayload,
  savedAt: Date = new Date(),
): ArchiveItem {
  const formats: OutputFormat[] = result.video ? ["youtube_video"] : [];
  formats.push(...draftFormats(result));
  const groupKey = archiveGroupKey(result);

  return {
    id: `${hashKey(groupKey)}-${savedAt.getTime()}`,
    groupKey,
    jobId: result.jobId,
    savedAt: savedAt.toISOString(),
    title: result.source.title,
    author: result.source.author,
    sourceType: result.source.sourceType,
    url: result.source.url,
    formats,
    creditsCharged: result.credits.charged,
    request,
    result,
  };
}

/** 같은 작업(jobId)이나 같은 원문(groupKey)은 최신 항목 하나만 남깁니다. */
export function addArchiveItem(items: ArchiveItem[], item: ArchiveItem, limit = ARCHIVE_LIMIT): ArchiveItem[] {
  const merged = [
    item,
    ...items.filter((existing) => existing.jobId !== item.jobId && existing.groupKey !== item.groupKey),
  ];
  return merged.slice(0, Math.max(1, limit));
}

function hashKey(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36);
}

export function removeArchiveItem(items: ArchiveItem[], id: string): ArchiveItem[] {
  return items.filter((item) => item.id !== id);
}

export function readArchive(storage: ArchiveStorage | null | undefined): ArchiveItem[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(ARCHIVE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isArchiveItem).slice(0, ARCHIVE_LIMIT);
  } catch {
    return [];
  }
}

export function writeArchive(storage: ArchiveStorage | null | undefined, items: ArchiveItem[]): void {
  if (!storage) return;
  try {
    storage.setItem(ARCHIVE_KEY, JSON.stringify(items.slice(0, ARCHIVE_LIMIT)));
  } catch {
    // 저장 공간이 가득 찼을 때는 조용히 넘어갑니다(결과 자체는 화면에 남아 있습니다).
  }
}

function isArchiveItem(value: unknown): value is ArchiveItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ArchiveItem>;
  return (
    typeof item.id === "string" &&
    typeof item.jobId === "string" &&
    typeof item.savedAt === "string" &&
    typeof item.title === "string" &&
    Array.isArray(item.formats) &&
    Boolean(item.result) &&
    typeof item.result === "object"
  );
}

/** 브라우저 저장소(없으면 null). */
export function browserArchiveStorage(): ArchiveStorage | null {
  if (typeof window === "undefined") return null;
  try {
    const probe = "__taest_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return window.localStorage;
  } catch {
    return null;
  }
}
