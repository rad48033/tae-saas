import { hashApiKey, safeEqual, type Store } from "@tae/db";
import type { MiddlewareHandler } from "hono";

import { ApiError } from "../lib/errors";
import type { AppEnv } from "../types";

function extractSecret(authorization: string | undefined, apiKeyHeader: string | undefined): string | null {
  if (apiKeyHeader?.trim()) return apiKeyHeader.trim();
  if (!authorization) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorization.trim());
  return match?.[1]?.trim() ?? null;
}

/**
 * API 키 인증. 키는 해시로만 조회하며, 평문은 저장하지 않습니다.
 * Authorization: Bearer tae_live_... 또는 X-API-Key 헤더를 받습니다.
 */
export function createApiKeyAuth(store: Store): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const secret = extractSecret(c.req.header("authorization"), c.req.header("x-api-key"));
    if (!secret) {
      throw new ApiError("unauthorized", "API 키가 필요합니다. Authorization: Bearer tae_live_... 형식으로 보내주세요.", 401);
    }
    if (!secret.startsWith("tae_live_")) {
      throw new ApiError("unauthorized", "API 키 형식이 올바르지 않습니다.", 401);
    }

    const record = await store.findApiKeyByHash(hashApiKey(secret));
    if (!record) {
      throw new ApiError("unauthorized", "유효하지 않거나 폐기된 API 키입니다.", 401);
    }

    const user = await store.getUser(record.userId);
    if (!user) {
      throw new ApiError("unauthorized", "API 키에 연결된 사용자가 없습니다.", 401);
    }

    c.set("user", user);
    c.set("apiKey", record);
    void store.touchApiKey(record.id).catch(() => undefined);

    await next();
  };
}

/**
 * 관리자 전용 엔드포인트(/v1/keys). PDF_API_ADMIN_TOKEN과 상수 시간 비교합니다.
 */
export function createAdminAuth(adminToken: string | null): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    if (!adminToken) {
      throw new ApiError("forbidden", "PDF_API_ADMIN_TOKEN이 설정되지 않아 키 발급이 비활성화되어 있습니다.", 403);
    }

    const provided = extractSecret(c.req.header("authorization"), c.req.header("x-admin-token"));
    if (!provided || !safeEqual(provided, adminToken)) {
      throw new ApiError("unauthorized", "관리자 토큰이 올바르지 않습니다.", 401);
    }

    await next();
  };
}
