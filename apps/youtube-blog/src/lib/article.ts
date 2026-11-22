import { AppError } from "./app-error";

export interface ArticleInput {
  title: string;
  author: string;
  text: string;
  url: string;
}

const MAX_HTML_BYTES = 3 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 15_000;

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

/**
 * 블로그·인스타 URL을 받아 본문 텍스트를 뽑습니다.
 * 사설망 주소는 SSRF 방지를 위해 거부합니다.
 */
export async function fetchPage(url: string): Promise<{ html: string; finalUrl: string }> {
  const parsed = safeUrl(url);
  if (!parsed) throw new AppError("invalid_url", "주소 형식이 올바르지 않습니다. https:// 로 시작하는 주소를 넣어 주세요.", 400);
  if (isPrivateHost(parsed.hostname)) {
    throw new AppError("invalid_url", "사설망 주소는 불러올 수 없습니다.", 400);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(parsed.toString(), {
      headers: {
        "user-agent": USER_AGENT,
        accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
      },
      redirect: "follow",
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new AppError(
        "source_unavailable",
        `원문을 불러오지 못했습니다(HTTP ${response.status}). 본문을 직접 붙여넣으면 바로 만들 수 있습니다.`,
        422,
      );
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType && !/text\/html|application\/xhtml|text\/plain/i.test(contentType)) {
      throw new AppError(
        "source_unavailable",
        "HTML 문서가 아닙니다. 글 본문을 직접 붙여넣어 주세요.",
        422,
      );
    }

    const buffer = await readLimited(response, MAX_HTML_BYTES);
    return { html: buffer.toString("utf8"), finalUrl: response.url || parsed.toString() };
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new AppError("source_unavailable", "원문을 불러오는 데 시간이 너무 오래 걸립니다. 본문을 붙여넣어 주세요.", 422);
    }
    throw new AppError(
      "source_unavailable",
      "원문을 불러오지 못했습니다. 로그인이 필요한 페이지라면 본문을 직접 붙여넣어 주세요.",
      422,
    );
  } finally {
    clearTimeout(timer);
  }
}

async function readLimited(response: Response, maxBytes: number): Promise<Buffer> {
  const reader = response.body?.getReader();
  if (!reader) return Buffer.from(await response.arrayBuffer());

  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!value) continue;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => undefined);
      break;
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((chunk) => Buffer.from(chunk)));
}

export function safeUrl(input: string): URL | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  // http(s)가 아닌 스킴(ftp:, javascript: 등)은 주소로 취급하지 않습니다.
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) && !/^https?:\/\//i.test(trimmed)) return null;
  try {
    const url = new URL(/^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url;
  } catch {
    return null;
  }
}

export function isPrivateHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".localhost") || host === "0.0.0.0") return true;
  if (host === "[::1]" || host === "::1") return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  return false;
}

/**
 * 읽기 좋은 본문을 뽑습니다.
 * <article> → <main> → <body> 순서로 후보를 고르고, 내비게이션·스크립트는 버립니다.
 */
export function extractArticleFromHtml(html: string, pageUrl: string): ArticleInput {
  const withoutNoise = html
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ");

  const title =
    metaContent(html, "og:title") ||
    metaContent(html, "twitter:title") ||
    extractTagText(html, "title") ||
    extractTagText(html, "h1") ||
    hostLabel(pageUrl);

  const author =
    metaContent(html, "author") ||
    metaContent(html, "og:site_name") ||
    metaContent(html, "twitter:site") ||
    hostLabel(pageUrl);

  const article = /<article[\s\S]*?<\/article>/i.exec(withoutNoise)?.[0];
  const main = /<main[\s\S]*?<\/main>/i.exec(withoutNoise)?.[0];
  const body = /<body[\s\S]*?<\/body>/i.exec(withoutNoise)?.[0] ?? withoutNoise;
  const candidate = article ?? main ?? body;

  const text = htmlToText(candidate);
  const description = metaContent(html, "og:description") || metaContent(html, "description");

  return {
    title: decodeEntities(title).trim().slice(0, 200) || hostLabel(pageUrl),
    author: decodeEntities(author).trim().slice(0, 120) || hostLabel(pageUrl),
    text: text.length >= 400 || !description ? text : `${text}\n\n${description}`.trim(),
    url: pageUrl,
  };
}

/**
 * 페이지에서 실제 게시물 사진 주소를 뽑습니다.
 *
 * 영상 파이프라인에 "실제 제품 사진"으로 넘겨, 이미지 생성 모델이 가상의 패키지를
 * 상상해 그리지 않고 실제 제품 외관을 유지하게 합니다.
 * og:image → twitter:image → 본문 <img> 순서로 모으고, 아이콘·스프라이트·로고는 버립니다.
 */
export function extractPageImages(html: string, pageUrl: string, limit = 6): string[] {
  const found: string[] = [];
  const push = (raw: string | undefined) => {
    if (!raw) return;
    const url = absolutize(decodeEntities(raw.trim()), pageUrl);
    if (!url || found.includes(url)) return;
    if (!looksLikePhoto(url)) return;
    found.push(url);
  };

  push(metaContent(html, "og:image"));
  push(metaContent(html, "og:image:secure_url"));
  push(metaContent(html, "twitter:image"));
  push(metaContent(html, "twitter:image:src"));

  // JSON-LD의 image 배열(블로그·커머스 페이지에서 자주 씀)
  for (const match of html.matchAll(/"image"\s*:\s*(?:\[\s*)?"([^"]+)"/g)) push(match[1]);

  // 본문 <img>: og:image가 없는 페이지(인스타 임베드 등)를 위한 보조 경로
  for (const match of html.matchAll(/<img[^>]+>/gi)) {
    const tag = match[0];
    // 아이콘·스프라이트용 1~2자리 크기 속성은 버립니다.
    if (/\b(?:width|height)\s*=\s*["']?\d{1,2}\b/i.test(tag)) continue;

    const srcset =
      /(?:^|\s)(?:srcset|data-srcset)\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] ?? undefined;
    if (srcset) {
      const candidates = srcset
        .split(",")
        .map((part) => part.trim())
        .map((part) => ({ url: part.split(/\s+/)[0] ?? "", width: Number(/(\d+)w\b/.exec(part)?.[1] ?? "0") }))
        .filter((candidate) => candidate.url);
      const largest = candidates.sort((a, b) => b.width - a.width)[0];
      if (largest) push(largest.url);
    }

    const src =
      /(?:^|\s)(?:data-src|data-original|data-lazy-src|src)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1] ?? undefined;
    push(src);
  }

  return found.slice(0, limit);
}

/** 썸네일·아이콘·추적 필셀처럼 제품 사진이 아닌 주소를 걸러냅니다. */
function looksLikePhoto(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (/\.(svg|gif)(\?|$)/i.test(url)) return false;
  if (/(sprite|icon|favicon|logo|avatar|emoji|pixel|tracking|blank\.)/i.test(url)) return false;
  // 인스타·페북 정적 리소스(js/css)는 사진이 아닙니다.
  if (/static\.cdninstagram\.com\/rsrc\.php/i.test(url)) return false;
  return true;
}

function absolutize(src: string, pageUrl: string): string | null {
  if (!src || src.startsWith("data:")) return null;
  try {
    return new URL(src, pageUrl).toString();
  } catch {
    return null;
  }
}

/** 인스타그램은 로그인 벽이 있어 메타 태그에서 캡션만 건집니다. */
export function extractInstagramCaption(html: string, pageUrl: string): ArticleInput {
  const title = metaContent(html, "og:title") || extractTagText(html, "title");
  const description = metaContent(html, "og:description") || metaContent(html, "description");
  const author = metaContent(html, "og:site_name") || "@instagram";

  const caption = decodeEntities(description)
    .replace(/^[\d,.\s]+(likes?|Likes?)[,\s-]*/g, "")
    .replace(/\s*on Instagram.*$/i, "")
    .replace(/^["“]/, "")
    .replace(/["”]$/, "")
    .trim();

  return {
    title: decodeEntities(title).replace(/\s*on Instagram.*$/i, "").trim().slice(0, 200) || "인스타그램 게시물",
    author: decodeEntities(author).trim().slice(0, 120),
    text: caption,
    url: pageUrl,
  };
}

export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|section|article|li|h[1-6]|blockquote|tr|td)>/gi, "\n\n")
      .replace(/<li[^>]*>/gi, "• ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\r\n/g, "\n")
    .replace(/[ \t\u00a0]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function metaContent(html: string, name: string): string {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]*content=["']([^"']*)["']`, "i"),
    new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]*(?:property|name)=["']${escaped}["']`, "i"),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(html);
    if (match?.[1]) return match[1];
  }
  return "";
}

function extractTagText(html: string, tag: string): string {
  const match = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i").exec(html);
  return match?.[1] ? htmlToText(match[1]) : "";
}

function hostLabel(pageUrl: string): string {
  try {
    return new URL(pageUrl).hostname.replace(/^www\./, "");
  } catch {
    return "원문";
  }
}

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  middot: "·",
  hellip: "…",
  mdash: "—",
  ndash: "–",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
};

export function decodeEntities(input: string): string {
  return input
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => safeCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => safeCodePoint(Number.parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeCodePoint(code: number): string {
  if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return "";
  try {
    return String.fromCodePoint(code);
  } catch {
    return "";
  }
}
