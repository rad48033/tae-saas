import { NextResponse } from "next/server";
import { z } from "zod";

import { StoreError } from "@tae/db";

import { AppError, toApiError } from "@/lib/app-error";
import { isValidUserId, requireAdmin } from "@/lib/auth/guard";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  userId: z.string(),
  /** 양수 = 지급, 음수 = 차감 */
  amount: z.number().int().min(-100_000).max(100_000),
  reason: z.string().trim().min(2).max(200),
});

/**
 * 크레딧 수동 지급·차감(CS·계좌이체·크몽/숨고 고객 수동 충전).
 * 모든 변경은 credit_transactions(kind=adjustment)와 admin_audit_logs에 남습니다.
 */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin();
    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      throw new AppError("invalid_request", "회원·수량·사유를 확인해 주세요.", 400, parsed.error.issues.slice(0, 5));
    }
    const { userId, amount, reason } = parsed.data;
    if (!isValidUserId(userId)) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);
    if (amount === 0) throw new AppError("invalid_request", "0크레딧은 조정할 수 없습니다.", 400);

    const { store } = getRuntime();
    const target = await store.getUser(userId);
    if (!target) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);

    let balance: number;
    try {
      balance = await store.grantCredits({
        userId,
        amount,
        kind: "adjustment",
        description: `관리자 ${amount > 0 ? "지급" : "차감"} · ${reason}`,
        metadata: { adminUserId: admin.id, adminEmail: admin.email, reason },
      });
    } catch (error) {
      if (error instanceof StoreError && error.code === "insufficient_credits") {
        throw new AppError("insufficient_credits", "회원의 잔액보다 많이 차감할 수 없습니다.", 409);
      }
      throw error;
    }

    await store
      .recordAdminAction({
        adminUserId: admin.id,
        action: amount > 0 ? "credits.grant" : "credits.deduct",
        targetUserId: userId,
        amount,
        reason,
        metadata: { balanceAfter: balance },
      })
      .catch(() => undefined);

    return NextResponse.json({ userId, amount, balance, reason });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
