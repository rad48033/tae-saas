import { NextResponse } from "next/server";

import { sessionUserView } from "@/lib/auth/guard";
import { isOAuthConfigured } from "@/lib/auth/oauth";
import { getSessionUser } from "@/lib/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * 현재 로그인 상태(읽기 전용). 게스트 세션을 새로 만들지 않습니다.
 * 로그인 화면이 네이버·카카오 버튼 활성화 여부를 판단할 때도 씁니다.
 */
export async function GET() {
  const user = await getSessionUser().catch(() => null);

  return NextResponse.json({
    user: user ? sessionUserView(user) : null,
    oauth: {
      naver: isOAuthConfigured("naver"),
      kakao: isOAuthConfigured("kakao"),
    },
  });
}
