import { NextResponse } from "next/server";

import { createCheckout, findPack } from "@tae/stripe";

import { toApiError } from "@/lib/app-error";
import { getBillingConfig, getRuntime } from "@/lib/runtime";
import { ensureUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { packId?: unknown } | null;
    const packId = typeof body?.packId === "string" ? body.packId : "";

    const pack = findPack(packId, process.env);
    if (!pack) {
      return NextResponse.json(
        { error: { code: "invalid_request", message: "알 수 없는 요금제입니다." } },
        { status: 404 },
      );
    }

    const { user } = await ensureUser();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

    const checkout = await createCheckout(getBillingConfig(), {
      pack,
      userId: user.id,
      email: user.email,
      redirectUrl: `${appUrl}/?purchased=1`,
    });

    return NextResponse.json({
      url: checkout.url,
      mode: checkout.mode,
      pack: { id: pack.id, credits: pack.credits, priceLabel: pack.priceLabel },
      store: getRuntime().storeMode,
    });
  } catch (error) {
    const apiError = toApiError(error);
    return NextResponse.json(
      { error: { code: apiError.code, message: apiError.message } },
      { status: apiError.status },
    );
  }
}
