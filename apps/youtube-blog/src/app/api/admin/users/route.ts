import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { requireAdmin } from "@/lib/auth/guard";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 회원 목록(관리자). 이메일·이름·ID로 검색하고 크레딧·역할을 함께 봅니다. */
export async function GET(request: Request) {
  try {
    await requireAdmin();
    const url = new URL(request.url);
    const query = url.searchParams.get("q")?.trim() ?? "";
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get("limit") ?? 30)));
    const offset = Math.max(0, Number(url.searchParams.get("offset") ?? 0));

    const result = await getRuntime().store.listAdminUsers({ query, limit, offset });
    return NextResponse.json({
      users: result.users.map((row) => ({
        id: row.user.id,
        email: row.user.email,
        displayName: row.user.displayName,
        role: row.user.role,
        signupProvider: row.user.signupProvider,
        hasPassword: row.user.hasPassword,
        oauthProviders: row.oauthProviders,
        balance: row.balance,
        lifetimeGranted: row.lifetimeGranted,
        lifetimeUsed: row.lifetimeUsed,
        createdAt: row.user.createdAt,
        lastLoginAt: row.user.lastLoginAt,
      })),
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
