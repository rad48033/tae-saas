import type { Metadata } from "next";

import { AuthForm } from "@/components/auth-form";

export const metadata: Metadata = {
  title: "회원가입",
  robots: { index: false, follow: false },
};

export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const params = await searchParams;
  const next = typeof params.next === "string" ? params.next : "/";
  const errorCode = typeof params.error === "string" ? params.error : undefined;
  const detail = typeof params.detail === "string" ? params.detail : undefined;

  return <AuthForm mode="signup" next={next} errorCode={errorCode} detail={detail} />;
}
