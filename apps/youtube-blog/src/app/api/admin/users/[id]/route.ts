import { NextResponse } from "next/server";
import { z } from "zod";

import { AppError, toApiError } from "@/lib/app-error";
import { isValidUserId, requireAdmin } from "@/lib/auth/guard";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const schema = z.object({
  role: z.enum(["user", "admin"]),
});

/** 회원 역할 변경(관리자 승격/해제). 마지막 관리자는 해제할 수 없습니다. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const admin = await requireAdmin();
    const { id } = await context.params;
    if (!isValidUserId(id)) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);

    const parsed = schema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) throw new AppError("invalid_request", "역할 값이 올바르지 않습니다.", 400);

    const { store } = getRuntime();
    const target = await store.getUser(id);
    if (!target) throw new AppError("not_found", "회원을 찾을 수 없습니다.", 404);

    if (parsed.data.role === "user" && target.role === "admin") {
      const admins = await store.countAdmins();
      if (admins <= 1) {
        throw new AppError("conflict", "마지막 관리자는 해제할 수 없습니다. 다른 관리자를 먼저 지정해 주세요.", 409);
      }
    }

    const updated = await store.updateUser(id, { role: parsed.data.role });
    await store
      .recordAdminAction({
        adminUserId: admin.id,
        action: "user.role",
        targetUserId: id,
        reason: `${target.role} → ${parsed.data.role}`,
        metadata: { from: target.role, to: parsed.data.role },
      })
      .catch(() => undefined);

    return NextResponse.json({
      user: { id: updated.id, email: updated.email, role: updated.role },
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
