import { NextResponse } from "next/server";

import { CREDIT_COSTS, getBillingConfig, getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";
import { getVideoConfig } from "@/lib/video";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const { user } = await ensureUser();
  const runtime = getRuntime();
  const balance = await runtime.store.getBalance(user.id);
  const billing = getBillingConfig();
  const video = getVideoConfig();

  return NextResponse.json({
    balance: balance.balance,
    lifetimeGranted: balance.lifetimeGranted,
    lifetimeUsed: balance.lifetimeUsed,
    trialCredits: CREDIT_COSTS.trial,
    costs: CREDIT_COSTS,
    mode: runtime.aiMode,
    store: runtime.storeMode,
    video: { mode: video.mode },
    billing: { webhook: billing.webhookSecret ? "configured" : "not_configured" },
  });
}
