import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { requireUser } from "@/lib/auth/guard";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";
import { storageStatus } from "@/lib/storage";
import { sttStatus } from "@/lib/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 업로드 안내(앱 화면에서 쓸 수 있는 설정 상태). */
export async function GET() {
  const storage = storageStatus();
  const stt = sttStatus();
  return NextResponse.json({
    storage: { configured: storage.configured, reason: storage.reason },
    stt: { configured: stt.configured, provider: stt.provider, model: stt.model, reason: stt.reason },
    store: getRuntime().storeMode,
  });
}

const schema = z.object({
  filename: z.string().max(200).optional(),
  mimeType: z.string().max(120).optional(),
  size: z.number().int().nonnegative().optional(),
});

/** 브라우저가 Storage로 직접 올릴 서명 URL을 발급합니다(Vercel 4.5MB 본문 제한 우회). */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    enforceRateLimit(`upload-sign:${user.id}`, { limit: 20, windowMs: 60 * 60 * 1000 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_request", "업로드 요청 형식이 올바르지 않습니다.", 400);

    const { checkUpload, createSignedUpload, MAX_UPLOAD_BYTES, storageStatus } = await import("@/lib/storage");
    const storage = storageStatus();
    if (!storage.configured) {
      throw new AppError("upload_unavailable", storage.reason ?? "업로드 저장소가 설정되지 않았습니다.", 503, {
        nextActions: ["paste"],
      });
    }

    const checked = checkUpload({
      filename: parsed.data.filename ?? "video.mp4",
      mimeType: parsed.data.mimeType ?? "",
      size: parsed.data.size ?? 0,
    });
    if (!checked) {
      throw new AppError(
        "upload_unsupported",
        "지원하지 않는 파일 형식입니다. mp4·mov·webm(영상) 또는 mp3·m4a·wav(음성)를 올려 주세요.",
        400,
        { nextActions: ["upload", "paste"] },
      );
    }
    if (typeof parsed.data.size === "number" && parsed.data.size > MAX_UPLOAD_BYTES) {
      throw new AppError(
        "file_too_large",
        `파일이 너무 큽니다(${Math.round(parsed.data.size / 1024 / 1024)}MB). 24MB 이하(약 1~3분 분량)로 올려 주세요.`,
        413,
        { maxBytes: MAX_UPLOAD_BYTES, nextActions: ["upload", "paste"] },
      );
    }

    const signed = await createSignedUpload(user.id, checked);
    return NextResponse.json({
      ...signed,
      maxBytes: MAX_UPLOAD_BYTES,
      contentType: checked.mime,
      stt: sttStatus(),
    });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[uploads/sign]", error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
