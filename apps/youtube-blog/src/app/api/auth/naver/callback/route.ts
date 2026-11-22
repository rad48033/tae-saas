import { handleOAuthCallback } from "@/lib/auth/oauth-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return handleOAuthCallback(request, "naver");
}
