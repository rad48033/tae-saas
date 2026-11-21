import { NextResponse } from "next/server";

import { getRuntime, TRIAL_CREDITS } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await ensureUser();
  const runtime = getRuntime();
  const balance = await runtime.store.getBalance(user.id);

  return NextResponse.json({
    balance: balance.balance,
    lifetimeUsed: balance.lifetimeUsed,
    trialCredits: TRIAL_CREDITS,
    mode: runtime.aiMode,
    store: runtime.storeMode,
  });
}
