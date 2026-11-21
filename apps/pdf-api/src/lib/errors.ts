export type ApiErrorCode =
  | "unauthorized"
  | "forbidden"
  | "invalid_request"
  | "payload_too_large"
  | "unsupported_media_type"
  | "insufficient_credits"
  | "pdf_parse_failed"
  | "ai_failed"
  | "rate_limited"
  | "not_found"
  | "internal_error";

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: 400 | 401 | 402 | 403 | 404 | 413 | 415 | 422 | 429 | 500 | 502 | 503 | 504 = 400,
    readonly details?: unknown,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export function toErrorResponse(error: ApiError, requestId: string) {
  return {
    error: {
      code: error.code,
      message: error.message,
      ...(error.details === undefined ? {} : { details: error.details }),
      requestId,
    },
  };
}
