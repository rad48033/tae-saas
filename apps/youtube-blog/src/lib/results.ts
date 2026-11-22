import type { ConvertResult, TextFormat } from "./api-types";
import { TEXT_FORMATS, draftFormats } from "./api-types";

type AnyDraft = NonNullable<ConvertResult["draft"]>;

/**
 * 같은 원문으로 만든 결과를 하나의 "프로젝트"로 합칩니다.
 * 영상을 만들고 나서 블로그를 추가로 만들면, 결과 뷰어에서 네 탭이 모두 채워집니다.
 */
export function mergeResults(previous: ConvertResult | null, next: ConvertResult): ConvertResult {
  if (!previous) return next;

  const drafts: Partial<Record<TextFormat, AnyDraft>> = { ...(previous.drafts ?? {}) };
  for (const format of TEXT_FORMATS) {
    const previousDraft = previous.drafts?.[format] ?? (previous.draft?.format === format ? previous.draft : null);
    if (previousDraft) drafts[format] = previousDraft;
  }
  if (next.draft) drafts[next.draft.format] = next.draft;
  for (const format of TEXT_FORMATS) {
    const nextDraft = next.drafts?.[format];
    if (nextDraft) drafts[format] = nextDraft;
  }

  const formats = Array.from(
    new Set([
      ...(previous.formats ?? []),
      ...(next.formats ?? []),
      ...Object.keys(drafts),
      ...(next.video || previous.video ? ["youtube_video"] : []),
    ]),
  ) as ConvertResult["formats"];
  const activeDraft =
    (next.format !== "youtube_video" ? drafts[next.format as TextFormat] : null) ??
    next.draft ??
    previous.draft ??
    null;

  return {
    ...next,
    format: next.format,
    formats,
    drafts,
    draft: activeDraft,
    video: next.video ?? previous.video,
  };
}

/** 결과에 실제로 들어 있는 산출물 목록 */
export function availableFormats(result: ConvertResult | null): string[] {
  if (!result) return [];
  const formats = new Set<string>(draftFormats(result));
  if (result.video) formats.add("youtube_video");
  return [...formats];
}
