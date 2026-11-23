import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { isValidUserId, requireAdmin } from "@/lib/auth/guard";
import { RESET_TTL_MINUTES, appOrigin, createResetToken, resetExpiresAt, resetUrl } from "@/lib/auth/reset";
import { mailStatus, resetMailBody, sendMail } from "@/lib/mail";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 대기 중인 비밀번호 재설정 요청(메일 발송 키가 없을 때 관리자가 직접 처리). */
export async function GET() {
  try {
    await requireAdmin();
    const { store } = getRuntime();
    const requests = await store.listPendingPasswordResets(50);
    return NextResponse.json({ requests, mail: mailStatus() });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}

const schema = z.object({
  userId: z.string(),
  /** true면 RESEND_API_KEY가 있을 때 회원 이메일로도 보냅니다. */
  sendMail: z.boolean().optional(),
});

/**
 * 관리자가 회원의 일회용 재설정 링크를 발급합니다.
 * 메일 발송 키가 없으면 이 링크를 카톡·문자·메일로 직접 전달하면 됩니다.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_request", "회원을 확인해 주세요.", 400);

    const { userId, sendMail: wantMail } = parsed.data;
    if (!isValidUserId(userId)) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);

    const { store } = getRuntime();
    const user = await store.getUser(userId);
    if (!user) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);
    if (!user.hasPassword && user.signupProvider !== "guest") {
      throw new AppError(
        "conflict",
        `${user.email ?? "이 회원"}은(는) ${user.signupProvider === "naver" ? "네이버" : "카카오"}로 가입한 계정이라 비밀번호가 없습니다. 소셜 로그인으로 안내하거나, 아래 '임시 비밀번호 지정'을 써 주세요.`,
        409,
      );
    }

    const mail = mailStatus();
    await store.invalidatePasswordResets(user.id).catch(() => 0);
    const { token, tokenHash } = createResetToken();
    const expiresAt = resetExpiresAt();
    const deliverByMail = Boolean(wantMail) && mail.configured && Boolean(user.email);

    await store.createPasswordReset({
      userId: user.id,
      tokenHash,
      expiresAt,
      delivery: deliverByMail ? "email" : "link",
      requestedIp: null,
    });

    const link = resetUrl(appOrigin(request), token);
    let mailed = false;
    if (deliverByMail && user.email) {
      const body = resetMailBody({ link, displayName: user.displayName, expiresMinutes: RESET_TTL_MINUTES });
      const result = await sendMail({ to: user.email, subject: "[taest] 비밀번호 재설정 안내", ...body });
      mailed = result.ok;
      if (!result.ok) console.warn("[admin/password-resets] 메일 발송 실패", result.error);
    }

    await store
      .recordAdminAction({
        adminUserId: admin.id,
        action: "user.password_reset_link",
        targetUserId: user.id,
        reason: mailed ? "관리자 링크 발급 + 메일 발송" : "관리자 링크 발급",
        metadata: { mail: mailed, ttlMinutes: RESET_TTL_MINUTES },
      })
      .catch(() => undefined);

    return NextResponse.json({
      userId: user.id,
      email: user.email,
      link,
      expiresAt,
      ttlMinutes: RESET_TTL_MINUTES,
      mailed,
      mailConfigured: mail.configured,
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
