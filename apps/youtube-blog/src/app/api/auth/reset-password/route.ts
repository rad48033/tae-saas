import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { sessionUserView, setSessionCookie } from "@/lib/auth/guard";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { hashResetToken, looksLikeResetToken } from "@/lib/auth/reset";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  token: z.string().min(20).max(200),
  password: z.string().min(8).max(128),
});

/**
 * 비밀번호 재설정 2단계: 토큰 + 새 비밀번호.
 * 토큰은 한 번만 쓸 수 있고(만료 60분), 성공하면 그 자리에서 로그인 상태로 바꿉니다.
 * 비밀번호를 바꾼 시각을 남겨 예전 기기의 세션은 자동으로 만료시킵니다.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    enforceRateLimit(`reset:${ip}`, { limit: 20, windowMs: 60 * 60 * 1000 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "새 비밀번호를 8자 이상으로 입력해 주세요.", 400);
    }

    const token = parsed.data.token.trim();
    if (!looksLikeResetToken(token)) {
      throw new AppError(
        "reset_token_invalid",
        "재설정 링크가 올바르지 않습니다. 비밀번호 찾기를 다시 진행해 주세요.",
        400,
      );
    }

    const problem = passwordProblem(parsed.data.password);
    if (problem) throw new AppError("weak_password", problem, 400);

    const { store } = getRuntime();
    const consumed = await store.consumePasswordReset(hashResetToken(token));
    if (!consumed) {
      throw new AppError(
        "reset_token_invalid",
        "링크가 만료되었거나 이미 사용되었습니다. 비밀번호 찾기를 다시 진행해 주세요.",
        400,
      );
    }

    const user = await store.getUser(consumed.userId);
    if (!user) {
      throw new AppError("reset_token_invalid", "계정을 찾을 수 없습니다. 비밀번호 찾기를 다시 진행해 주세요.", 400);
    }

    const changedAt = new Date().toISOString();
    const updated = await store.updateUser(user.id, {
      passwordHash: hashPassword(parsed.data.password),
      passwordChangedAt: changedAt,
      // 소셜로만 가입했던 계정에 비밀번호를 붙이는 경우에도 이메일 로그인이 가능해집니다.
      ...(user.signupProvider === "guest" ? { signupProvider: "email" as const } : {}),
    });

    // 남은 재설정 링크도 모두 폐기합니다.
    await store.invalidatePasswordResets(user.id).catch(() => 0);

    await store
      .recordAdminAction({
        adminUserId: user.id,
        action: "user.password_reset",
        targetUserId: user.id,
        reason: "본인 비밀번호 재설정(메일 링크)",
        metadata: { delivery: consumed.delivery },
      })
      .catch(() => undefined);

    // 새 세션으로 바로 로그인시킵니다.
    await setSessionCookie(updated.id, { maxAgeSeconds: 60 * 60 * 24 * 30 });

    return NextResponse.json({ user: sessionUserView(updated), signedIn: true });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[auth/reset-password]", error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}

function clientIp(request: Request): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    request.headers.get("x-real-ip") ||
    "unknown"
  );
}
