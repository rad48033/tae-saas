import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { isValidEmail, normalizeEmail } from "@/lib/auth/password";
import {
  RESET_TTL_MINUTES,
  appOrigin,
  createResetToken,
  resetExpiresAt,
  resetUrl,
} from "@/lib/auth/reset";
import { mailStatus, resetMailBody, sendMail } from "@/lib/mail";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().max(254),
});

const SUPPORT_EMAIL = "rad48033@gmail.com";

/**
 * 비밀번호 찾기 1단계.
 *
 * 응답은 항상 같은 모양입니다(가입 여부·소셜 전용 여부를 응답만으로 알아내지 못하게).
 *  - status "sent"        : 메일로 재설정 링크를 보냈습니다.
 *  - status "queued_admin": 메일 발송 키가 없어 관리자 확인 후 링크를 전달합니다.
 */
export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    enforceRateLimit(`forgot:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "이메일을 입력해 주세요.", 400);
    }

    const email = normalizeEmail(parsed.data.email);
    if (!isValidEmail(email)) {
      throw new AppError("invalid_email", "올바른 이메일 주소를 입력해 주세요.", 400);
    }
    enforceRateLimit(`forgot:mail:${email}`, { limit: 3, windowMs: 15 * 60 * 1000 });

    const { store } = getRuntime();
    const mail = mailStatus();
    const user = await store.findUserByEmail(email);
    const origin = appOrigin(request);

    const base = {
      ttlMinutes: RESET_TTL_MINUTES,
      mailConfigured: mail.configured,
      supportEmail: SUPPORT_EMAIL,
    };

    // 계정이 없거나, 비밀번호 없이 소셜로만 가입한 계정: 같은 안내를 돌려줍니다.
    if (!user || !user.hasPassword) {
      return NextResponse.json({
        ...base,
        status: "check_email",
        message: mail.configured
          ? "비밀번호로 로그인하는 계정이 있으면 재설정 링크를 메일로 보냈습니다. 네이버·카카오로 가입한 계정이라면 아래 버튼으로 로그인해 주세요."
          : "이메일과 비밀번호로 가입한 계정이면 재설정 요청이 접수됩니다. 네이버·카카오로 가입한 계정은 비밀번호가 없어 소셜 로그인으로 들어가야 합니다.",
        reached: false,
      });
    }

    // 새 링크를 만들면 이전 링크는 즉시 무효화합니다(살아 있는 링크는 하나만).
    await store.invalidatePasswordResets(user.id).catch(() => 0);
    const { token, tokenHash } = createResetToken();
    const expiresAt = resetExpiresAt();
    const delivery = mail.configured ? "email" : "admin";

    await store.createPasswordReset({
      userId: user.id,
      tokenHash,
      expiresAt,
      delivery,
      requestedIp: ip === "unknown" ? null : ip,
    });

    const link = resetUrl(origin, token);
    if (mail.configured) {
      const body = resetMailBody({ link, displayName: user.displayName, expiresMinutes: RESET_TTL_MINUTES });
      const result = await sendMail({ to: email, subject: "[taest] 비밀번호 재설정 안내", ...body });
      if (!result.ok) {
        // 메일이 실패하면 링크는 살아 있지만 사용자는 받지 못했습니다. 관리자 경로로 안내합니다.
        console.warn("[auth/forgot-password] 메일 발송 실패", result.error);
        return NextResponse.json({
          ...base,
          status: "queued_admin",
          message: `메일 발송에 실패해 요청을 관리자에게 넘겼습니다. 잠시 후 다시 시도하거나 ${SUPPORT_EMAIL}으로 알려 주세요.`,
          reached: false,
        });
      }
    }

    return NextResponse.json({
      ...base,
      status: mail.configured ? "sent" : "queued_admin",
      message: mail.configured
        ? "재설정 링크를 메일로 보냈습니다. 메일함(스팸함 포함)을 확인해 주세요."
        : `재설정 요청을 접수했습니다. 지금은 메일 발송 설정 전이라 관리자가 확인 후 링크를 전달합니다. 급하시면 ${SUPPORT_EMAIL}으로 알려 주세요.`,
      reached: true,
    });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[auth/forgot-password]", error);
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
