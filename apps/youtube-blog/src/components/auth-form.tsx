"use client";

import { useEffect, useState, type FormEvent } from "react";

interface SessionResponse {
  user?: { email: string | null; displayName: string | null; role: "user" | "admin"; isGuest: boolean } | null;
  oauth?: { naver?: boolean; kakao?: boolean };
}

const ERROR_MESSAGES: Record<string, string> = {
  oauth_not_configured: "소셜 로그인 키가 아직 등록되지 않았습니다. 지금은 이메일로 가입·로그인해 주세요.",
  oauth_state: "로그인 요청이 만료되었습니다. 소셜 로그인을 다시 눌러 주세요.",
  oauth_denied: "소셜 로그인을 취소하셨습니다.",
  oauth_failed: "소셜 로그인에 실패했습니다. 잠시 후 다시 시도해 주세요.",
  session_expired: "로그인이 만료되었습니다. 다시 로그인해 주세요.",
};

export function AuthForm({
  mode,
  next,
  errorCode,
  detail,
}: {
  mode: "login" | "signup";
  next: string;
  errorCode?: string;
  detail?: string;
}) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(
    errorCode ? (ERROR_MESSAGES[errorCode] ?? "로그인 중 문제가 생겼습니다. 다시 시도해 주세요.") : null,
  );
  const [oauth, setOauth] = useState<{ naver: boolean; kakao: boolean }>({ naver: true, kakao: true });
  const [notice, setNotice] = useState<string | null>(null);
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((data: SessionResponse | null) => {
        if (cancelled || !data) return;
        if (data.oauth) setOauth({ naver: data.oauth.naver !== false, kakao: data.oauth.kakao !== false });
        if (data.user && !data.user.isGuest) {
          setNotice(`${data.user.displayName ?? data.user.email ?? "회원"}님으로 이미 로그인되어 있습니다.`);
        }
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

    try {
      const response = await fetch(mode === "login" ? "/api/auth/login" : "/api/auth/signup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          ...(mode === "signup" && name.trim() ? { name: name.trim() } : {}),
        }),
      });
      const data = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
      if (!response.ok) {
        setError(data.error?.message ?? "요청을 처리하지 못했습니다.");
        return;
      }
      window.location.href = safeNext(next);
    } catch {
      setError("네트워크 문제로 요청을 보내지 못했습니다. 연결을 확인해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  async function signOutHere() {
    setSigningOut(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
    window.location.reload();
  }

  const signup = mode === "signup";
  const nextQuery = encodeURIComponent(safeNext(next));

  return (
    <div className="grid min-h-dvh bg-slate-50 lg:grid-cols-[1.05fr_1fr]">
      <aside className="relative hidden overflow-hidden bg-night-950 px-12 py-14 text-white lg:flex lg:flex-col lg:justify-between">
        <div>
          <div className="flex items-center gap-2.5">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={40} height={40} className="rounded-xl" />
            <div>
              <p className="text-lg font-extrabold tracking-tight">taest</p>
              <p className="text-[11px] text-white/50">콘텐츠 스튜디오</p>
            </div>
          </div>

          <h1 className="mt-14 text-3xl font-extrabold leading-tight tracking-tight">
            원문 하나로
            <br />
            영상과 세 채널을.
          </h1>
          <p className="mt-4 max-w-sm text-sm leading-relaxed text-white/60">
            유튜브·블로그·인스타 원문을 넣으면 9:16 릴스, 16:9 가로 영상, 블로그 2,000자, 인스타 카드뉴스 10장,
            페이스북 20줄을 한 번에 만듭니다.
          </p>

          <ul className="mt-10 space-y-3 text-sm text-white/70">
            <li className="flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10">🎬</span> 영상 기획 + MP4 렌더
            </li>
            <li className="flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10">📝</span> 블로그 · 인스타 · 페이스북 3종
            </li>
            <li className="flex items-center gap-3">
              <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/10">🗂️</span> 계정별 보관함과 크레딧
            </li>
          </ul>
        </div>

        <p className="text-[11px] text-white/40">© 2026 taest · 문의 rad48033@gmail.com</p>
        <div className="pointer-events-none absolute -right-24 top-16 h-72 w-72 rounded-full bg-brand-600/30 blur-3xl" />
        <div className="pointer-events-none absolute -bottom-20 -left-10 h-64 w-64 rounded-full bg-indigo-500/20 blur-3xl" />
      </aside>

      <main className="flex items-center justify-center px-5 py-10 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-6 flex items-center gap-2 lg:hidden">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/icons/icon-192.png" alt="" width={34} height={34} className="rounded-lg" />
            <span className="text-base font-extrabold tracking-tight text-ink">taest</span>
          </div>

          <h2 className="text-xl font-extrabold tracking-tight text-ink">
            {signup ? "회원가입" : "로그인"}
          </h2>
          <p className="mt-1 text-xs text-slate-500">
            {signup
              ? "가입하면 체험 크레딧을 드리고, 만든 결과가 계정 보관함에 남습니다."
              : "이메일 또는 네이버·카카오 계정으로 이어서 사용하세요."}
          </p>

          {notice ? (
            <div className="mt-4 rounded-xl bg-amber-50 px-3 py-2.5 text-[11px] font-semibold text-amber-800">
              {notice}{" "}
              <a href={safeNext(next)} className="underline">
                계속하기
              </a>
              <button
                type="button"
                onClick={() => void signOutHere()}
                disabled={signingOut}
                className="ml-2 underline decoration-amber-400 underline-offset-2 disabled:opacity-50"
              >
                {signingOut ? "로그아웃 중…" : "로그아웃하고 다른 계정으로"}
              </button>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4 rounded-xl bg-rose-50 px-3 py-2.5 text-[11px] font-semibold leading-relaxed text-rose-700" role="alert">
              {error}
              {detail ? <span className="mt-1 block font-normal text-rose-400">{detail}</span> : null}
            </div>
          ) : null}

          <div className="mt-5 space-y-2">
            <a
              href={oauth.naver && !busy ? `/api/auth/naver?next=${nextQuery}` : undefined}
              aria-disabled={!oauth.naver}
              onClick={(event) => {
                if (!oauth.naver) {
                  event.preventDefault();
                  setError(ERROR_MESSAGES.oauth_not_configured ?? null);
                }
              }}
              className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                oauth.naver ? "bg-[#03C75A] text-white hover:brightness-95" : "cursor-not-allowed bg-slate-100 text-slate-400"
              }`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-[5px] bg-white text-[12px] font-black text-[#03C75A]">N</span>
              네이버로 {signup ? "시작하기" : "로그인"}
            </a>
            <a
              href={oauth.kakao && !busy ? `/api/auth/kakao?next=${nextQuery}` : undefined}
              aria-disabled={!oauth.kakao}
              onClick={(event) => {
                if (!oauth.kakao) {
                  event.preventDefault();
                  setError(ERROR_MESSAGES.oauth_not_configured ?? null);
                }
              }}
              className={`flex h-11 w-full items-center justify-center gap-2 rounded-xl text-sm font-bold transition ${
                oauth.kakao ? "bg-[#FEE500] text-[#191600] hover:brightness-95" : "cursor-not-allowed bg-slate-100 text-slate-400"
              }`}
            >
              <span className="grid h-5 w-5 place-items-center rounded-full bg-[#191600] text-[11px] font-black text-[#FEE500]">T</span>
              카카오로 {signup ? "시작하기" : "로그인"}
            </a>
          </div>

          <div className="my-5 flex items-center gap-3 text-[11px] text-slate-400">
            <span className="h-px flex-1 bg-slate-200" />
            또는 이메일
            <span className="h-px flex-1 bg-slate-200" />
          </div>

          <form onSubmit={submit} className="space-y-3">
            {signup ? (
              <label className="block text-[11px] font-semibold text-slate-500">
                이름(선택)
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  maxLength={60}
                  className="mt-1 w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-brand-400"
                  placeholder="taest에서 보여줄 이름"
                />
              </label>
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

            <div className="block text-[11px] font-semibold text-slate-500">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="login-password">비밀번호</label>
                {!signup ? (
                  <a
                    href={`/forgot-password?next=${nextQuery}`}
                    className="text-[11px] font-semibold text-brand-700 hover:underline"
                  >
                    비밀번호를 잊으셨나요?
                  </a>
                ) : null}
              </div>
              <div className="relative mt-1">
                <input
                  id="login-password"
                  type={showPassword ? "text" : "password"}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  autoComplete={signup ? "new-password" : "current-password"}
                  required
                  minLength={signup ? 8 : 1}
                  maxLength={128}
                  className="w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 pr-16 text-sm text-ink outline-none focus:border-brand-400"
                  placeholder={signup ? "8자 이상" : "비밀번호"}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword((value) => !value)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg px-2 py-1 text-[10px] font-semibold text-slate-400 hover:text-slate-700"
                >
                  {showPassword ? "숨기기" : "보기"}
                </button>
              </div>
            </div>

            <button type="submit" disabled={busy} className="btn-primary h-11 w-full !py-0 text-sm disabled:opacity-60">
              {busy ? "처리 중…" : signup ? "회원가입" : "로그인"}
            </button>
          </form>

          <p className="mt-5 text-center text-xs text-slate-500">
            {signup ? "이미 계정이 있으신가요?" : "처음이신가요?"}{" "}
            <a
              href={`${signup ? "/login" : "/signup"}${next && next !== "/" ? `?next=${nextQuery}` : ""}`}
              className="font-bold text-brand-700 hover:underline"
            >
              {signup ? "로그인" : "회원가입"}
            </a>
          </p>
          <p className="mt-2 text-center text-[11px] text-slate-400">
            <a href="/" className="hover:text-slate-600">
              체험으로 먼저 써보기 →
            </a>
          </p>
        </div>
      </main>
    </div>
  );
}

function safeNext(value: string): string {
  if (!value.startsWith("/") || value.startsWith("//") || value.startsWith("/api/")) return "/";
  return value;
}
