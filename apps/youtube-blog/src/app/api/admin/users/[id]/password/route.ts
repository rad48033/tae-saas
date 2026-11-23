import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { isValidUserId, requireAdmin } from "@/lib/auth/guard";
import { hashPassword, passwordProblem } from "@/lib/auth/password";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  password: z.string().max(128),
});

/**
 * 관리자가 회원의 비밀번호를 임시 비밀번호로 바꿉니다(메일 발송이 안 될 때의 최후 수단).
 * 바꾼 뒤에는 그 회원의 예전 세션이 모두 만료되고, 남은 재설정 링크도 폐기됩니다.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    if (!isValidUserId(id)) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_request", "새 비밀번호를 입력해 주세요.", 400);
    const problem = passwordProblem(parsed.data.password);
    if (problem) throw new AppError("weak_password", problem, 400);

    const { store } = getRuntime();
    const target = await store.getUser(id);
    if (!target) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);

    const updated = await store.updateUser(id, {
      passwordHash: hashPassword(parsed.data.password),
      passwordChangedAt: new Date().toISOString(),
      ...(target.signupProvider === "guest" ? { signupProvider: "email" as const } : {}),
    });
    await store.invalidatePasswordResets(id).catch(() => 0);

    await store
      .recordAdminAction({
        adminUserId: admin.id,
        action: "user.password_set",
        targetUserId: id,
        reason: "관리자 임시 비밀번호 지정",
        metadata: { email: target.email },
      })
      .catch(() => undefined);

    return NextResponse.json({
      userId: updated.id,
      email: updated.email,
      hasPassword: updated.hasPassword,
      message: "임시 비밀번호로 변경했습니다. 회원에게 직접 전달하고, 로그인 후 '설정'에서 바꾸도록 안내해 주세요.",
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
