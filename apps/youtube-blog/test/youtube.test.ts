import { describe, expect, it } from "vitest";

import {
  buildTranscriptText,
  extractPlayerResponse,
  fetchTranscript,
  fetchVideoMeta,
  parseCaptionTracks,
  parseTimedTextJson,
  parseVideoId,
  pickCaptionTrack,
  VideoError,
} from "../src/lib/youtube";

const VIDEO_ID = "dQw4w9WgXcQ";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

const playerWithCaptions = {
  videoDetails: {
    videoId: VIDEO_ID,
    title: "스타트업 첫 100일",
    lengthSeconds: "754",
    author: "창업 채널",
    shortDescription: "첫 100일에 집중해야 하는 이유",
  },
  captions: {
    playerCaptionsTracklistRenderer: {
      captionTracks: [
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=ko",
          languageCode: "ko",
          kind: "asr",
          name: { simpleText: "한국어 (자동 생성)" },
        },
        {
          baseUrl: "https://www.youtube.com/api/timedtext?v=dQw4w9WgXcQ&lang=ko&kind=manual",
          languageCode: "ko",
          name: { runs: [{ text: "한국어" }] },
        },
      ],
    },
  },
};

const timedTextJson = {
  events: [
    { tStartMs: 0, dDurationMs: 2000, segs: [{ utf8: "첫 100일은" }, { utf8: " 고객을 보는 시간입니다." }] },
    { tStartMs: 2000, dDurationMs: 2000, segs: [{ utf8: "매주 5명의 고객과 이야기하세요." }] },
    { tStartMs: 4000, dDurationMs: 1000, segs: [{ utf8: "\n" }] },
  ],
};

describe("parseVideoId", () => {
  it("accepts every common YouTube URL shape", () => {
    expect(parseVideoId(`https://www.youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseVideoId(`https://youtu.be/${VIDEO_ID}?t=42`)).toBe(VIDEO_ID);
    expect(parseVideoId(`https://www.youtube.com/shorts/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseVideoId(`https://m.youtube.com/watch?v=${VIDEO_ID}&feature=share`)).toBe(VIDEO_ID);
    expect(parseVideoId(`https://www.youtube.com/embed/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseVideoId(`https://www.youtube.com/live/${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseVideoId(`youtube.com/watch?v=${VIDEO_ID}`)).toBe(VIDEO_ID);
    expect(parseVideoId(VIDEO_ID)).toBe(VIDEO_ID);
  });

  it("rejects non-YouTube input", () => {
    expect(parseVideoId("")).toBeNull();
    expect(parseVideoId("not a url")).toBeNull();
    expect(parseVideoId("https://vimeo.com/123456")).toBeNull();
    expect(parseVideoId("https://www.youtube.com/watch?v=tooShort")).toBeNull();
  });
});

describe("player response parsing", () => {
  it("extracts JSON even when strings contain braces", () => {
    const html = `var ytInitialPlayerResponse = {"a":{"b":"}{"},"c":1};var x=2;`;
    expect(extractPlayerResponse(html)).toEqual({ a: { b: "}{" }, c: 1 });
  });

  it("returns null when the response is missing", () => {
    expect(extractPlayerResponse("<html></html>")).toBeNull();
  });

  it("maps caption tracks and prefers manual Korean", () => {
    const tracks = parseCaptionTracks(playerWithCaptions);
    expect(tracks).toHaveLength(2);
    expect(tracks[0]).toMatchObject({ languageCode: "ko", kind: "asr" });
    expect(pickCaptionTrack(tracks)).toMatchObject({ kind: "manual", languageCode: "ko" });
    expect(pickCaptionTrack([])).toBeNull();
  });
});

describe("transcript parsing", () => {
  it("builds text and timed segments", () => {
    const parsed = parseTimedTextJson(timedTextJson);
    expect(parsed.segments).toHaveLength(2);
    expect(parsed.text).toBe("첫 100일은 고객을 보는 시간입니다. 매주 5명의 고객과 이야기하세요.");
  });

  it("ignores empty events and duplicates", () => {
    expect(buildTranscriptText(["안녕", "안녕", " ", "하세요"])).toBe("안녕 하세요");
  });

  it("handles unexpected payloads", () => {
    expect(parseTimedTextJson(null).text).toBe("");
    expect(parseTimedTextJson({ events: "nope" }).text).toBe("");
  });
});

describe("fetchVideoMeta", () => {
  it("merges oEmbed and player details", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("oembed")) {
        return json({ title: "oEmbed 제목", author_name: "채널", author_url: "https://youtube.com/@c", thumbnail_url: "https://img/1.jpg" });
      }
      if (url.includes("youtubei")) return json(playerWithCaptions);
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const video = await fetchVideoMeta(VIDEO_ID, fetchImpl);
    expect(video.title).toBe("스타트업 첫 100일");
    expect(video.channelTitle).toBe("창업 채널");
    expect(video.durationSeconds).toBe(754);
    expect(video.url).toContain(VIDEO_ID);
  });

  it("throws video_unavailable when both sources fail", async () => {
    const fetchImpl = (async () => new Response("nope", { status: 404 })) as typeof fetch;
    await expect(fetchVideoMeta(VIDEO_ID, fetchImpl)).rejects.toMatchObject({ code: "video_unavailable" });
  });
});

describe("fetchTranscript", () => {
  it("downloads and parses the caption track", async () => {
    const calls: string[] = [];
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      calls.push(url);
      if (url.includes("youtubei")) return json(playerWithCaptions);
      if (url.includes("timedtext")) return json(timedTextJson);
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const transcript = await fetchTranscript(VIDEO_ID, fetchImpl);
    expect(transcript.text).toContain("고객을 보는 시간");
    expect(transcript.language).toBe("ko");
    expect(transcript.isAutoGenerated).toBe(false);
    expect(calls.some((url) => url.includes("timedtext"))).toBe(true);
  });

  it("falls back to the watch page when the player API is blocked", async () => {
    const playerJson = JSON.stringify(playerWithCaptions);
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtubei")) return new Response("blocked", { status: 403 });
      if (url.includes("watch?v=")) {
        return new Response(`<script>var ytInitialPlayerResponse = ${playerJson};</script>`, {
          status: 200,
          headers: { "content-type": "text/html" },
        });
      }
      if (url.includes("timedtext")) return json(timedTextJson);
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

    const transcript = await fetchTranscript(VIDEO_ID, fetchImpl);
    expect(transcript.text).toContain("매주 5명");
  });

  it("throws transcript_unavailable when nothing works", async () => {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("youtubei")) return json({ playabilityStatus: { status: "OK" } });
      if (url.includes("watch?v=")) return new Response("<html></html>", { status: 200 });
      return new Response("", { status: 200 });
    }) as typeof fetch;

    await expect(fetchTranscript(VIDEO_ID, fetchImpl)).rejects.toBeInstanceOf(VideoError);
    await expect(fetchTranscript(VIDEO_ID, fetchImpl)).rejects.toMatchObject({ code: "transcript_unavailable" });
  });
});
