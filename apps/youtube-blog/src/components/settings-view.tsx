"use client";

import { useEffect, useState, type FormEvent } from "react";

import type { CreditCosts } from "@/lib/api-types";

interface Health {
  status: "ok" | "degraded";
  services: { store: string; ai: string; billing: string };
  time: string;
}

const FAQ = [
  {
    q: "어떤 원문을 넣을 수 있나요?",
    a: "유튜브 자막, 블로그 본문, 인스타 캡션, 직접 붙여넣은 메모 네 가지입니다. 유튜브 원문은 이미 영상이라 블로그·인스타·페이스북 세 채널로, 나머지 원문은 영상까지 만들 수 있습니다.",
  },
  {
    q: "영상은 진짜 MP4로 만들어지나요?",
    a: "스토리보드 → 장면 이미지 → TTS 나레이션 → 자막 → ffmpeg 렌더 순서로 MP4를 만듭니다. 긴 렌더는 서버리스가 아니라 영상 워커에서 돌기 때문에, 설정 탭에서 워커 연결 상태를 확인할 수 있습니다.",
  },
  {
    q: "크레딧은 어떻게 차감되나요?",
    a: "글 1편 1크레딧, 글 3종을 한 번에 만들면 1크레딧입니다. 영상은 기획 3 + MP4 렌더 6 = 9크레딧이고, 실패하면 차감된 크레딧이 자동으로 돌아옵니다.",
  },
  {
    q: "원문에 없는 내용을 지어내지 않나요?",
    a: "프롬프트에서 원문 근거만 쓰도록 제한하고 필자의 주장은 귀속시켜 표현합니다. 그래도 발행 전 사실 확인은 필요합니다.",
  },
];

export function SettingsView({
  costs,
  aiMode,
  storeMode,
  videoMode,
  appUrl,
  archiveCount,
  onClearArchive,
  viewer,
  onSignOut,
}: {
  costs: CreditCosts;
  aiMode: string;
  storeMode: string;
  videoMode: "worker" | "inline" | "disabled";
  appUrl: string;
  archiveCount: number;
  onClearArchive: () => void;
  viewer?: {
    email: string | null;
    displayName: string | null;
    role: "user" | "admin";
    isGuest: boolean;
    hasPassword?: boolean;
    signupProvider?: string;
  } | null;
  onSignOut?: () => void | Promise<void>;
}) {
  const [health, setHealth] = useState<Health | null>(null);
  const [healthFailed, setHealthFailed] = useState(false);
  const [cleared, setCleared] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/health", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, data: (await response.json()) as Health }))
      .then(({ data }) => {
        if (!cancelled) setHealth(data);
      })
      .catch(() => {
        if (!cancelled) setHealthFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="container-page py-4 lg:py-8">
      <div className="mx-auto max-w-2xl space-y-4">
        <div className="px-1">
          <h1 className="text-xl font-extrabold tracking-tight text-ink sm:text-2xl">설정</h1>
          <p className="mt-1 text-sm text-slate-500">서버 상태와 앱 안내를 확인합니다.</p>
        </div>

        <section className="card p-5">
          <h2 className="section-title !text-sm">계정</h2>
          {viewer && !viewer.isGuest ? (
            <div className="mt-2 space-y-3">
              <dl className="divide-y divide-slate-100 text-xs">
                <Row label="이름" value={viewer.displayName ?? "–"} />
                <Row label="이메일" value={viewer.email ?? "없음(소셜 계정)"} />
                <Row
                  label="로그인 방법"
                  value={
                    viewer.signupProvider === "naver"
                      ? "네이버"
                      : viewer.signupProvider === "kakao"
                        ? "카카오"
                        : viewer.hasPassword === false
                          ? "소셜 전용"
                          : "이메일 + 비밀번호"
                  }
                />
                <Row label="권한" value={viewer.role === "admin" ? "관리자" : "일반 회원"} />
              </dl>

              <PasswordChangePanel hasPassword={Boolean(viewer.hasPassword)} hasEmail={Boolean(viewer.email)} />

              <div className="flex flex-wrap gap-2">
                {viewer.role === "admin" ? (
                  <a href="/admin" className="btn-ghost !py-2 text-xs">
                    관리자 페이지
                  </a>
                ) : null}
                <button type="button" onClick={() => void onSignOut?.()} className="btn-ghost !py-2 text-xs">
                  로그아웃
                </button>
              </div>
            </div>
          ) : (
            <div className="mt-2 text-xs leading-relaxed text-slate-500">
              지금은 체험(게스트) 상태입니다. 로그인하면 보관함·크레딧이 계정에 붙고 다른 기기에서도 이어집니다.
              <div className="mt-3 flex gap-2">
                <a href="/login?next=/" className="btn-primary !py-2 text-xs">
                  로그인
                </a>
                <a href="/signup" className="btn-ghost !py-2 text-xs">
                  회원가입
                </a>
              </div>
            </div>
          )}
        </section>

        <section className="card p-5">
          <div className="flex items-center justify-between">
            <h2 className="section-title !text-sm">서버 상태</h2>
            <span
              className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold ${
                health?.status === "ok"
                  ? "bg-emerald-50 text-emerald-700"
                  : health?.status === "degraded" || healthFailed
                    ? "bg-amber-50 text-amber-800"
                    : "bg-slate-100 text-slate-500"
              }`}
            >
              <span className="h-1.5 w-1.5 rounded-full bg-current" />
              {health?.status === "ok" ? "정상" : health?.status === "degraded" ? "일부 지연" : healthFailed ? "확인 실패" : "확인 중"}
            </span>
          </div>

          <dl className="mt-3 divide-y divide-slate-100 text-xs">
            <Row label="저장소" value={storeMode === "supabase" ? "Supabase" : "인메모리(개발용)"} />
            <Row label="AI" value={modeLabel(aiMode)} />
            <Row
              label="영상 렌더"
              value={videoMode === "worker" ? "워커 연결됨" : videoMode === "inline" ? "이 서버에서 직접 렌더" : "꺼짐"}
            />
            <Row label="결제" value={health?.services.billing === "configured" ? "연결됨" : "미연결"} />
          </dl>

          <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
            {aiMode === "demo"
              ? "지금은 데모 모드입니다. AI 키(ANTHROPIC·OPENAI·GEMINI)가 없어 규칙 기반 초안을 만들고, 영상은 결정적 데모 이미지·음성으로 렌더됩니다."
              : `지금은 실전 모드입니다(${modeLabel(aiMode)}). 실제 AI가 대본·이미지·음성을 만듭니다.`}
          </p>
        </section>

        <section className="card p-5">
          <h2 className="section-title !text-sm">앱 설치</h2>
          <ul className="mt-2 space-y-2 text-xs leading-relaxed text-slate-600">
            <li>
              <b className="text-slate-800">폰(안드로이드·아이폰)</b> — 브라우저 메뉴에서 &ldquo;홈 화면에 추가&rdquo;를 누르면 앱처럼 열립니다.
            </li>
            <li>
              <b className="text-slate-800">윈도우</b> — taest 설치형(.exe) 또는 포터블(.exe)을 받아 서버 주소를 넣으면 전용 창으로 열립니다.
            </li>
            <li>
              <b className="text-slate-800">안드로이드 앱</b> — .apk를 설치하면 푸시 없이도 전체 화면 앱으로 동작합니다.
            </li>
          </ul>
        </section>

        <section className="card p-5">
          <h2 className="section-title !text-sm">사용설명서 · 지원</h2>
          <div className="mt-2 grid gap-2 text-xs">
            <a
              href="/manual/taest-manual.pdf"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              사용설명서 PDF <span className="text-slate-400">열기 →</span>
            </a>
            <a
              href={`mailto:rad48033@gmail.com?subject=${encodeURIComponent("taest 문의")}`}
              className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              문의 메일 <span className="text-slate-400">rad48033@gmail.com</span>
            </a>
            <a
              href="/api/health"
              target="_blank"
              rel="noreferrer"
              className="flex items-center justify-between rounded-xl border border-slate-200 px-3 py-2.5 font-semibold text-slate-700 hover:bg-slate-50"
            >
              서버 헬스체크 <span className="text-slate-400">{appUrl.replace(/^https?:\/\//, "")}/api/health</span>
            </a>
          </div>
        </section>

        <section className="card p-5">
          <h2 className="section-title !text-sm">이 기기 저장공간</h2>
          <p className="mt-1 text-xs leading-relaxed text-slate-500">
            보관함에는 결과 {archiveCount}건이 저장되어 있습니다. 삭제하면 이 기기에서만 사라지고 서버 기록은 남습니다.
          </p>
          <button
            type="button"
            onClick={() => {
              onClearArchive();
              setCleared(true);
              window.setTimeout(() => setCleared(false), 2_000);
            }}
            disabled={archiveCount === 0}
            className="btn-ghost mt-3 !py-2 text-xs"
          >
            {cleared ? "정리했습니다" : "보관함 비우기"}
          </button>
        </section>

        <section className="card p-5">
          <h2 className="section-title !text-sm">크레딧 요약</h2>
          <dl className="mt-2 divide-y divide-slate-100 text-xs">
            <Row label="글 1편" value={`${costs.text}크레딧`} />
            <Row label="글 3종" value={`${costs.textSet}크레딧`} />
            <Row label="영상 1편" value={`${costs.videoTotal}크레딧 (기획 ${costs.videoStoryboard} + 렌더 ${costs.videoRender})`} />
            <Row label="체험 크레딧" value={`${costs.trial}크레딧`} />
          </dl>
        </section>

        <section className="card p-5">
          <h2 className="section-title !text-sm">자주 묻는 질문</h2>
          <div className="mt-2 space-y-2">
            {FAQ.map((item) => (
              <details key={item.q} className="rounded-xl border border-slate-200 px-3 py-2.5">
                <summary className="cursor-pointer list-none text-xs font-semibold text-slate-800">{item.q}</summary>
                <p className="mt-1.5 text-[11px] leading-relaxed text-slate-600">{item.a}</p>
              </details>
            ))}
          </div>
        </section>

        <p className="pb-4 text-center text-[11px] text-slate-400">
          taest · 원문 하나로 영상과 세 채널을. 문의 rad48033@gmail.com
        </p>
      </div>
    </div>
  );
}

function PasswordChangePanel({ hasPassword, hasEmail }: { hasPassword: boolean; hasEmail: boolean }) {
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  if (!hasEmail) {
    return (
      <p className="rounded-xl bg-slate-50 px-3 py-2.5 text-[11px] leading-relaxed text-slate-500">
        소셜 계정으로 로그인한 상태입니다. 비밀번호는 없어도 되고, 이메일이 연결된 계정이라면 비밀번호를 새로 붙일 수
        있습니다. 비밀번호를 잊었다면 로그아웃 후 &lsquo;비밀번호 찾기&rsquo;를 써 주세요.
      </p>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/auth/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      const data = (await response.json().catch(() => ({}))) as { message?: string; error?: { message?: string } };
      if (!response.ok) {
        setMessage({ kind: "error", text: data.error?.message ?? "비밀번호를 바꾸지 못했습니다." });
        return;
      }
      setMessage({ kind: "ok", text: data.message ?? "비밀번호를 바꿨습니다." });
      setCurrent("");
      setNext("");
      setOpen(false);
    } catch {
      setMessage({ kind: "error", text: "네트워크 문제로 처리하지 못했습니다." });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button type="button" onClick={() => setOpen((value) => !value)} className="btn-ghost !py-2 text-xs">
        {hasPassword ? "비밀번호 바꾸기" : "비밀번호 새로 만들기"}
      </button>

      {message ? (
        <p
          className={`mt-2 rounded-xl px-3 py-2 text-[11px] font-semibold ${
            message.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
          }`}
          role="status"
        >
          {message.text}
        </p>
      ) : null}

      {open ? (
        <form onSubmit={submit} className="mt-2 space-y-2 rounded-xl border border-slate-200 bg-slate-50/70 p-3">
          {hasPassword ? (
            <input
              type="password"
              value={current}
              onChange={(event) => setCurrent(event.target.value)}
              required
              autoComplete="current-password"
              placeholder="현재 비밀번호"
              className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-brand-400"
            />
          ) : null}
          <input
            type="password"
            value={next}
            onChange={(event) => setNext(event.target.value)}
            required
            minLength={8}
            maxLength={128}
            autoComplete="new-password"
            placeholder="새 비밀번호(8자 이상)"
            className="w-full rounded-lg border border-slate-200 px-2.5 py-2 text-xs outline-none focus:border-brand-400"
          />
          <button type="submit" disabled={busy} className="btn-primary !py-2 text-xs disabled:opacity-50">
            {busy ? "바꾸는 중…" : "바꾸기"}
          </button>
        </form>
      ) : null}
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-right font-semibold text-slate-800">{value}</dd>
    </div>
  );
}

function modeLabel(mode: string): string {
  switch (mode) {
    case "anthropic":
      return "Claude";
    case "openai":
      return "GPT";
    case "gemini":
      return "Gemini";
    default:
      return "데모(규칙 기반)";
  }
}
