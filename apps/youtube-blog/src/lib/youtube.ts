import type { Transcript } from "@tae/ai";

export type VideoErrorCode = "invalid_url" | "video_unavailable" | "transcript_unavailable" | "fetch_failed";

/** 실패 원인(화면 안내·다음 행동을 고르는 데 씁니다). */
export type VideoErrorReason =
  | "bot_check"
  | "age_restricted"
  | "private"
  | "deleted"
  | "no_captions"
  | "captions_blocked"
  | "network";

export class VideoError extends Error {
  constructor(
    readonly code: VideoErrorCode,
    message: string,
    readonly reason?: VideoErrorReason,
  ) {
    super(message);
    this.name = "VideoError";
  }
}

export interface YouTubeVideo {
  id: string;
  url: string;
  title: string;
  channelTitle: string;
  channelUrl?: string;
  description?: string;
  durationSeconds?: number;
  thumbnailUrl?: string;
}

export interface CaptionTrack {
  baseUrl: string;
  languageCode: string;
  label: string;
  kind: "asr" | "manual";
}

const VIDEO_ID_PATTERN = /^[A-Za-z0-9_-]{11}$/;
const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 15_000;

type Fetcher = typeof fetch;

interface OEmbedResponse {
  title?: string;
  author_name?: string;
  author_url?: string;
  thumbnail_url?: string;
}

interface PlayerResponse {
  playabilityStatus?: { status?: string; reason?: string };
  videoDetails?: {
    videoId?: string;
    title?: string;
    lengthSeconds?: string;
    author?: string;
    shortDescription?: string;
    thumbnail?: { thumbnails?: { url?: string }[] };
  };
  captions?: {
    playerCaptionsTracklistRenderer?: {
      captionTracks?: {
        baseUrl?: string;
        languageCode?: string;
        kind?: string;
        isTranslatable?: boolean;
        name?: { simpleText?: string; runs?: { text?: string }[] };
      }[];
    };
  };
}

/**
 * youtube.com/watch, youtu.be, shorts, embed, live 링크와 11자리 ID를 모두 받습니다.
 */
export function parseVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  if (VIDEO_ID_PATTERN.test(trimmed)) return trimmed;

  let url: URL;
  try {
    url = new URL(trimmed.startsWith("http://") || trimmed.startsWith("https://") ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").replace(/^music\./, "");

  if (host === "youtu.be") {
    const id = url.pathname.split("/").filter(Boolean)[0];
    return id && VIDEO_ID_PATTERN.test(id) ? id : null;
  }

  if (host === "youtube.com" || host === "youtube-nocookie.com") {
    const fromQuery = url.searchParams.get("v");
    if (fromQuery && VIDEO_ID_PATTERN.test(fromQuery)) return fromQuery;

    const match = /^\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/.exec(url.pathname);
    return match?.[1] ?? null;
  }

  return null;
}

export async function fetchVideoMeta(videoId: string, fetchImpl: Fetcher = fetch): Promise<YouTubeVideo> {
  // 1) 워치 페이지: 제목·채널·길이·자막 목록·재생 가능 상태가 한 번에 옵니다.
  const html = await safeFetch(() => fetchWatchPage(videoId, fetchImpl));
  const pagePlayer = html ? (extractPlayerResponse(html) as PlayerResponse | null) : null;
  assertPlayable(pagePlayer?.playabilityStatus);

  let details = pagePlayer?.videoDetails;

  // 2) 워치 페이지가 막혔거나 상세가 없으면 youtubei player(WEB)로 상세만 다시 시도
  if (!details) {
    const player = await safeFetch(() => fetchPlayer(videoId, fetchImpl));
    assertPlayable(player?.playabilityStatus);
    details = player?.videoDetails;
  }

  // 3) oEmbed: 제목·채널만이라도(자막은 못 가져옴)
  const oembed = details ? null : await safeFetch(() => fetchOEmbed(videoId, fetchImpl));

  if (!details && !oembed) {
    throw new VideoError(
      "video_unavailable",
      "영상 정보를 가져오지 못했습니다. 비공개·연령 제한·삭제된 영상인지 확인해 주세요.",
      "network",
    );
  }

  const duration = details?.lengthSeconds ? Number(details.lengthSeconds) : undefined;

  return {
    id: videoId,
    url: `https://www.youtube.com/watch?v=${videoId}`,
    title: details?.title?.trim() || oembed?.title?.trim() || "제목 없는 영상",
    channelTitle: details?.author?.trim() || oembed?.author_name?.trim() || "",
    ...(oembed?.author_url ? { channelUrl: oembed.author_url } : {}),
    ...(details?.shortDescription ? { description: details.shortDescription.slice(0, 2000) } : {}),
    ...(duration && Number.isFinite(duration) ? { durationSeconds: duration } : {}),
    thumbnailUrl:
      oembed?.thumbnail_url ?? details?.thumbnail?.thumbnails?.at(-1)?.url ?? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg`,
  };
}

/** 재생 불가 상태를 원인별로 나눕니다(봇 차단·연령 제한·비공개·삭제). */
function assertPlayable(status: { status?: string; reason?: string } | undefined): void {
  const code = status?.status?.toUpperCase();
  const reason = (status?.reason ?? "").toLowerCase();
  if (code === "OK" || code === "PLAYABLE" || (!code && !reason)) return;

  if (/bot|자동화|captcha|sign in to confirm/.test(reason)) {
    throw new VideoError(
      "video_unavailable",
      "유튜브가 이 서버의 접속을 '봇'으로 보고 재생을 막았습니다. 자막을 직접 붙여넣거나 잠시 후 다시 시도해 주세요.",
      "bot_check",
    );
  }
  if (/age|연령|inappropriate/.test(reason)) {
    throw new VideoError(
      "video_unavailable",
      "연령 제한 영상이라 서버에서 읽을 수 없습니다. 연령 확인 후 '스크립트 표시'로 복사한 자막을 붙여넣어 주세요.",
      "age_restricted",
    );
  }
  if (/private/.test(reason)) {
    throw new VideoError(
      "video_unavailable",
      "비공개 영상입니다. 공개 상태의 영상이거나 자막을 직접 붙여넣어 주세요.",
      "private",
    );
  }
  if (code === "UNPLAYABLE" || code === "ERROR") {
    throw new VideoError(
      "video_unavailable",
      "이 영상을 재생할 수 없습니다(삭제·지역 제한·멤버십 전용 등). 자막을 직접 붙여넣으면 계속 만들 수 있습니다.",
      "deleted",
    );
  }
}

/**
 * 자막을 가져옵니다.
 * 1) 워치 페이지의 ytInitialPlayerResponse → captionTracks
 * 2) youtubei player 응답의 captionTracks
 * 3) 언어별 timedtext 직접 요청
 * 순서로 시도하고, 모두 실패하면 이유(자막 없음 / 유튜브가 빈 응답으로 차단)를 붙여 던집니다.
 */
export async function fetchTranscript(videoId: string, fetchImpl: Fetcher = fetch): Promise<Transcript> {
  let tracks: CaptionTrack[] = [];
  let pagePlayer: PlayerResponse | null = null;

  const html = await safeFetch(() => fetchWatchPage(videoId, fetchImpl));
  if (html) {
    pagePlayer = extractPlayerResponse(html) as PlayerResponse | null;
    if (pagePlayer) tracks = parseCaptionTracks(pagePlayer);
  }

  if (tracks.length === 0) {
    const player = await safeFetch(() => fetchPlayer(videoId, fetchImpl));
    if (player) tracks = parseCaptionTracks(player);
  }

  const track = pickCaptionTrack(tracks);
  if (track) {
    const json = await safeFetch(() => fetchTimedText(track.baseUrl, fetchImpl));
    if (json) {
      const parsed = parseTimedTextJson(json);
      if (parsed.text.length > 0) {
        return {
          language: track.languageCode,
          isAutoGenerated: track.kind === "asr",
          text: parsed.text,
          segments: parsed.segments,
        };
      }
    }
    // 자막 목록은 있는데 본문이 비어 오는 경우 = 유튜브의 서버 자막 차단(PO 토큰 요구).
    throw new VideoError(
      "transcript_unavailable",
      "유튜브가 서버에서 자막 본문을 내려주지 않았습니다(자막 요청 차단). '스크립트 표시'로 복사한 자막을 붙여넣으면 바로 만들 수 있습니다.",
      "captions_blocked",
    );
  }

  for (const languageCode of ["ko", "en"]) {
    const fallbackUrl = `https://www.youtube.com/api/timedtext?v=${videoId}&lang=${languageCode}&fmt=json3`;
    const json = await safeFetch(() => fetchTimedText(fallbackUrl, fetchImpl));
    if (!json) continue;
    const parsed = parseTimedTextJson(json);
    if (parsed.text.length > 0) {
      return { language: languageCode, isAutoGenerated: false, text: parsed.text, segments: parsed.segments };
    }
  }

  throw new VideoError(
    "transcript_unavailable",
    "이 영상에는 자막이 없습니다. 유튜브 '스크립트 표시'의 자막을 붙여넣거나, 영상 설명으로 계속 만들 수 있습니다.",
    "no_captions",
  );
}

async function fetchOEmbed(videoId: string, fetchImpl: Fetcher): Promise<OEmbedResponse> {
  const url = `https://www.youtube.com/oembed?url=${encodeURIComponent(
    `https://www.youtube.com/watch?v=${videoId}`,
  )}&format=json`;
  const response = await fetchImpl(url, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`oembed ${response.status}`);
  return (await response.json()) as OEmbedResponse;
}

/**
 * youtubei player 응답. 공개 웹 클라이언트(WEB)로 요청합니다.
 * (예전 ANDROID + 공개 API 키 조합은 400 FAILED_PRECONDITION 으로 막혔습니다.)
 */
async function fetchPlayer(videoId: string, fetchImpl: Fetcher): Promise<PlayerResponse> {
  const response = await fetchImpl("https://www.youtube.com/youtubei/v1/player", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": USER_AGENT,
      "x-youtube-client-name": "1",
      "x-youtube-client-version": "2.20241101.00.00",
      origin: "https://www.youtube.com",
    },
    body: JSON.stringify({
      context: { client: { clientName: "WEB", clientVersion: "2.20241101.00.00", hl: "ko", gl: "KR" } },
      videoId,
      contentCheckOk: true,
      racyCheckOk: true,
    }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  if (!response.ok) throw new Error(`player ${response.status}`);
  return (await response.json()) as PlayerResponse;
}

async function fetchWatchPage(videoId: string, fetchImpl: Fetcher): Promise<string> {
  const url = `https://www.youtube.com/watch?v=${videoId}&hl=ko&has_verified=1&bpctr=9999999999`;
  const response = await fetchImpl(url, {
    headers: {
      "user-agent": USER_AGENT,
      "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      cookie: "CONSENT=YES+1",
    },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`watch ${response.status}`);
  return response.text();
}

async function fetchTimedText(baseUrl: string, fetchImpl: Fetcher): Promise<unknown> {
  let url: URL;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new Error("잘못된 자막 URL");
  }
  url.searchParams.set("fmt", "json3");
  if (!url.searchParams.has("c")) url.searchParams.set("c", "WEB");

  const response = await fetchImpl(url.toString(), {
    headers: { "user-agent": USER_AGENT, accept: "application/json" },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`timedtext ${response.status}`);
  const text = await response.text();
  if (!text.trim()) return null;
  return JSON.parse(text) as unknown;
}

async function safeFetch<T>(operation: () => Promise<T>): Promise<T | null> {
  try {
    return await operation();
  } catch {
    return null;
  }
}

export function parseCaptionTracks(player: unknown): CaptionTrack[] {
  const response = player as PlayerResponse | null;
  const tracks = response?.captions?.playerCaptionsTracklistRenderer?.captionTracks ?? [];

  return tracks
    .filter((track): track is NonNullable<typeof track> => typeof track?.baseUrl === "string")
    .map((track) => ({
      baseUrl: track.baseUrl ?? "",
      languageCode: track.languageCode ?? "en",
      label: track.name?.simpleText ?? track.name?.runs?.[0]?.text ?? track.languageCode ?? "",
      kind: track.kind === "asr" ? ("asr" as const) : ("manual" as const),
    }))
    .filter((track) => track.baseUrl.length > 0);
}

/** 수동 자막 > 한국어/영어 > 자동 자막 순으로 고릅니다. */
export function pickCaptionTrack(tracks: CaptionTrack[]): CaptionTrack | null {
  if (tracks.length === 0) return null;

  const score = (track: CaptionTrack): number => {
    let value = track.kind === "asr" ? 10 : 0;
    if (track.languageCode.startsWith("ko")) value -= 2;
    else if (track.languageCode.startsWith("en")) value -= 1;
    return value;
  };

  return [...tracks].sort((a, b) => score(a) - score(b))[0] ?? null;
}

/**
 * 워치 페이지 HTML에서 ytInitialPlayerResponse JSON을 잘라냅니다.
 * 문자열 안의 중괄호를 건너뛰기 위해 간단한 괄호 카운터를 씁니다.
 */
export function extractPlayerResponse(html: string): unknown {
  const marker = html.indexOf("ytInitialPlayerResponse");
  if (marker === -1) return null;

  const assignment = html.indexOf("{", html.indexOf("=", marker));
  if (assignment === -1) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = assignment; index < html.length; index += 1) {
    const char = html[index];

    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }

    if (char === '"') inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(html.slice(assignment, index + 1)) as unknown;
        } catch {
          return null;
        }
      }
    }
  }

  return null;
}

export interface ParsedTimedText {
  text: string;
  segments: { startSeconds: number; durationSeconds: number; text: string }[];
}

export function parseTimedTextJson(input: unknown): ParsedTimedText {
  const events = (input as { events?: unknown[] } | null)?.events;
  if (!Array.isArray(events)) return { text: "", segments: [] };

  const segments = events
    .map((event) => {
      const item = event as { tStartMs?: number; dDurationMs?: number; segs?: { utf8?: string }[] };
      const text = (item.segs ?? [])
        .map((segment) => segment.utf8 ?? "")
        .join("")
        .replace(/\s+/g, " ")
        .trim();

      return {
        startSeconds: Math.max(0, (item.tStartMs ?? 0) / 1000),
        durationSeconds: Math.max(0, (item.dDurationMs ?? 0) / 1000),
        text,
      };
    })
    .filter((segment) => segment.text.length > 0 && segment.text !== "\n");

  return { text: buildTranscriptText(segments.map((segment) => segment.text)), segments };
}

/** 자동 자막의 짧은 조각들을 문장 단위로 이어 붙입니다. */
export function buildTranscriptText(pieces: string[]): string {
  const merged: string[] = [];

  for (const piece of pieces) {
    const cleaned = piece.replace(/\s+/g, " ").trim();
    if (!cleaned) continue;
    const previous = merged.at(-1);
    if (previous === cleaned) continue;
    merged.push(cleaned);
  }

  return merged
    .join(" ")
    .replace(/\s+([,.!?])/g, "$1")
    .replace(/([.!?])([가-힣A-Za-z])/g, "$1 $2")
    .trim();
}
