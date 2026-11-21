import { NextResponse } from "next/server";

import { getRuntime } from "@/lib/runtime";
import { processLemonSqueezyWebhook } from "@/lib/webhook";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-signature");

  const result = await processLemonSqueezyWebhook({
    rawBody,
    signature,
    store: getRuntime().store,
  });

  return NextResponse.json(result.body, { status: result.status });
}
