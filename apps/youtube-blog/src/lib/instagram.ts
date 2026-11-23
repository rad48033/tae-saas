/**
 * 인스타그램 게시물(릴스 포함) 읽기.
 *
 * 왜 여러 경로를 쓰나:
 *  - `https://www.instagram.com/p/{code}/` 는 로그인 벽과 데스크톱 JS 셸만 돌려주는 일이 많습니다.
 *  - 반면 `/embed/captioned/` 는 **모바일 UA** 로 요청하면 게시물 JSON(contextJSON → gql_data)을
 *    그대로 내려줍니다. 이 JSON에 캡션·작성자·사진·영상 주소가 모두 들어 있습니다.
 * 그래서 embed(모바일 UA) → embed reels 경로 → 페이지 og 태그 순서로 시도합니다.
 */

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 12_000;

export interface InstagramPost {
  shortcode: string;
  url: string;
  /** 캡션 첫 줄(제목으로 씀) */
  title: string;
  /** 캡션 전체 */
  caption: string;
  author: string;
  authorName: string | null;
  images: string[];
  videoUrl: string | null;
  isVideo: boolean;
  likes: number | null;
  /** 캡션이 어디서 왔는지(디버깅·안내용) */
  source: "embed" | "page_meta";
}

export type InstagramFailReason = "invalid_url" | "not_found" | "login_required" | "fetch_failed";

export interface InstagramFetchResult {
  post: InstagramPost | null;
  reason: InstagramFailReason | null;
  /** 시도한 경로(로그·안내에 남깁니다) */
  attempts: string[];
}

/** /p/, /reel/, /reels/, /tv/ 주소와 공유 링크에서 shortcode를 뽑습니다. */
export function parseInstagramUrl(input: string): { shortcode: string; url: string } | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
  } catch {
    return null;
  }

  const host = url.hostname.replace(/^www\./, "").replace(/^m\./, "").toLowerCase();
  if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;

  // /p/{code}/, /reel/{code}/, /reels/{code}/, /tv/{code}/
  const match = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
  if (match?.[1]) {
    const shortcode = match[1];
    return { shortcode, url: `https://www.instagram.com/p/${shortcode}/` };
  }

  // /username/p/{code}/ 형태
  const nested = /^\/[^/]+\/(?:p|reel)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
  if (nested?.[1]) {
    const shortcode = nested[1];
    return { shortcode, url: `https://www.instagram.com/p/${shortcode}/` };
  }

  return null;
}

export function isInstagramHost(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed) return false;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    return host === "instagram.com" || host.endsWith(".instagram.com");
  } catch {
    return false;
  }
}

/**
 * embed 페이지 HTML에서 게시물 JSON을 꺼냅니다.
 * HTML 안에서는 JSON이 JS 문자열로 두 번 이스케이프돼 있어(\\" , \\\\/) 단계적으로 풉니다.
 */
export function parseInstagramEmbedHtml(html: string, fallbackUrl = ""): InstagramPost | null {
  const media = extractShortcodeMedia(html);
  if (media) {
    const post = mediaToPost(media, fallbackUrl);
    if (post) return post;
  }
  return postFromMetaTags(html, fallbackUrl);
}

export async function fetchInstagramPost(
  inputUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstagramFetchResult> {
  const parsed = parseInstagramUrl(inputUrl);
  if (!parsed) return { post: null, reason: "invalid_url", attempts: [] };

  const attempts: string[] = [];
  const endpoints = [
    `https://www.instagram.com/p/${parsed.shortcode}/embed/captioned/`,
    `https://www.instagram.com/reel/${parsed.shortcode}/embed/captioned/`,
  ];

  for (const endpoint of endpoints) {
    const html = await requestHtml(endpoint, MOBILE_UA, fetchImpl, attempts);
    if (!html) continue;
    const post = parseInstagramEmbedHtml(html, parsed.url);
    if (post) return { post: { ...post, shortcode: parsed.shortcode, url: parsed.url }, reason: null, attempts };
  }

  // 마지막: 데스크톱 페이지의 og 태그(있으면 캡션 일부라도)
  const page = await requestHtml(parsed.url, DESKTOP_UA, fetchImpl, attempts);
  if (page) {
    const post = postFromMetaTags(page, parsed.url);
    if (post) return { post: { ...post, shortcode: parsed.shortcode, url: parsed.url }, reason: null, attempts };
  }

  const wall = attempts.some((entry) => entry.includes("login_wall"));
  return { post: null, reason: wall ? "login_required" : "not_found", attempts };
}

async function requestHtml(
  url: string,
  userAgent: string,
  fetchImpl: typeof fetch,
  attempts: string[],
): Promise<string | null> {
  try {
    const response = await fetchImpl(url, {
      headers: {
        "user-agent": userAgent,
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
        accept: "text/html,application/xhtml+xml",
        ...(url.includes("/embed/") ? { referer: "https://www.instagram.com/" } : {}),
      },
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const html = await response.text();
    const label = `${new URL(url).pathname}${url.includes("embed") ? " (embed)" : ""} → HTTP ${response.status}/${html.length}B`;
    if (!response.ok) {
      attempts.push(label);
      return null;
    }
    attempts.push(html.includes("shortcode_media") ? `${label} · JSON 있음` : `${label} · JSON 없음`);
    if (!html.includes("shortcode_media") && /LoginAndSignupPage|loginForm|"login_required"/.test(html)) {
      attempts.push(`${label} · login_wall`);
    }
    return html;
  } catch (error) {
    attempts.push(`${new URL(url).pathname} → 실패(${error instanceof Error ? error.name : "오류"})`);
    return null;
  }
}

interface ShortcodeMedia {
  __typename?: string;
  id?: string;
  shortcode?: string;
  is_video?: boolean;
  video_url?: string;
  display_url?: string;
  thumbnail_src?: string;
  owner?: { username?: string; full_name?: string };
  edge_media_to_caption?: { edges?: { node?: { text?: string } }[] };
  edge_liked_by?: { count?: number };
  edge_media_preview_like?: { count?: number };
  edge_sidecar_to_children?: { edges?: { node?: ShortcodeMedia }[] };
}

function extractShortcodeMedia(html: string): ShortcodeMedia | null {
  const marker = html.indexOf("shortcode_media");
  if (marker < 0) return null;
  const gqlIndex = html.lastIndexOf("gql_data", marker);
  if (gqlIndex < 0) return null;
  const brace = html.indexOf("{", gqlIndex);
  if (brace < 0) return null;

  const raw = sliceBalancedObject(html, brace);
  if (!raw) return null;

  let text = raw;
  for (let attempt = 0; attempt < 4; attempt += 1) {
    try {
      const parsed = JSON.parse(text) as { shortcode_media?: ShortcodeMedia };
      if (parsed?.shortcode_media) return parsed.shortcode_media;
    } catch {
      // 한 겹씩 풀어 다시 시도
    }
    text = unescapeOnce(text);
  }
  return null;
}

/** JS 문자열 안의 JSON: 짝이 맞는 중괄호까지 자릅니다(이스케이프된 따옴표는 무시). */
function sliceBalancedObject(source: string, start: number): string | null {
  let depth = 0;
  let inString = false;
  for (let index = start; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (char === '"' && !isEscaped(source, index)) inString = false;
      continue;
    }
    if (char === '"' && !isEscaped(source, index)) inString = true;
    else if (char === "{") depth += 1;
    else if (char === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

function isEscaped(source: string, index: number): boolean {
  let count = 0;
  for (let cursor = index - 1; cursor >= 0 && source[cursor] === "\\"; cursor -= 1) count += 1;
  return count % 2 === 1;
}

export function unescapeOnce(input: string): string {
  return input.replace(/\\(u[0-9a-fA-F]{4}|[\s\S])/g, (match, group: string) => {
    if (group.startsWith("u") && group.length === 5) {
      const code = Number.parseInt(group.slice(1), 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : match;
    }
    switch (group) {
      case "n":
        return "\n";
      case "t":
        return "\t";
      case "r":
        return "\r";
      case "b":
        return "\b";
      case "f":
        return "\f";
      case '"':
        return '"';
      case "\\":
        return "\\";
      case "/":
        return "/";
      default:
        return group;
    }
  });
}

function mediaToPost(media: ShortcodeMedia, fallbackUrl: string): InstagramPost | null {
  const caption =
    (media.edge_media_to_caption?.edges ?? [])
      .map((edge) => edge?.node?.text ?? "")
      .filter((value) => value.trim().length > 0)
      .join("\n\n") || "";

  const images: string[] = [];
  const pushImage = (value?: string) => {
    if (!value) return;
    if (!/^https:\/\//i.test(value)) return;
    if (!images.includes(value)) images.push(value);
  };
  pushImage(media.display_url);
  pushImage(media.thumbnail_src);
  for (const edge of media.edge_sidecar_to_children?.edges ?? []) {
    pushImage(edge?.node?.display_url);
    pushImage(edge?.node?.thumbnail_src);
  }

  const username = media.owner?.username?.trim();
  const author = username ? `@${username.replace(/^@/, "")}` : "인스타그램";
  const shortcode = media.shortcode ?? "";

  // 캡션도 사진도 없으면 게시물을 못 읽은 것으로 봅니다(삭제·비공개).
  if (!caption.trim() && images.length === 0 && !media.video_url) return null;

  return {
    shortcode,
    url: shortcode ? `https://www.instagram.com/p/${shortcode}/` : fallbackUrl,
    title: firstLine(caption) ?? (username ? `@${username} 게시물` : "인스타그램 게시물"),
    caption,
    author,
    authorName: media.owner?.full_name?.trim() ?? null,
    images: images.slice(0, 6),
    videoUrl: media.is_video ? (media.video_url ?? null) : null,
    isVideo: Boolean(media.is_video),
    likes: media.edge_liked_by?.count ?? media.edge_media_preview_like?.count ?? null,
    source: "embed",
  };
}

/** 로그인 벽에 가려도 og:description에 캡션 첫 부분이 남는 경우가 있습니다. */
function postFromMetaTags(html: string, fallbackUrl: string): InstagramPost | null {
  const description = metaContent(html, "og:description") ?? metaContent(html, "description");
  if (!description) return null;

  const caption = decodeEntities(description)
    .replace(/^[\d,.\s]+(likes?|Likes?|[^\d]{0,12}좋아요)[,\s-]*/u, "")
    .replace(/\s*on Instagram.*$/i, "")
    .replace(/\s*님의 Instagram.*$/i, "")
    .replace(/^["“]/, "")
    .replace(/["”]$/, "")
    .trim();
  if (caption.length < 10) return null;

  const title = decodeEntities(metaContent(html, "og:title") ?? "")
    .replace(/\s*on Instagram.*$/i, "")
    .trim();
  const image = metaContent(html, "og:image");

  return {
    shortcode: "",
    url: fallbackUrl,
    title: firstLine(caption) ?? title ?? "인스타그램 게시물",
    caption,
    author: /^([\w.]+)\s+on Instagram/i.exec(title)?.[1]?.trim() || "인스타그램",
    authorName: null,
    images: image && /^https:\/\//i.test(image) ? [image] : [],
    videoUrl: null,
    isVideo: false,
    likes: null,
    source: "page_meta",
  };
}

function metaContent(html: string, name: string): string | null {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return null;
}

function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&#(\d+);/g, (_, dec: string) => {
      const code = Number.parseInt(dec, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : "";
    })
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;|&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ");
}

function firstLine(text: string): string | null {
  const line = text
    .split("\n")
    .map((value) => value.trim())
    .find((value) => value.length >= 4);
  return line ? line.slice(0, 100) : null;
}
