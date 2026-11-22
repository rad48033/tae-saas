import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";

import { AdminDashboard } from "@/components/admin-dashboard";
import { getSessionUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "관리자",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const user = await getSessionUser().catch(() => null);

  if (!user) {
    redirect("/login?next=/admin");
  }

  if (user.role !== "admin") {
    return (
      <div className="grid min-h-dvh place-items-center bg-slate-50 px-5">
        <div className="card w-full max-w-md p-6 text-center">
          <span className="text-3xl" aria-hidden>
            🚫
          </span>
          <h1 className="mt-2 text-lg font-extrabold text-ink">관리자 전용 페이지입니다</h1>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            {user.email ?? "이 계정"}에는 관리자 권한이 없습니다. 관리자에게 권한을 요청하거나 앱으로 돌아가 주세요.
          </p>
          <div className="mt-4 flex justify-center gap-2">
            <Link href="/" className="btn-primary !py-2 text-xs">
              앱으로 돌아가기
            </Link>
            <Link href="/login?next=/admin" className="btn-ghost !py-2 text-xs">
              다른 계정으로 로그인
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <AdminDashboard
      admin={{ id: user.id, email: user.email, displayName: user.displayName }}
    />
  );
}
