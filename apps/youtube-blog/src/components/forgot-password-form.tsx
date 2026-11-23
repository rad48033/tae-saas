"use client";

import { useState, type FormEvent } from "react";

type Result = {
  status?: "sent" | "queued_admin" | "check_email";
  message?: string;
  mailConfigured?: boolean;
  supportEmail?: string;
  ttlMinutes?: number;
};

export function ForgotPasswordForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as Result & { error?: { message?: string } };
      if (!response.ok) {
        setError(data.error?.message ?? "요청을 처리하지 못했습니다.");
        return;
      }
      setResult(data);
    } catch {
      setError("네트워크 문제로 요청을 보내지 못했습니다. 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center bg-slate-50 px-5 py-10">
      <div className="w-full max-w-sm">
        <a href="/" className="mb-6 flex items-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/icon-192.png" alt="" width={34} height={34} className="rounded-lg" />
          <span className="text-base font-extrabold tracking-tight text-ink">taest</span>
        </a>

        <h1 className="text-xl font-extrabold tracking-tight text-ink">비밀번호 찾기</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          가입한 이메일을 넣으면 재설정 링크를 보내 드립니다. 네이버·카카오로 가입한 계정은 비밀번호가 없어 소셜
          로그인으로 들어가야 합니다.
        </p>

        {result ? (
          <div
            className={`mt-5 rounded-2xl px-4 py-3 text-xs leading-relaxed ${
              result.status === "sent" ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-900"
            }`}
            role="status"
          >
            <p className="font-bold">{result.status === "sent" ? "메일을 보냈습니다" : "요청을 접수했습니다"}</p>
            <p className="mt-1">{result.message}</p>
            {result.status !== "sent" ? (
              <p className="mt-2 text-[11px] text-amber-800/80">
                문의: <a className="underline" href={`mailto:${result.supportEmail ?? "rad48033@gmail.com"}`}>{result.supportEmail ?? "rad48033@gmail.com"}</a>
                {result.ttlMinutes ? ` · 링크는 ${result.ttlMinutes}분 동안 한 번만 쓸 수 있습니다.` : ""}
              </p>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-2">
              <a href={`/login?next=${encodeURIComponent(next)}`} className="btn-primary !py-2 text-xs">
                로그인으로 돌아가기
              </a>
              <a href="/signup" className="btn-ghost !py-2 text-xs">
                회원가입
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            {error ? (
              <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] font-semibold text-rose-700" role="alert">
                {error}
              </div>
            ) : null}

            <label className="block text-[11px] font-semibold text-slate-500">
              이메일
              <input
                type="email"
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                required
                maxLength={254}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-400"
                placeholder="you@example.com"
              />
            </label>

            <button type="submit" disabled={busy} className="btn-primary h-11 w-full !py-0 text-sm disabled:opacity-60">
              {busy ? "보내는 중…" : "재설정 링크 받기"}
            </button>
          </form>
        )}

        <div className="mt-6 space-x-3 text-center text-xs text-slate-500">
          <a href={`/login?next=${encodeURIComponent(next)}`} className="font-bold text-brand-700 hover:underline">
            로그인
          </a>
          <span className="text-slate-300">|</span>
          <a href="/" className="hover:text-slate-700">
            체험으로 먼저 써보기
          </a>
        </div>
      </div>
    </div>
  );
}
