import { NextResponse } from "next/server";

import { toApiError } from "@/lib/app-error";
import { requireAdmin } from "@/lib/auth/guard";
import { getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    await requireAdmin();
    const overview = await getRuntime().store.getAdminOverview();
    return NextResponse.json({ overview });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json({ error: apiError.toJSON() }, { status: apiError.status });
  }
}
