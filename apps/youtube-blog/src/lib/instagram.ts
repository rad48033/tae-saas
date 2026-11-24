/**
 * 인스타그램 게시물(릴스 포함) 읽기.
 *
 * 왜 여러 경로를 쓰나(2026-11 실측):
 *  - `https://www.instagram.com/p/{code}/` 는 로그인 벽과 JS 셸만 돌려주는 일이 많습니다.
 *    (데스크톱 UA는 og 태그조차 없습니다. 모바일 UA여야 og:description이 남습니다.)
 *  - `/embed/captioned/` 는 **모바일 UA**로 요청하면 게시물 JSON(contextJSON → gql_data)을
 *    그대로 내려줍니다. 이 JSON에 캡션·작성자·사진·영상 주소가 모두 들어 있습니다.
 *  - `https://i.instagram.com/api/v1/oembed/` 는 로그인 없이 캡션·작성자·썸네일을 돌려주고,
 *    비공개·연령 제한 게시물이면 그 이유까지 알려 줍니다.
 *  - 앱에서 '링크 복사'를 하면 `instagram.com/share/reel/{token}` 같은 단축 링크가 나옵니다.
 *    token은 shortcode가 아니라서, 먼저 리다이렉트를 따라 실제 게시물 주소로 풀어야 합니다.
 *
 * 그래서 순서는 공유 링크 해석 → embed(모바일 UA) → oEmbed → 페이지 og 태그(모바일 UA)입니다.
 */

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const TIMEOUT_MS = 9_000;

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
  source: "embed" | "oembed" | "page_meta";
}

export type InstagramFailReason =
  | "invalid_url"
  | "not_found"
  | "login_required"
  | "fetch_failed"
  /** 비공개 계정 게시물 */
  | "private"
  /** 연령 제한 등으로 로그인 없이는 볼 수 없는 게시물 */
  | "age_restricted"
  /** 공유(단축) 링크를 실제 게시물 주소로 풀지 못함 */
  | "share_unresolved"
  /** 인스타그램이 서버 요청에는 게시물을 내려주지 않음(차단·점검) */
  | "blocked";

export interface InstagramFetchResult {
  post: InstagramPost | null;
  reason: InstagramFailReason | null;
  /** 실제로 읽은 게시물 코드(공유 링크는 풀린 뒤의 값) */
  shortcode: string | null;
  /** 시도한 경로(로그·안내에 남깁니다) */
  attempts: string[];
}

export interface InstagramLink {
  /** 게시물 shortcode(공유 링크면 풀기 전까지 null) */
  shortcode: string | null;
  /** 정규화한 주소(공유 링크면 원래 주소 유지) */
  url: string;
  /** /share/... 단축 링크의 토큰 */
  shareToken?: string | null;
  /** 단축 링크에 적힌 종류(p·reel) */
  shareKind?: "p" | "reel" | null;
}

/** /p/, /reel/, /reels/, /tv/, /{user}/p/{code} 주소와 /share/ 단축 링크를 읽습니다. */
export function parseInstagramUrl(input: string): InstagramLink | null {
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

  // 앱 '링크 복사'가 만드는 단축 링크: /share/reel/{token}/, /share/{token}
  const share = /^\/share(?:\/(p|reel|reels|tv))?\/([A-Za-z0-9_-]{5,})\/?$/.exec(url.pathname);
  if (share?.[2]) {
    const kind = share[1] === "reel" || share[1] === "reels" ? "reel" : share[1] === "p" ? "p" : null;
    return { shortcode: null, url: url.toString(), shareToken: share[2], shareKind: kind };
  }

  // /p/{code}/, /reel/{code}/, /reels/{code}/, /tv/{code}/
  const match = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
  if (match?.[1]) {
    const shortcode = match[1];
    return { shortcode, url: `https://www.instagram.com/p/${shortcode}/` };
  }

  // /username/p/{code}/, /username/reel/{code}/
  const nested = /^\/[^/]+\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
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
 * HTML 안에서는 JSON이 JS 문자열로 두 번 이스케이프돼 있어(\\" , \\\/) 단계적으로 풉니다.
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
  if (!parsed) return { post: null, reason: "invalid_url", shortcode: null, attempts: [] };

  const attempts: string[] = [];

  let shortcode = parsed.shortcode;
  if (!shortcode && parsed.shareToken) {
    shortcode = await resolveShareLink(parsed.shareToken, parsed.shareKind ?? null, fetchImpl, attempts);
    if (!shortcode) {
      attempts.push("공유 링크를 게시물 주소로 풀지 못했습니다");
      return { post: null, reason: "share_unresolved", shortcode: null, attempts };
    }
  }
  if (!shortcode) return { post: null, reason: "invalid_url", shortcode: null, attempts };

  const canonical = `https://www.instagram.com/p/${shortcode}/`;

  // embed 두 경로와 oEmbed는 서로 독립이라 동시에 보냅니다(가장 빠른 답을 씁니다).
  const [embedByPost, embedByReel, oembed] = await Promise.all([
    getHtml(`https://www.instagram.com/p/${shortcode}/embed/captioned/`, MOBILE_UA, fetchImpl),
    getHtml(`https://www.instagram.com/reel/${shortcode}/embed/captioned/`, MOBILE_UA, fetchImpl),
    getOEmbed(canonical, fetchImpl),
  ]);

  for (const outcome of [embedByPost, embedByReel]) {
    attempts.push(describeHtmlAttempt(outcome));
    if (outcome.html) {
      const post = parseInstagramEmbedHtml(outcome.html, canonical);
      // og 태그만 걸린 경우(로그인 벽)는 여기서 끝내지 않고 oEmbed·페이지 순서로 넘깁니다.
      if (post?.source === "embed") {
        return { post: { ...post, shortcode, url: canonical }, reason: null, shortcode, attempts };
      }
    }
  }

  attempts.push(describeOEmbedAttempt(oembed));
  const oembedPost = postFromOEmbed(oembed.json, canonical, shortcode);
  if (oembedPost) return { post: oembedPost, reason: null, shortcode, attempts };

  // 마지막: 페이지 미리보기. 로그인 벽에 가려도 모바일 UA에는 og 태그가 남습니다.
  let lastPage: HtmlOutcome | null = null;
  for (const userAgent of [MOBILE_UA, DESKTOP_UA]) {
    const page = await getHtml(canonical, userAgent, fetchImpl);
    lastPage = page;
    attempts.push(describeHtmlAttempt(page, userAgent === MOBILE_UA ? "페이지(모바일 UA)" : "페이지(데스크톱 UA)"));
    if (!page.html) continue;
    const post = postFromMetaTags(page.html, canonical);
    if (post) return { post: { ...post, shortcode, url: canonical }, reason: null, shortcode, attempts };
  }

  return { post: null, reason: failureReason(embedByPost, oembed, lastPage), shortcode, attempts };
}

/**
 * `/share/reel/{token}` 은 302로 실제 게시물 주소를 알려 줍니다.
 * 리다이렉트를 따라간 최종 주소(또는 페이지의 canonical 링크)에서 shortcode를 꺼냅니다.
 */
async function resolveShareLink(
  token: string,
  kind: "p" | "reel" | null,
  fetchImpl: typeof fetch,
  attempts: string[],
): Promise<string | null> {
  const candidates = [
    kind ? `https://www.instagram.com/share/${kind}/${token}/` : null,
    `https://www.instagram.com/share/${token}/`,
    `https://www.instagram.com/share/reel/${token}/`,
  ].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const outcome = await getHtml(candidate, MOBILE_UA, fetchImpl);
    const fromUrl = outcome.finalUrl ? shortcodeFromUrl(outcome.finalUrl) : null;
    if (fromUrl) {
      attempts.push(`공유 링크 해석 → /p/${fromUrl}/ (HTTP ${outcome.status ?? "?"})`);
      return fromUrl;
    }
    if (outcome.html) {
      const fromHtml =
        shortcodeFromUrl(metaContent(outcome.html, "og:url") ?? "") ??
        shortcodeFromUrl(/<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i.exec(outcome.html)?.[1] ?? "");
      if (fromHtml) {
        attempts.push(`공유 링크 해석(HTML) → /p/${fromHtml}/`);
        return fromHtml;
      }
    }
    attempts.push(`공유 링크 ${new URL(candidate).pathname} → HTTP ${outcome.status ?? "실패"} · 게시물 주소 없음`);
  }
  return null;
}

function shortcodeFromUrl(value: string): string | null {
  try {
    const url = new URL(value, "https://www.instagram.com");
    const match = /\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
    return match?.[1] ?? null;
  } catch {
    return null;
  }
}

interface HtmlOutcome {
  status: number | null;
  html: string | null;
  finalUrl: string | null;
  error: string | null;
}

async function getHtml(url: string, userAgent: string, fetchImpl: typeof fetch): Promise<HtmlOutcome> {
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
    return { status: response.status, html: response.ok ? html : null, finalUrl: response.url || null, error: null };
  } catch (error) {
    return {
      status: null,
      html: null,
      finalUrl: null,
      error: error instanceof Error ? error.name : "Error",
    };
  }
}

function describeHtmlAttempt(outcome: HtmlOutcome, label?: string): string {
  const path = label ?? "/embed/captioned/ (embed)";
  if (!outcome.html) return `${path} → ${outcome.status ? `HTTP ${outcome.status}` : `실패(${outcome.error ?? "오류"})`}`;
  const size = `${Math.round(outcome.html.length / 1024)}KB`;
  return `${path} → HTTP ${outcome.status}/${size}${outcome.html.includes("shortcode_media") ? " · JSON 있음" : " · JSON 없음"}`;
}

interface OEmbedOutcome {
  status: number | null;
  json: Record<string, unknown> | null;
  message: string | null;
  error: string | null;
}

/**
 * 로그인 없이도 열리는 oEmbed. 비공개·연령 제한이면 이유 문구를 돌려줍니다.
 * (i.instagram.com 과 www.instagram.com/api/v1 두 주소가 같은 응답을 냅니다.)
 */
async function getOEmbed(canonicalUrl: string, fetchImpl: typeof fetch): Promise<OEmbedOutcome> {
  const url = `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonicalUrl)}`;
  try {
    const response = await fetchImpl(url, {
      headers: { accept: "application/json", "user-agent": MOBILE_UA },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    if (response.ok) {
      try {
        return { status: response.status, json: JSON.parse(text) as Record<string, unknown>, message: null, error: null };
      } catch {
        return { status: response.status, json: null, message: null, error: "JSON 아님" };
      }
    }
    return { status: response.status, json: null, message: text.trim().slice(0, 120), error: null };
  } catch (error) {
    return {
      status: null,
      json: null,
      message: null,
      error: error instanceof Error ? error.name : "Error",
    };
  }
}

function describeOEmbedAttempt(outcome: OEmbedOutcome): string {
  if (outcome.json) {
    const title = typeof outcome.json.title === "string" ? outcome.json.title : "";
    return `oEmbed → HTTP ${outcome.status} · 캡션 ${title.length}자`;
  }
  if (outcome.message) return `oEmbed → HTTP ${outcome.status} · ${outcome.message}`;
  return `oEmbed → ${outcome.status ? `HTTP ${outcome.status}` : `실패(${outcome.error ?? "오류"})`}`;
}

function postFromOEmbed(
  json: Record<string, unknown> | null,
  fallbackUrl: string,
  shortcode: string,
): InstagramPost | null {
  if (!json) return null;
  const caption = typeof json.title === "string" ? json.title.trim() : "";
  const authorName = typeof json.author_name === "string" ? json.author_name.trim() : "";
  const thumbnail = typeof json.thumbnail_url === "string" ? json.thumbnail_url : "";
  if (!caption && !thumbnail) return null;

  const images = /^https:\/\//i.test(thumbnail) ? [thumbnail] : [];
  return {
    shortcode,
    url: fallbackUrl,
    title: firstLine(caption) ?? (authorName ? `@${authorName} 게시물` : "인스타그램 게시물"),
    caption,
    author: authorName ? `@${authorName.replace(/^@/, "")}` : "인스타그램",
    authorName: authorName || null,
    images,
    videoUrl: null,
    isVideo: false,
    likes: null,
    source: "oembed",
  };
}

function failureReason(embed: HtmlOutcome, oembed: OEmbedOutcome, page: HtmlOutcome | null): InstagramFailReason {
  const message = oembed.message ?? "";
  const bodies = [embed.html, page?.html].filter((value): value is string => Boolean(value));
  if (/Page Not Found|Sorry, this page isn't available|페이지를 찾을 수 없습니다/i.test(bodies.join("\n"))) {
    return "not_found";
  }
  if (/private/i.test(message)) return "private";
  if (/under 20|age|restrict/i.test(message)) return "age_restricted";
  if (oembed.status === 404) return "not_found";
  if (bodies.some((body) => /LoginAndSignupPage|loginForm|"login_required"/.test(body))) return "login_required";
  if (oembed.status === 200 || embed.html) return "blocked";
  return "fetch_failed";
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

/** 로그인 벽에 가려도 og:description·og:title에 캡션이 남는 경우가 있습니다. */
function postFromMetaTags(html: string, fallbackUrl: string): InstagramPost | null {
  const rawDescription = decodeEntities(metaContent(html, "og:description") ?? metaContent(html, "description") ?? "").trim();
  const rawTitle = decodeEntities(metaContent(html, "og:title") ?? "").trim();

  // 설명은 `326 likes, 11 comments - handle on November 20, 2026: "캡션…"` 모양입니다.
  const handle = /(?:^|\s)-\s*([A-Za-z0-9._]+)\s+(?:on|님의)\b/i.exec(rawDescription)?.[1]?.trim() ?? null;

  // 제목은 `이름 on Instagram: "캡션…"` 이라 캡션 전체가 더 깨끗하게 들어 있습니다.
  const titleCaption = /^(.*?)\s*(?:on Instagram|님의 Instagram)\s*:\s*["“]?([\s\S]*?)["”]?\s*$/i.exec(rawTitle);
  const caption = cleanCaption(
    titleCaption?.[2]?.trim() || stripDescriptionPrefix(rawDescription),
  );
  if (caption.length < 10) return null;

  const image = metaContent(html, "og:image");
  const displayName = titleCaption?.[1]?.trim() || null;

  return {
    shortcode: "",
    url: fallbackUrl,
    title: firstLine(caption) ?? "인스타그램 게시물",
    caption,
    author: handle ? `@${handle}` : "인스타그램",
    authorName: displayName,
    images: image && /^https:\/\//i.test(image) ? [image] : [],
    videoUrl: null,
    isVideo: false,
    likes: null,
    source: "page_meta",
  };
}

/** `326 likes, 11 comments - handle on November 20, 2026: "` 같은 머리말을 떼어냅니다. */
function stripDescriptionPrefix(description: string): string {
  return description
    .replace(/^[\d,.]+\s*(?:likes?|좋아요)[,.\s]*/iu, "")
    .replace(/^[\d,.]+\s*(?:comments?|댓글)[,.\s]*/iu, "")
    .replace(/^[-–\s]+/, "")
    .replace(/^[A-Za-z0-9._]+\s+(?:on|님의)\s+[^:]{0,40}:\s*/i, "")
    .replace(/^["“]/, "")
    .replace(/["”]\s*$/, "")
    .trim();
}

function cleanCaption(caption: string): string {
  return caption
    .replace(/\s*on Instagram.*$/i, "")
    .replace(/\s*님의 Instagram.*$/i, "")
    .replace(/^["“]\s*/, "")
    .replace(/\s*["”]$/, "")
    .trim();
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
