import { startOAuth } from "@/lib/auth/oauth-routes";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 카카오 로그인 시작: /api/auth/kakao?next=/... */
export async function GET(request: Request) {
  return startOAuth(request, "kakao");
}
