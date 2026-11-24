import { NextResponse } from "next/server";

import { isAdmin } from "@/lib/auth/guard";
import { getSessionUser } from "@/lib/session";

/**
 * 인스타그램 추출 진단용(관리자). 운영 서버 IP에서 무엇이 되는지 확인합니다.
 * 공개 게시물 주소만 받아 여러 경로를 병렬로 호출하고 결과만 돌려줍니다.
 * GET /api/instagram/probe?url=https://www.instagram.com/reel/XXXX/
 */

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const MOBILE_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const DESKTOP_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";

const TIMEOUT_MS = 9_000;

interface ProbeResult {
  label: string;
  url: string;
  status: number | null;
  ms: number;
  bytes: number;
  finalUrl: string | null;
  hasShortcodeJson: boolean;
  hasOgDescription: boolean;
  contentLengthHeader: string | null;
  setCookie: boolean;
  error: string | null;
  snippet: string | null;
}

function instagramUrl(input: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(input) ? input : `https://${input}`);
    const host = url.hostname.replace(/^www\./, "").toLowerCase();
    if (host !== "instagram.com" && !host.endsWith(".instagram.com")) return null;
    return url;
  } catch {
    return null;
  }
}

function shortcodeFrom(url: URL): string | null {
  const match = /^\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
  if (match?.[1]) return match[1];
  const nested = /^\/[^/]+\/(?:p|reel)\/([A-Za-z0-9_-]{5,})/.exec(url.pathname);
  return nested?.[1] ?? null;
}

async function probe(
  label: string,
  url: string,
  init: RequestInit = {},
  snippetOf?: (html: string) => string | null,
): Promise<ProbeResult> {
  const started = Date.now();
  const result: ProbeResult = {
    label,
    url,
    status: null,
    ms: 0,
    bytes: 0,
    finalUrl: null,
    hasShortcodeJson: false,
    hasOgDescription: false,
    contentLengthHeader: null,
    setCookie: false,
    error: null,
    snippet: null,
  };
  try {
    const response = await fetch(url, {
      ...init,
      redirect: "follow",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    const text = await response.text();
    result.status = response.status;
    result.bytes = text.length;
    result.finalUrl = response.url;
    result.contentLengthHeader = response.headers.get("content-length");
    result.setCookie = Boolean(response.headers.get("set-cookie"));
    result.hasShortcodeJson = text.includes("shortcode_media");
    result.hasOgDescription = /og:description/i.test(text);
    result.snippet = snippetOf
      ? snippetOf(text)
      : (/(?:og:description|description)["'][^>]*content="([^"]{0,160})/i.exec(text)?.[1] ?? null);
  } catch (error) {
    result.error = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  }
  result.ms = Date.now() - started;
  return result;
}

export async function GET(request: Request) {
  const user = await getSessionUser();
  if (!isAdmin(user)) {
    return NextResponse.json({ ok: false, message: "관리자만 사용할 수 있는 진단 도구입니다." }, { status: 403 });
  }

  const raw = new URL(request.url).searchParams.get("url") ?? "";
  const target = instagramUrl(raw);
  if (!target) {
    return NextResponse.json({ ok: false, message: "인스타그램 주소만 진단할 수 있습니다." }, { status: 400 });
  }

  const code = shortcodeFrom(target);
  const sharePath = /^\/share\//.test(target.pathname);
  const canonical = code ? `https://www.instagram.com/p/${code}/` : target.toString();

  const headers = (ua: string) => ({
    "user-agent": ua,
    "accept-language": "ko-KR,ko;q=0.9,en;q=0.8",
    accept: "text/html,application/xhtml+xml",
  });

  const tasks: Promise<ProbeResult>[] = [
    probe("home(쿠키 확인)", "https://www.instagram.com/", { headers: headers(MOBILE_UA) }),
    probe("share 리다이렉트", target.toString(), { headers: headers(MOBILE_UA) }),
    probe("oembed(i.instagram.com)", `https://i.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonical)}`, {
      headers: { accept: "application/json", "user-agent": MOBILE_UA },
    }),
    probe("oembed(www /api/v1)", `https://www.instagram.com/api/v1/oembed/?url=${encodeURIComponent(canonical)}`, {
      headers: { accept: "application/json", "user-agent": MOBILE_UA },
    }),
    probe("oembed(www /oembed)", `https://www.instagram.com/oembed/?url=${encodeURIComponent(canonical)}`, {
      headers: { accept: "application/json", "user-agent": MOBILE_UA },
    }),
    probe("페이지(데스크톱 UA)", canonical, { headers: headers(DESKTOP_UA) }),
    probe("페이지(모바일 UA)", canonical, { headers: headers(MOBILE_UA) }),
    probe("r.jina.ai", `https://r.jina.ai/${canonical}`, { headers: { accept: "text/plain" } }),
  ];

  if (code) {
    tasks.push(
      probe("embed(/p, 모바일 UA)", `https://www.instagram.com/p/${code}/embed/captioned/`, {
        headers: { ...headers(MOBILE_UA), referer: "https://www.instagram.com/" },
      }),
      probe("embed(/reel, 모바일 UA)", `https://www.instagram.com/reel/${code}/embed/captioned/`, {
        headers: { ...headers(MOBILE_UA), referer: "https://www.instagram.com/" },
      }),
      probe("embed(쿠키 데움)", `https://www.instagram.com/p/${code}/embed/captioned/`, {
        headers: { ...headers(MOBILE_UA), referer: "https://www.instagram.com/", cookie: "ig_did=0" },
      }),
    );
  }

  const results = await Promise.all(tasks);

  return NextResponse.json({
    ok: true,
    input: raw,
    normalized: target.toString(),
    parsed: { shortcode: code, sharePath },
    canonical,
    runtime: {
      region: process.env.VERCEL_REGION ?? null,
      vercel: process.env.VERCEL === "1",
      commit: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
      node: process.version,
    },
    results,
  });
}
