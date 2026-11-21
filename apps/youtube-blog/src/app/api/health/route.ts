import { NextResponse } from "next/server";

import { getBillingConfig, getRuntime } from "@/lib/runtime";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = getRuntime();
  const healthy = await runtime.store.checkHealth().catch(() => false);
  const billing = getBillingConfig();

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      services: {
        store: runtime.storeMode,
        ai: runtime.aiMode,
        billing: billing.webhookSecret ? "configured" : "not_configured",
      },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
