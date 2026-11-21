import { NextResponse } from "next/server";
import { z } from "zod";

import { storyboardSchema, type Storyboard } from "@tae/video";

import { AppError, toApiError } from "@/lib/app-error";
import { enforceRateLimit } from "@/lib/rate-limit";
import { ensureUser } from "@/lib/session";
import { startVideoRender } from "@/lib/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const requestSchema = z.object({
  storyboard: storyboardSchema,
  quality: z.enum(["preview", "final"]).default("final"),
});

/**
 * 스토리보드를 받아 MP4 렌더 작업을 시작합니다.
 * 워커(VIDEO_WORKER_URL)가 있으면 워커 큐에, 없으면 로컬 인라인 모드로 실행합니다.
 */
export async function POST(request: Request) {
  try {
    const { user } = await ensureUser();
    enforceRateLimit(`video-render:${user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });

    const parsed = requestSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "스토리보드 형식이 올바르지 않습니다.", 400, parsed.error.issues.slice(0, 8));
    }

    const started = await startVideoRender(parsed.data.storyboard as Storyboard, { quality: parsed.data.quality });
    return NextResponse.json(started, { status: 202 });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      { error: { code: apiError.code, message: apiError.message } },
      { status: apiError.status },
    );
  }
}
