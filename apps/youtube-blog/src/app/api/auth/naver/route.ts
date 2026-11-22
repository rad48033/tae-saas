import { startOAuth } from "@/lib/auth/oauth-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 네이버 로그인 시작: /api/auth/naver?next=/... */
export async function GET(request: Request) {
  return startOAuth(request, "naver");
}
