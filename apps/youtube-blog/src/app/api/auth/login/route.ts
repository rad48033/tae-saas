import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { finishLogin } from "@/lib/auth/account";
import { sessionUserView } from "@/lib/auth/guard";
import { dummyPasswordHash, isValidEmail, normalizeEmail, verifyPassword } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
});

export async function POST(request: Request) {
  try {
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "이메일과 비밀번호를 입력해 주세요.", 400);
    }

    const email = normalizeEmail(parsed.data.email);
    if (!isValidEmail(email)) {
      throw new AppError("invalid_credentials", "이메일 또는 비밀번호가 맞지 않습니다.", 401);
    }

    const ip = clientIp(request);
    enforceRateLimit(`login:${ip}`, { limit: 20, windowMs: 15 * 60 * 1000 });
    enforceRateLimit(`login:mail:${email}`, { limit: 8, windowMs: 15 * 60 * 1000 });

    const { store } = getRuntime();
    const credentials = await store.getUserCredentials(email);

    // 계정이 없어도 같은 시간이 걸리도록 더미 해시를 검증합니다(계정 존재 여부 노출 방지).
    const ok = verifyPassword(
      parsed.data.password,
      credentials ? credentials.passwordHash : dummyPasswordHash(),
    );

    if (!credentials || !ok) {
      throw new AppError(
        "invalid_credentials",
        credentials && !credentials.user.hasPassword
          ? "이 계정은 네이버·카카오로 가입되어 있습니다. 소셜 로그인을 이용해 주세요."
          : "이메일 또는 비밀번호가 맞지 않습니다.",
        401,
      );
    }

    const { user, movedJobs } = await finishLogin(store, credentials.user);
    return NextResponse.json({ user: sessionUserView(user), movedJobs });
  } catch (error) {
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[auth/login]", error);
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
