import { AppError } from "./app-error";

interface Bucket {
  timestamps: number[];
}

const globalBuckets = globalThis as unknown as { __taeRateBuckets?: Map<string, Bucket> };

function buckets(): Map<string, Bucket> {
  globalBuckets.__taeRateBuckets ??= new Map();
  return globalBuckets.__taeRateBuckets;
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSeconds: number;
}

/** 인스턴스 단위 슬라이딩 윈도우. 서버리스에서는 인스턴스마다 따로 셉니다. */
export function checkRateLimit(
  key: string,
  options: { limit: number; windowMs: number } = { limit: 20, windowMs: 60 * 60 * 1000 },
): RateLimitResult {
  const store = buckets();
  const now = Date.now();
  const windowStart = now - options.windowMs;
  const bucket = store.get(key) ?? { timestamps: [] };
  const recent = bucket.timestamps.filter((timestamp) => timestamp > windowStart);

  if (recent.length >= options.limit) {
    const oldest = recent[0] ?? now;
    return { ok: false, retryAfterSeconds: Math.max(1, Math.ceil((oldest + options.windowMs - now) / 1000)) };
  }

  recent.push(now);
  store.set(key, { timestamps: recent });
  return { ok: true, retryAfterSeconds: 0 };
}

export function enforceRateLimit(
  key: string,
  options: { limit: number; windowMs: number } = { limit: 20, windowMs: 60 * 60 * 1000 },
): void {
  const result = checkRateLimit(key, options);
  if (!result.ok) {
    throw new AppError(
      "rate_limited",
      `요청이 너무 많습니다. ${Math.ceil(result.retryAfterSeconds / 60)}분 후 다시 시도해 주세요.`,
      429,
    );
  }
}
