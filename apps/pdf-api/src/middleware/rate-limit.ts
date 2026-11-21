import type { MiddlewareHandler } from "hono";

import { ApiError } from "../lib/errors";
import type { AppEnv } from "../types";

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

/**
 * 인스턴스 메모리 기반 슬라이딩 윈도우 제한.
 * 서버리스에서는 인스턴스마다 따로 계산되므로, 엄격한 제한이 필요하면
 * Upstash Redis 같은 공유 저장소로 교체하세요.
 */
export function createRateLimiter(options: RateLimitOptions): MiddlewareHandler<AppEnv> {
  const hits = new Map<string, number[]>();
  const maxKeys = 5_000;

  return async (c, next) => {
    const key = c.get("apiKey")?.id ?? "anonymous";
    const now = Date.now();
    const windowStart = now - options.windowMs;

    const recent = (hits.get(key) ?? []).filter((timestamp) => timestamp > windowStart);

    if (recent.length >= options.limit) {
      const oldest = recent[0] ?? now;
      const retryAfter = Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000));
      c.header("Retry-After", String(retryAfter));
      throw new ApiError("rate_limited", `요청이 너무 많습니다. ${retryAfter}초 후 다시 시도해 주세요.`, 429, {
        limit: options.limit,
        windowSeconds: Math.round(options.windowMs / 1000),
        retryAfterSeconds: retryAfter,
      });
    }

    recent.push(now);
    hits.set(key, recent);

    if (hits.size > maxKeys) {
      for (const [existingKey, timestamps] of hits) {
        if (timestamps.every((timestamp) => timestamp <= windowStart)) hits.delete(existingKey);
      }
    }

    await next();
  };
}
