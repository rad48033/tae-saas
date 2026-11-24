import {
  isSourceType,
  type ContentLanguage,
  type SourceDocument,
  type SourceType,
  type Transcript,
} from "@tae/ai";

import { AppError } from "./app-error";
import { extractArticleFromHtml, extractPageImages, fetchPage } from "./article";
import { fetchInstagramPost, isInstagramHost, parseInstagramUrl, type InstagramFailReason } from "./instagram";
import { MAX_TRANSCRIPT_INPUT_CHARS, MIN_TRANSCRIPT_CHARS, normalizeTranscriptInput, transcriptFromText } from "./transcript";
import { fetchTranscript, fetchVideoMeta, parseVideoId, VideoError } from "./youtube";

export interface SourceRequestBody {
  sourceType: SourceType;
  /** 유튜브·블로그·인스타 주소 (선택) */
  url?: string | undefined;
  /** 붙여넣은 원문 (자막·본문·캡션) */
  text?: string | undefined;
  /** 자막 전용 입력(기존 UI 호환) */
  transcript?: string | undefined;
  title?: string | undefined;
  author?: string | undefined;
  language: ContentLanguage;
  /** 유튜브 자막을 못 가져올 때 영상 설명으로 계속 만들지(사용자가 고른 경우만 true) */
  allowDescriptionFallback?: boolean | undefined;
}

export interface ResolvedSource {
  source: SourceDocument;
  meta: {
    sourceType: SourceType;
    textChars: number;
    textSource:
      | "fetched"
      | "pasted"
      | "transcript"
      | "auto_transcript"
      | "meta_caption"
      | "embed_caption"
      | "description"
      | "upload_transcript";
    fetchedUrl: string | null;
    /** 원본 페이지에서 확보한 실제 사진 수(영상 참조 이미지 후보) */
    imageCount: number;
  };
  warnings: string[];
}

const MIN_TEXT_BY_SOURCE: Record<SourceType, number> = {
  youtube: 200,
  // 짧은 영상 전사문·메모도 막지 않고, 근거가 부족하면 경고로 알립니다.
  blog: 40,
  instagram: 40,
};

const MAX_TEXT_CHARS = MAX_TRANSCRIPT_INPUT_CHARS;

/** 붙여넣은 글이 이보다 짧으면 "결과물 근거가 부족" 경고를 남깁니다. */
const COMFORTABLE_BLOG_CHARS = 400;

/**
 * 사용자 입력을 하나의 SourceDocument로 정규화합니다.
 *  - youtube   : 영상 링크(+자동 자막) 또는 붙여넣은 자막
 *  - blog      : 글 주소에서 본문 추출 또는 붙여넣은 본문
 *  - instagram : 게시물 주소에서 캡션 추출(embed JSON) 또는 붙여넣은 카드·캡션 텍스트
 *
 * 주소를 엉뚱한 탭에 넣은 경우(예: 블로그 탭에 인스타 주소)는 주소를 보고 알맞은 경로로 보냅니다.
 */
export async function resolveSource(body: SourceRequestBody): Promise<ResolvedSource> {
  if (!isSourceType(body.sourceType)) {
    throw new AppError("invalid_request", "입력 유형을 확인해 주세요.", 400);
  }

  const urlInput = body.url?.trim() ?? "";
  const effective = detectSourceType(urlInput) ?? body.sourceType;
  if (effective !== body.sourceType) {
    const resolved = await resolveByType(effective, body);
    resolved.warnings.unshift(
      `주소를 보고 ${sourceLabel(effective)} 입력으로 처리했습니다. (${sourceLabel(body.sourceType)} 탭에 넣은 주소와 실제 주소가 달랐습니다.)`,
    );
    return resolved;
  }

  return resolveByType(body.sourceType, body);
}

function resolveByType(type: SourceType, body: SourceRequestBody): Promise<ResolvedSource> {
  switch (type) {
    case "youtube":
      return resolveYoutube(body);
    case "blog":
      return resolveBlog(body);
    case "instagram":
      return resolveInstagram(body);
  }
}

function sourceLabel(type: SourceType): string {
  return type === "youtube" ? "유튜브" : type === "instagram" ? "인스타그램" : "블로그";
}

/** 주소만 보고 입력 종류를 알아냅니다(모르면 null). */
export function detectSourceType(url: string): SourceType | null {
  if (!url) return null;
  if (isInstagramHost(url)) return "instagram";
  if (parseVideoId(url)) return "youtube";
  return null;
}

async function resolveYoutube(body: SourceRequestBody): Promise<ResolvedSource> {
  const pasted = (body.transcript ?? body.text ?? "").trim();
  const hasUrl = Boolean(body.url?.trim());

  if (!hasUrl && pasted.length < MIN_TRANSCRIPT_CHARS) {
    throw new AppError(
      "invalid_request",
      "유튜브 링크를 넣거나, '스크립트 표시'에서 복사한 자막을 붙여넣어 주세요(200자 이상).",
      400,
      { nextActions: ["paste"] },
    );
  }

  let videoMeta: { title: string; channelTitle: string; durationSeconds?: number; thumbnailUrl?: string; url: string; id: string; description?: string } | null =
    null;
  let autoTranscript: Transcript | null = null;
  const warnings: string[] = [];

  if (hasUrl) {
    const videoId = parseVideoId(body.url ?? "");
    if (!videoId) {
      throw new AppError("invalid_url", "유튜브 링크를 확인해 주세요. 예: https://www.youtube.com/watch?v=…", 400, {
        nextActions: ["paste"],
      });
    }

    const video = await fetchVideoMeta(videoId);
    videoMeta = {
      id: video.id,
      url: video.url,
      title: video.title,
      channelTitle: video.channelTitle,
      ...(video.durationSeconds !== undefined ? { durationSeconds: video.durationSeconds } : {}),
      ...(video.thumbnailUrl ? { thumbnailUrl: video.thumbnailUrl } : {}),
      ...(video.description ? { description: video.description } : {}),
    };

    if (pasted.length < MIN_TRANSCRIPT_CHARS) {
      try {
        autoTranscript = await fetchTranscript(videoId);
      } catch (error) {
        if (error instanceof VideoError && error.code === "transcript_unavailable") {
          // 사용자가 "설명으로 계속"을 고른 경우: 설명이 충분하면 그걸로 만듭니다.
          const description = normalizeLongText(videoMeta.description ?? "");
          if (body.allowDescriptionFallback && description.length >= MIN_TEXT_BY_SOURCE.youtube) {
            warnings.push(
              "유튜브 자막을 가져오지 못해 영상 설명으로 만들었습니다. 영상에서 말한 내용 전체가 아니라 설명에 적힌 내용만 반영됩니다.",
            );
            const source: SourceDocument = {
              sourceType: "youtube",
              title: videoMeta.title,
              author: videoMeta.channelTitle || "유튜브 채널",
              text: description,
              language: body.language,
              url: videoMeta.url,
              id: videoMeta.id,
              ...(videoMeta.durationSeconds !== undefined ? { durationSeconds: videoMeta.durationSeconds } : {}),
              ...(videoMeta.thumbnailUrl ? { thumbnailUrl: videoMeta.thumbnailUrl } : {}),
              segments: [],
              isAutoGenerated: false,
            };
            return {
              source,
              meta: {
                sourceType: "youtube",
                textChars: description.length,
                textSource: "description",
                fetchedUrl: videoMeta.url,
                imageCount: 0,
              },
              warnings,
            };
          }

          const canUseDescription = (videoMeta.description ?? "").trim().length >= MIN_TEXT_BY_SOURCE.youtube;
          throw new AppError(
            "transcript_unavailable",
            error.reason === "captions_blocked"
              ? "유튜브가 서버에서 자막 본문을 내려주지 않았습니다(자막 요청 차단). 유튜브에서 '스크립트 표시'를 열어 복사한 자막을 붙여넣으면 바로 만들 수 있습니다."
              : "이 영상의 자막을 자동으로 가져오지 못했습니다. '스크립트 표시'로 복사한 자막을 붙여넣으면 바로 만들 수 있습니다.",
            422,
            {
              reason: error.reason ?? "no_captions",
              nextActions: canUseDescription ? ["description", "paste"] : ["paste", "upload"],
              canUseDescription,
              title: videoMeta.title,
            },
          );
        }
        throw error;
      }
    }
  }

  const transcript = pasted.length >= MIN_TRANSCRIPT_CHARS
    ? transcriptFromText(pasted, body.language)
    : (autoTranscript ?? transcriptFromText(pasted, body.language));

  if (transcript.text.trim().length < 60) {
    throw new AppError(
      "transcript_unavailable",
      "자막이 너무 짧아 콘텐츠로 만들 수 없습니다. 내용이 있는 영상이나 더 긴 자막으로 시도해 주세요.",
      422,
      { reason: "too_short", nextActions: ["paste"] },
    );
  }

  const source: SourceDocument = {
    sourceType: "youtube",
    title: videoMeta?.title ?? body.title?.trim() ?? deriveTitle(transcript.text) ?? "유튜브 영상",
    author: videoMeta?.channelTitle ?? body.author?.trim() ?? "유튜브 채널",
    text: transcript.text,
    language: body.language,
    ...(videoMeta?.url ? { url: videoMeta.url } : {}),
    ...(videoMeta?.id ? { id: videoMeta.id } : {}),
    ...(videoMeta?.durationSeconds !== undefined ? { durationSeconds: videoMeta.durationSeconds } : {}),
    ...(videoMeta?.thumbnailUrl ? { thumbnailUrl: videoMeta.thumbnailUrl } : {}),
    segments: transcript.segments,
    isAutoGenerated: transcript.isAutoGenerated ?? false,
  };

  return {
    source,
    meta: {
      sourceType: "youtube",
      textChars: source.text.length,
      textSource: pasted.length >= MIN_TRANSCRIPT_CHARS ? "transcript" : "auto_transcript",
      fetchedUrl: videoMeta?.url ?? null,
      imageCount: 0,
    },
    warnings,
  };
}

async function resolveBlog(body: SourceRequestBody): Promise<ResolvedSource> {
  const pasted = normalizeLongText(body.text ?? "");
  const urlInput = body.url?.trim() ?? "";
  const warnings: string[] = [];

  if (pasted.length >= MIN_TEXT_BY_SOURCE.blog) {
    if (pasted.length < COMFORTABLE_BLOG_CHARS) {
      warnings.push("본문이 짧아 결과물의 근거가 제한적입니다. 소제목·사례를 조금 더 넣으면 결과가 좋아집니다.");
    }
    return {
      source: {
        sourceType: "blog",
        title: body.title?.trim() || deriveTitle(pasted) || "블로그 글",
        author: body.author?.trim() || hostOf(urlInput) || "블로그",
        text: pasted,
        language: body.language,
        ...(urlInput ? { url: urlInput } : {}),
        id: `blog-${shortHash(urlInput || pasted.slice(0, 80))}`,
      },
      meta: { sourceType: "blog", textChars: pasted.length, textSource: "pasted", fetchedUrl: urlInput || null, imageCount: 0 },
      warnings,
    };
  }

  if (!urlInput) {
    throw new AppError(
      "invalid_request",
      "블로그 글 주소를 넣거나, 글 본문을 붙여넣어 주세요(40자 이상).",
      400,
      { nextActions: ["paste"] },
    );
  }

  // 틱톡처럼 페이지 본문을 읽을 수 없는 곳은 oEmbed의 제목(캡션)으로 시도합니다.
  if (isTikTokHost(urlInput)) {
    const tiktok = await fetchTikTokOEmbed(urlInput);
    const text = normalizeLongText(tiktok?.title ?? pasted);
    if (text.length >= MIN_TEXT_BY_SOURCE.instagram) {
      warnings.push("틱톡 페이지는 로그인이 필요해 oEmbed의 캡션만으로 만들었습니다. 영상에서 말한 내용은 포함되지 않았습니다.");
      return {
        source: {
          sourceType: "blog",
          title: deriveTitle(text) ?? "틱톡 영상",
          author: tiktok?.authorName ? `@${tiktok.authorName}` : "틱톡",
          text,
          language: body.language,
          url: tiktok?.url ?? urlInput,
          id: `tiktok-${shortHash(tiktok?.url ?? urlInput)}`,
          ...(tiktok?.thumbnailUrl ? { imageUrls: [tiktok.thumbnailUrl] } : {}),
        },
        meta: {
          sourceType: "blog",
          textChars: text.length,
          textSource: "meta_caption",
          fetchedUrl: tiktok?.url ?? urlInput,
          imageCount: tiktok?.thumbnailUrl ? 1 : 0,
        },
        warnings,
      };
    }
    throw new AppError(
      "source_unavailable",
      "틱톡 영상의 설명을 충분히 읽지 못했습니다. 영상 설명·대본을 붙여넣거나, 영상 파일을 올려 주세요.",
      422,
      { reason: "caption_too_short", nextActions: ["paste", "upload"] },
    );
  }

  let page;
  try {
    page = await fetchPage(urlInput);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.code, error.message, error.status as 400 | 422, {
        ...(typeof error.details === "object" && error.details ? error.details : {}),
        nextActions: ["paste", "upload"],
      });
    }
    throw error;
  }
  const article = extractArticleFromHtml(page.html, page.finalUrl);
  const text = normalizeLongText(article.text);
  // 글에 실린 실제 사진(제품 컷)을 참조 이미지 후보로 남깁니다.
  const images = extractPageImages(page.html, page.finalUrl);

  if (text.length < 200) {
    throw new AppError(
      "source_unavailable",
      "이 주소에서 본문을 충분히 읽지 못했습니다. 글 본문을 직접 붙여넣으면 바로 만들 수 있습니다.",
      422,
      { reason: "text_too_short", nextActions: ["paste", "upload"] },
    );
  }

  if (text.length < COMFORTABLE_BLOG_CHARS) {
    warnings.push("본문이 짧아 결과물의 근거가 제한적입니다.");
  }

  return {
    source: {
      sourceType: "blog",
      title: body.title?.trim() || article.title || "블로그 글",
      author: body.author?.trim() || article.author || hostOf(page.finalUrl) || "블로그",
      text,
      language: body.language,
      url: page.finalUrl,
      id: `blog-${shortHash(page.finalUrl)}`,
      ...(images.length > 0 ? { imageUrls: images } : {}),
    },
    meta: { sourceType: "blog", textChars: text.length, textSource: "fetched", fetchedUrl: page.finalUrl, imageCount: images.length },
    warnings,
  };
}

async function resolveInstagram(body: SourceRequestBody): Promise<ResolvedSource> {
  const pasted = normalizeLongText(body.text ?? "");
  const urlInput = body.url?.trim() ?? "";
  const warnings: string[] = [];

  if (pasted.length >= MIN_TEXT_BY_SOURCE.instagram) {
    return {
      source: {
        sourceType: "instagram",
        title: body.title?.trim() || deriveTitle(pasted) || "인스타그램 게시물",
        author: body.author?.trim() || "인스타그램",
        text: pasted,
        language: body.language,
        ...(urlInput ? { url: urlInput } : {}),
        id: `ig-${shortHash(urlInput || pasted.slice(0, 80))}`,
      },
      meta: { sourceType: "instagram", textChars: pasted.length, textSource: "pasted", fetchedUrl: urlInput || null, imageCount: 0 },
      warnings,
    };
  }

  if (!urlInput) {
    throw new AppError(
      "invalid_request",
      "인스타그램 주소를 넣거나, 카드·캡션 텍스트를 붙여넣어 주세요(40자 이상).",
      400,
      { nextActions: ["paste", "upload"] },
    );
  }

  const parsed = parseInstagramUrl(urlInput);
  if (!parsed) {
    throw new AppError(
      "invalid_url",
      "인스타그램 게시물 주소를 확인해 주세요. 예: https://www.instagram.com/reel/… 또는 https://www.instagram.com/p/…",
      400,
      { reason: "invalid_url", nextActions: ["paste", "upload"] },
    );
  }

  const result = await fetchInstagramPost(urlInput);
  const post = result.post;

  if (!post) {
    const reason = result.reason ?? "not_found";
    throw new AppError(
      "source_unavailable",
      instagramFailMessage(reason),
      422,
      {
        reason,
        shortcode: result.shortcode ?? parsed.shortcode,
        nextActions: ["paste", "upload"],
        attempts: result.attempts,
      },
    );
  }

  const caption = normalizeLongText(post.caption);
  if (caption.length < MIN_TEXT_BY_SOURCE.instagram) {
    // 캡션이 없거나 짧은 릴스: 영상 음성으로 대본을 만들 수 있게 영상 주소를 넘겨 줍니다.
    throw new AppError(
      "source_unavailable",
      caption.length === 0
        ? "이 게시물에는 캡션이 없습니다. 릴스 영상의 음성으로 대본을 만들거나, 캡션·카드 문구를 붙여넣어 주세요."
        : "인스타그램에서 읽은 캡션이 너무 짧습니다(해시태그만 있는 경우가 많습니다). 릴스 음성으로 대본을 만들거나, 카드 문구를 붙여넣어 주세요.",
      422,
      {
        reason: "caption_too_short",
        shortcode: post.shortcode,
        caption,
        videoUrl: post.videoUrl,
        isVideo: post.isVideo,
        author: post.author,
        title: post.title,
        images: post.images,
        nextActions: post.videoUrl ? ["transcribe", "paste", "upload"] : ["paste", "upload"],
      },
    );
  }

  if (post.source === "page_meta") {
    warnings.push("인스타그램 로그인 벽 때문에 미리보기 설명만 읽었습니다. 카드 이미지 속 문구는 포함되지 않았습니다.");
  }
  if (post.source === "oembed") {
    warnings.push("인스타그램 oEmbed에서 캡션만 읽었습니다. 게시물 사진은 대표 이미지 1장만 참조합니다.");
  }
  if (post.images.length === 0) {
    warnings.push("게시물 사진을 자동으로 가져오지 못했습니다. 제품 사진 주소를 직접 넣으면 실제 패키지를 장면에 그대로 반영합니다.");
  } else {
    warnings.push(`게시물 사진 ${post.images.length}장을 영상 참조 이미지로 함께 넣었습니다.`);
  }

  return {
    source: {
      sourceType: "instagram",
      title: body.title?.trim() || post.title || "인스타그램 게시물",
      author: body.author?.trim() || post.author || "@instagram",
      text: caption,
      language: body.language,
      url: post.url,
      id: `ig-${shortHash(post.url)}`,
      ...(post.images.length > 0 ? { imageUrls: post.images } : {}),
    },
    meta: {
      sourceType: "instagram",
      textChars: caption.length,
      textSource: post.source === "embed" ? "embed_caption" : "meta_caption",
      fetchedUrl: post.url,
      imageCount: post.images.length,
    },
    warnings,
  };
}

/** 인스타그램을 못 읽은 이유별 안내(원인을 사용자가 알 수 있게 구분합니다). */
function instagramFailMessage(reason: InstagramFailReason): string {
  switch (reason) {
    case "login_required":
      return "인스타그램이 로그인 화면만 내려줘 게시물을 읽지 못했습니다. 캡션을 복사해 붙여넣거나, 영상 파일을 올리면 그대로 이어서 만들 수 있습니다.";
    case "invalid_url":
      return "인스타그램 게시물 주소를 확인해 주세요. 예: https://www.instagram.com/reel/…";
    case "share_unresolved":
      return "인스타그램 공유(단축) 링크를 게시물 주소로 풀지 못했습니다. 게시물을 연 뒤 주소창의 …/reel/… 주소를 다시 넣거나, 캡션을 붙여넣어 주세요.";
    case "private":
      return "비공개 계정의 게시물이라 서버가 읽을 수 없습니다. 비공개 게시물은 로그인한 사람만 볼 수 있어요. 캡션을 붙여넣거나 영상 파일을 올려 주세요.";
    case "age_restricted":
      return "인스타그램이 이 게시물을 연령 제한(로그인 필요)으로 표시해 서버에서 읽을 수 없습니다. 캡션을 붙여넣거나 영상 파일을 올려 주세요.";
    case "blocked":
      return "인스타그램이 서버 요청에는 게시물 내용을 내려주지 않았습니다(일시 차단·점검일 수 있음). 잠시 뒤 '다시 시도'를 눌러 보시고, 계속 안 되면 캡션을 붙여넣거나 영상 파일을 올려 주세요.";
    case "not_found":
    default:
      return "게시물을 읽지 못했습니다. 삭제됐거나 주소가 잘못된 게시물일 수 있습니다. 캡션을 붙여넣거나 영상 파일을 올려 주세요.";
  }
}

function normalizeLongText(text: string): string {
  const normalized = normalizeTranscriptInput(text);
  return normalized.length > MAX_TEXT_CHARS ? normalized.slice(0, MAX_TEXT_CHARS) : normalized;
}

export function deriveTitle(text: string): string | null {
  const firstLine = text
    .split("\n")
    .map((line) => line.replace(/^#{1,6}\s*/, "").trim())
    .find((line) => line.length >= 4);
  if (!firstLine) return null;
  return firstLine.slice(0, 100);
}

function hostOf(url: string): string | null {
  try {
    return new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

function isTikTokHost(url: string): boolean {
  try {
    const host = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase();
    return host === "tiktok.com" || host.endsWith(".tiktok.com");
  } catch {
    return false;
  }
}

interface TikTokOEmbed {
  title: string | null;
  authorName: string | null;
  thumbnailUrl: string | null;
  url: string;
}

/** 틱톡 oEmbed(키 없이 공개). 제목 자리에 캡션이 오는 경우가 많습니다. */
export async function fetchTikTokOEmbed(url: string, fetchImpl: typeof fetch = fetch): Promise<TikTokOEmbed | null> {
  try {
    const response = await fetchImpl(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; taest/1.0)" },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return null;
    const data = (await response.json()) as {
      title?: string;
      author_name?: string;
      thumbnail_url?: string;
    };
    return {
      title: data.title?.trim() || null,
      authorName: data.author_name?.trim() || null,
      thumbnailUrl: data.thumbnail_url?.trim() || null,
      url,
    };
  } catch {
    return null;
  }
}

function shortHash(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }
  return Math.abs(hash).toString(36).padStart(6, "0");
}
