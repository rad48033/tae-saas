import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { requireUser, setSessionCookie } from "@/lib/auth/guard";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  currentPassword: z.string().max(200).optional(),
  newPassword: z.string().min(8).max(128),
});

/**
 * 로그인한 상태에서 비밀번호를 바꿉니다.
 *  - 비밀번호가 있는 계정: 현재 비밀번호 확인 필요
 *  - 소셜 전용 계정(hasPassword=false): 이메일이 있으면 여기서 비밀번호를 새로 붙일 수 있습니다.
 * 성공하면 새 세션 쿠키를 발급해 다른 기기의 예전 세션은 만료시킵니다.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    enforceRateLimit(`password:${user.id}`, { limit: 10, windowMs: 60 * 60 * 1000 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "새 비밀번호를 8자 이상으로 입력해 주세요.", 400);
    }

    const problem = passwordProblem(parsed.data.newPassword);
    if (problem) throw new AppError("weak_password", problem, 400);

    if (!user.email) {
      throw new AppError(
        "invalid_request",
        "이 계정에는 이메일이 없어 비밀번호를 붙일 수 없습니다. 네이버·카카오로 계속 로그인해 주세요.",
        400,
      );
    }

    const { store } = getRuntime();
    const credentials = await store.getUserCredentials(user.email);
    if (user.hasPassword) {
      if (!parsed.data.currentPassword) {
        throw new AppError("invalid_credentials", "현재 비밀번호를 입력해 주세요.", 400);
      }
      if (!credentials || !verifyPassword(parsed.data.currentPassword, credentials.passwordHash)) {
        throw new AppError("invalid_credentials", "현재 비밀번호가 맞지 않습니다.", 401);
      }
      if (parsed.data.currentPassword === parsed.data.newPassword) {
        throw new AppError("invalid_request", "지금 쓰는 비밀번호와 다른 비밀번호로 정해 주세요.", 400);
      }
    }

    const updated = await store.updateUser(user.id, {
      passwordHash: hashPassword(parsed.data.newPassword),
      passwordChangedAt: new Date().toISOString(),
      ...(user.signupProvider === "guest" || user.signupProvider !== "email" ? { signupProvider: "email" as const } : {}),
    });
    await store.invalidatePasswordResets(user.id).catch(() => 0);
    await setSessionCookie(updated.id, { maxAgeSeconds: 60 * 60 * 24 * 30 });

    return NextResponse.json({
      ok: true,
      hasPassword: updated.hasPassword,
      message: "비밀번호를 바꿨습니다. 다른 기기에서는 다시 로그인해야 합니다.",
    });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[auth/password]", error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
