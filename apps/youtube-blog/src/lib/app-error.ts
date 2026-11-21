import { AiResponseError } from "@tae/ai";
import { BillingError } from "@tae/stripe";

import { VideoError } from "./youtube";

export type AppErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "video_unavailable"
  | "transcript_unavailable"
  | "source_unavailable"
  | "fetch_failed"
  | "video_render_unavailable"
  | "video_failed"
  | "insufficient_credits"
  | "rate_limited"
  | "ai_failed"
  | "billing_not_configured"
  | "payload_too_large"
  | "internal_error";

export class AppError extends Error {
  constructor(
    readonly code: AppErrorCode,
    message: string,
    readonly status: 400 | 401 | 402 | 404 | 422 | 429 | 500 | 502 | 503 = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

const VIDEO_STATUS: Record<VideoError["code"], 400 | 422 | 502> = {
  invalid_url: 400,
  video_unavailable: 422,
  transcript_unavailable: 422,
  fetch_failed: 502,
};

/** 라우트 핸들러에서 던진 모든 오류를 응답 형태로 정규화합니다. */
export function toApiError(error: unknown): AppError {
  if (error instanceof AppError) return error;

  if (error instanceof VideoError) {
    return new AppError(error.code, error.message, VIDEO_STATUS[error.code]);
  }

  if (error instanceof AiResponseError) {
    return new AppError("ai_failed", "AI가 요청한 형식의 결과를 만들지 못했습니다. 잠시 후 다시 시도해 주세요.", 502);
  }

  if (error instanceof BillingError) {
    if (error.code === "not_configured") {
      return new AppError("billing_not_configured", error.message, 503);
    }
    return new AppError("internal_error", error.message, 502);
  }

  if (error instanceof Error && /aborted|timeout/i.test(error.message)) {
    return new AppError("ai_failed", "응답 시간이 초과되었습니다. 잠시 후 다시 시도해 주세요.", 502);
  }

  return new AppError("internal_error", "알 수 없는 오류가 발생했습니다.", 500);
}
