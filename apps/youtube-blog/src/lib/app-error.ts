import { AiResponseError } from "@tae/ai";
import { BillingError } from "@tae/stripe";

import { VideoError } from "./youtube";

export type AppErrorCode =
  | "invalid_request"
  | "invalid_url"
  | "invalid_email"
  | "weak_password"
  | "email_taken"
  | "invalid_credentials"
  | "reset_token_invalid"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "oauth_not_configured"
  | "video_unavailable"
  | "transcript_unavailable"
  | "source_unavailable"
  | "upload_unavailable"
  | "upload_unsupported"
  | "file_too_large"
  | "stt_unavailable"
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
    readonly status: 400 | 401 | 402 | 403 | 404 | 409 | 413 | 422 | 429 | 500 | 502 | 503 = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }

  /** API 응답 본문과 같은 모양 */
  toJSON(): { code: AppErrorCode; message: string; details: unknown } {
    return { code: this.code, message: this.message, details: this.details ?? null };
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
    if (error.code === "transcript_unavailable") {
      return new AppError("transcript_unavailable", error.message, 422, {
        reason: error.reason ?? "no_captions",
        nextActions: ["paste", "description"],
      });
    }
    if (error.code === "video_unavailable") {
      return new AppError("video_unavailable", error.message, 422, {
        reason: error.reason ?? "deleted",
        nextActions: ["paste", "upload"],
      });
    }
    return new AppError(error.code, error.message, VIDEO_STATUS[error.code], {
      reason: error.reason ?? null,
      nextActions: ["paste", "upload"],
    });
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

  // 제공자 쿼터(429)나 키 문제는 사용자에게 원인이 보이게 따로 안내합니다.
  if (error instanceof Error && /quota|RESOURCE_EXHAUSTED|rate limit|429/i.test(error.message)) {
    return new AppError(
      "ai_failed",
      "AI 사용량이 한도에 걸렸습니다(제공자 쿼터 초과). 잠시 후 다시 시도하거나 설정 탭에서 다른 AI 제공자를 연결해 주세요.",
      429,
      { reason: "ai_quota", nextActions: ["retry", "wait"] },
    );
  }

  if (error instanceof Error && /api key|unauthorized|401|403|invalid.*key/i.test(error.message)) {
    return new AppError("ai_failed", "AI 키가 유효하지 않습니다. 서버의 API 키 설정을 확인해 주세요.", 502);
  }

  return new AppError("internal_error", "알 수 없는 오류가 발생했습니다.", 500);
}
