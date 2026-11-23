"use client";

import { useState, type FormEvent } from "react";

export function ResetPasswordForm({ token, next }: { token: string; next: string }) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expired, setExpired] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("두 비밀번호가 서로 다릅니다. 다시 확인해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string; code?: string } };
      if (!response.ok) {
        if (data.error?.code === "reset_token_invalid") setExpired(true);
        setError(data.error?.message ?? "비밀번호를 바꾸지 못했습니다.");
        return;
      }
      // 재설정에 성공하면 서버가 로그인 쿠키를 새로 심습니다.
      window.location.href = safeNext(next);
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

        <h1 className="text-xl font-extrabold tracking-tight text-ink">새 비밀번호 정하기</h1>
        <p className="mt-1 text-xs leading-relaxed text-slate-500">
          8자 이상으로 정해 주세요. 링크는 한 번만 쓸 수 있고, 바꾸면 다른 기기에서는 다시 로그인해야 합니다.
        </p>

        {!token ? (
          <div className="mt-5 rounded-2xl bg-amber-50 px-4 py-3 text-xs leading-relaxed text-amber-900" role="alert">
            링크에 재설정 토큰이 없습니다. 메일의 버튼을 다시 눌러 주세요.
            <a href="/forgot-password" className="mt-3 block font-bold underline">
              비밀번호 찾기 다시 하기
            </a>
          </div>
        ) : (
          <form onSubmit={submit} className="mt-5 space-y-3">
            {error ? (
              <div className="rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-rose-700" role="alert">
                {error}
                {expired ? (
                  <a href="/forgot-password" className="mt-2 block font-bold text-rose-700 underline">
                    재설정 링크 다시 받기
                  </a>
                ) : null}
              </div>
            ) : null}

            <label className="block text-[11px] font-semibold text-slate-500">
              새 비밀번호
              <div className="relative mt-1">
                <input
                  type={show ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  maxLength={128}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-16 text-sm text-ink outline-none focus:border-brand-400"
                  placeholder="8자 이상"
                />
                <button
                  type="button"
                  onClick={() => setShow((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:text-slate-700"
                >
                  {show ? "숨기기" : "보기"}
                </button>
              </div>
            </label>

            <label className="block text-[11px] font-semibold text-slate-500">
              새 비밀번호 확인
              <input
                type={show ? "text" : "password"}
                value={confirm}
                onChange={(event) => setConfirm(event.target.value)}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={128}
                className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-400"
                placeholder="같은 비밀번호를 한 번 더"
              />
            </label>

            <button type="submit" disabled={busy} className="btn-primary h-11 w-full !py-0 text-sm disabled:opacity-60">
              {busy ? "바꾸는 중…" : "비밀번호 바꾸고 로그인"}
            </button>
          </form>
        )}

        <div className="mt-6 text-center text-xs text-slate-500">
          <a href="/login" className="font-bold text-brand-700 hover:underline">
            로그인
          </a>
        </div>
      </div>
    </div>
  );
}

function safeNext(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) return "/";
  return value;
}
