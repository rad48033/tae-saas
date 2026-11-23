import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { requireUser } from "@/lib/auth/guard";
import { enforceRateLimit } from "@/lib/rate-limit";
import { cleanTranscript, sttStatus, transcribeMedia } from "@/lib/stt";
import { MAX_UPLOAD_BYTES, downloadObject, isOwnUploadPath, removeObject } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const schema = z.object({
  /** Storage에 올린 객체 경로(<userId>/<uuid>.<ext>) */
  path: z.string().max(300).optional(),
  /** 인스타 릴스 CDN 주소(캡션이 없을 때 영상 음성으로 대본을 만드는 경로) */
  sourceUrl: z.string().max(2000).optional(),
  filename: z.string().max(200).optional(),
  mimeType: z.string().max(120).optional(),
  language: z.enum(["ko", "en"]).default("ko"),
});

/** 인스타 CDN만 허용(임의 주소를 서버가 대신 내려받는 SSRF를 막습니다). */
function isAllowedMediaHost(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return false;
    const host = url.hostname.toLowerCase();
    return (
      host === "cdninstagram.com" ||
      host.endsWith(".cdninstagram.com") ||
      host.endsWith(".fbcdn.net") ||
      host.endsWith(".tiktokcdn.com") ||
      host.endsWith(".tiktokcdn-us.com") ||
      host.endsWith(".akamaized.net")
    );
  } catch {
    return false;
  }
}

/**
 * 영상·음성 파일을 대본으로 바꿉니다.
 *  - path      : 브라우저가 Storage로 직접 올린 파일(권장)
 *  - sourceUrl : 인스타 릴스 영상 주소(캡션이 없거나 짧을 때)
 * 전사 결과는 저장하지 않고 응답으로만 돌려줍니다.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    enforceRateLimit(`transcribe:${user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "전사 요청 형식이 올바르지 않습니다.", 400);
    }

    const stt = sttStatus();
    if (!stt.configured) {
      throw new AppError("stt_unavailable", stt.reason ?? "전사 기능이 꺼져 있습니다.", 503, {
        nextActions: ["paste"],
      });
    }

    const { path, sourceUrl } = parsed.data;
    let bytes: Buffer;
    let filename: string;
    let mimeType: string;
    let cleanedPath: string | null = null;

    if (path) {
      if (!isOwnUploadPath(path, user.id)) {
        throw new AppError("forbidden", "다른 사용자가 올린 파일은 읽을 수 없습니다.", 403);
      }
      const object = await downloadObject(path);
      if (!object) {
        throw new AppError(
          "upload_unavailable",
          "업로드한 파일을 찾지 못했습니다(업로드가 끝나지 않았거나 만료됨). 다시 올려 주세요.",
          422,
          { nextActions: ["upload", "paste"] },
        );
      }
      bytes = object.body;
      filename = parsed.data.filename ?? path.split("/").pop() ?? "video.mp4";
      mimeType = parsed.data.mimeType ?? object.contentType;
      cleanedPath = path;
    } else if (sourceUrl) {
      if (!isAllowedMediaHost(sourceUrl)) {
        throw new AppError(
          "invalid_url",
          "영상 주소를 확인할 수 없습니다. 영상 파일을 직접 올리거나 캡션을 붙여넣어 주세요.",
          400,
          { nextActions: ["upload", "paste"] },
        );
      }
      const downloaded = await downloadMedia(sourceUrl);
      bytes = downloaded.body;
      mimeType = downloaded.contentType;
      filename = downloaded.filename;
    } else {
      throw new AppError("invalid_request", "업로드한 파일 경로나 영상 주소가 필요합니다.", 400);
    }

    if (bytes.byteLength > MAX_UPLOAD_BYTES) {
      throw new AppError(
        "file_too_large",
        `파일이 너무 큽니다(${Math.round(bytes.byteLength / 1024 / 1024)}MB). 24MB 이하로 올리거나 1~3분 분량으로 잘라 주세요.`,
        413,
        { maxBytes: MAX_UPLOAD_BYTES, nextActions: ["upload", "paste"] },
      );
    }

    const result = await transcribeMedia(
      { bytes, filename, mimeType, language: parsed.data.language },
      { env: process.env },
    );

    if (cleanedPath) await removeObject(cleanedPath);

    return NextResponse.json({
      text: cleanTranscript(result.text),
      chars: result.text.length,
      provider: result.provider,
      model: result.model,
      language: result.language,
      seconds: result.seconds,
      warnings: [
        `${result.provider === "openai" ? "Whisper" : "Gemini"}로 영상 음성을 받아 적었습니다. 발음이 흐린 고유명사·숫자는 한 번 확인해 주세요.`,
      ],
    });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[video/transcribe]", error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}

async function downloadMedia(url: string): Promise<{ body: Buffer; contentType: string; filename: string }> {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
      accept: "*/*",
    },
    signal: AbortSignal.timeout(60_000),
  }).catch(() => null);

  if (!response || !response.ok) {
    throw new AppError(
      "source_unavailable",
      "영상 파일을 내려받지 못했습니다(만료된 주소일 수 있습니다). 영상 파일을 직접 올려 주세요.",
      422,
      { nextActions: ["upload", "paste"] },
    );
  }

  const length = Number(response.headers.get("content-length") ?? "0");
  if (length > MAX_UPLOAD_BYTES) {
    throw new AppError(
      "file_too_large",
      `영상이 너무 큽니다(${Math.round(length / 1024 / 1024)}MB). 영상 파일을 1~3분 분량으로 잘라 올려 주세요.`,
      413,
      { nextActions: ["upload", "paste"] },
    );
  }

  const body = Buffer.from(await response.arrayBuffer());
  const contentType = response.headers.get("content-type") ?? "video/mp4";
  return { body, contentType: contentType.split(";")[0]?.trim() || "video/mp4", filename: "reel.mp4" };
}
