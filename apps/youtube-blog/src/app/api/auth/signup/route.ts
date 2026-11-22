import { NextResponse } from "next/server";
import { z } from "zod";

import { StoreError } from "@tae/db";

import { AppError, toApiError } from "@/lib/app-error";
import { finishLogin } from "@/lib/auth/account";
import { sessionUserView } from "@/lib/auth/guard";
import { hashPassword, isValidEmail, normalizeEmail, passwordProblem } from "@/lib/auth/password";
import { enforceRateLimit } from "@/lib/rate-limit";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  email: z.string().max(254),
  password: z.string().max(200),
  name: z.string().max(60).optional(),
});

export async function POST(request: Request) {
  try {
    const ip = clientIp(request);
    enforceRateLimit(`signup:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 });

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "입력 형식이 올바르지 않습니다.", 400);
    }

    const email = normalizeEmail(parsed.data.email);
    if (!isValidEmail(email)) {
      throw new AppError("invalid_email", "올바른 이메일 주소를 입력해 주세요.", 400);
    }
    const problem = passwordProblem(parsed.data.password);
    if (problem) throw new AppError("weak_password", problem, 400);

    const { store } = getRuntime();
    const existing = await store.findUserByEmail(email);
    if (existing) {
      throw new AppError(
        "email_taken",
        existing.hasPassword
          ? "이미 가입된 이메일입니다. 로그인해 주세요."
          : "이 이메일은 네이버·카카오로 가입되어 있습니다. 소셜 로그인을 이용해 주세요.",
        409,
      );
    }

    const created = await store.createUser({
      email,
      displayName: parsed.data.name?.trim() || null,
      passwordHash: hashPassword(parsed.data.password),
      signupProvider: "email",
    });

    const { user } = await finishLogin(store, created);
    return NextResponse.json({ user: sessionUserView(user) }, { status: 201 });
  } catch (error) {
    if (error instanceof StoreError && error.code === "conflict") {
      const apiError = new AppError("email_taken", "이미 가입된 이메일입니다.", 409);
      return NextResponse.json({ error: apiError.toJSON() }, { status: 409 });
    }
    const apiError = toApiError(error);
    if (apiError.status >= 500) console.error("[auth/signup]", error);
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
