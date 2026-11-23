import { NextResponse } from "next/server";

import { mailStatus } from "@/lib/mail";
import { getBillingConfig, getRuntime } from "@/lib/runtime";
import { storageStatus } from "@/lib/storage";
import { sttStatus } from "@/lib/stt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const runtime = getRuntime();
  const healthy = await runtime.store.checkHealth().catch(() => false);
  const billing = getBillingConfig();
  const mail = mailStatus();
  const stt = sttStatus();
  const storage = storageStatus();

  return NextResponse.json(
    {
      status: healthy ? "ok" : "degraded",
      services: {
        store: runtime.storeMode,
        ai: runtime.aiMode,
        billing: billing.webhookSecret ? "configured" : "not_configured",
        mail: mail.configured ? "configured" : "not_configured",
        stt: stt.configured ? (stt.provider ?? "configured") : "not_configured",
        storage: storage.configured ? "configured" : "not_configured",
      },
      notes: {
        mail: mail.reason,
        stt: stt.reason,
        storage: storage.reason,
      },
      time: new Date().toISOString(),
    },
    { status: healthy ? 200 : 503 },
  );
}
