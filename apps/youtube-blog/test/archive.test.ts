import { describe, expect, it } from "vitest";

import { buildDemoContent, type ContentDraft } from "@tae/ai";
import { buildDemoStoryboard } from "@tae/video";

import type { ConvertRequestPayload, ConvertResult } from "../src/lib/api-types";
import {
  ARCHIVE_KEY,
  addArchiveItem,
  archiveItemFrom,
  readArchive,
  removeArchiveItem,
  writeArchive,
  type ArchiveStorage,
} from "../src/lib/archive";
import { mergeResults } from "../src/lib/results";

const source = {
  sourceType: "blog" as const,
  title: "콘텐츠를 세 번 쓰는 법",
  author: "운영 노트",
  language: "ko" as const,
  text: "콘텐츠를 만드는 사람들이 가장 자주 하는 실수는 채널마다 처음부터 새로 쓰는 것입니다. 원문을 하나 만들고 형식만 바꾸면 같은 노력으로 네 채널을 채울 수 있습니다.",
};

const request: ConvertRequestPayload = { sourceType: "blog", text: source.text, language: "ko", format: "blog" };

function resultOf(format: "blog" | "instagram" | "facebook", jobId = "job-1", textChars = source.text.length): ConvertResult {
  const draft = buildDemoContent({ source, target: { language: "ko", format } }) as ContentDraft;
  return {
    jobId,
    format,
    drafts: { [format]: draft },
    draft,
    video: null,
    source: {
      sourceType: "blog",
      title: source.title,
      author: source.author,
      url: null,
      thumbnailUrl: null,
      textChars,
      textSource: "pasted",
      warnings: [],
    },
    credits: { remaining: 7, charged: 1 },
    meta: {
      provider: "demo",
      model: "demo-heuristic",
      mode: "demo",
      inputTokens: 0,
      outputTokens: 0,
      costUsd: 0,
      durationMs: 900,
      textChars,
    },
  };
}

class FakeStorage implements ArchiveStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("보관함(로컬 저장)", () => {
  it("결과를 저장하고 다시 읽는다", () => {
    const storage = new FakeStorage();
    const item = archiveItemFrom(resultOf("blog"), request, new Date("2026-11-22T12:00:00Z"));
    writeArchive(storage, addArchiveItem([], item));

    const restored = readArchive(storage);
    expect(restored).toHaveLength(1);
    expect(restored[0]?.title).toBe(source.title);
    expect(restored[0]?.formats).toEqual(["blog"]);
    expect(restored[0]?.request.format).toBe("blog");
  });

  it("같은 원문으로 다시 만들면 카드가 늘지 않고 최신 결과로 바뀐다", () => {
    const first = archiveItemFrom(resultOf("blog", "job-1"), request, new Date("2026-11-22T12:00:00Z"));
    const second = archiveItemFrom(resultOf("instagram", "job-2"), request, new Date("2026-11-22T12:10:00Z"));

    const items = addArchiveItem(addArchiveItem([], first), second);
    expect(items).toHaveLength(1);
    expect(items[0]?.jobId).toBe("job-2");
  });

  it("삭제와 빈 저장소 처리에 안전하다", () => {
    const storage = new FakeStorage();
    const item = archiveItemFrom(resultOf("facebook"), request);
    const items = addArchiveItem([], item);

    expect(removeArchiveItem(items, item.id)).toEqual([]);
    expect(readArchive(null)).toEqual([]);
    expect(readArchive(new FakeStorage())).toEqual([]);
  });

  it("깨진 저장값은 빈 목록으로 돌려준다", () => {
    const storage = new FakeStorage();
    storage.setItem(ARCHIVE_KEY, "{not json");
    expect(readArchive(storage)).toEqual([]);
  });
});

describe("결과 합치기", () => {
  it("같은 원문으로 만든 글 3종을 한 결과로 묶는다", () => {
    const merged = mergeResults(
      resultOf("blog", "job-1"),
      { ...resultOf("instagram", "job-2"), drafts: { instagram: buildDemoContent({ source, target: { language: "ko", format: "instagram" } }) as ContentDraft, blog: buildDemoContent({ source, target: { language: "ko", format: "blog" } }) as ContentDraft } },
    );

    expect(merged.jobId).toBe("job-2");
    expect(Object.keys(merged.drafts ?? {}).sort()).toEqual(["blog", "instagram"]);
    expect(merged.formats).toEqual(["blog", "instagram"]);
  });

  it("영상 결과와 글 결과를 함께 보관한다", () => {
    const textResult = resultOf("blog");
    const videoResult: ConvertResult = {
      ...resultOf("blog", "job-3"),
      format: "youtube_video",
      draft: null,
      drafts: {},
      video: {
        aspectRatio: "9:16",
        preset: {
          id: "9:16",
          label: "9:16 쇼츠",
          width: 1080,
          height: 1920,
          sceneMin: 5,
          sceneMax: 8,
          durationMin: 45,
          durationMax: 60,
          totalSeconds: 48,
        },
        storyboard: buildDemoStoryboard(
          { sourceType: "blog", title: source.title, author: source.author, language: "ko", text: source.text },
          { aspectRatio: "9:16", language: "ko" },
        ),
        subtitles: { srt: "", ass: "", cueCount: 0, source: "aligned" },
        render: { available: true, mode: "worker", reason: null },
      },
      credits: { remaining: 1, charged: 3 },
    };

    const merged = mergeResults(textResult, videoResult);
    expect(merged.video).not.toBeNull();
    expect(merged.drafts?.blog).toBeTruthy();
  });
});
