"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

interface AdminUser {
  id: string;
  email: string | null;
  displayName: string | null;
  role: "user" | "admin";
  signupProvider: "email" | "naver" | "kakao" | "guest";
  hasPassword: boolean;
  oauthProviders: ("naver" | "kakao")[];
  balance: number;
  lifetimeGranted: number;
  lifetimeUsed: number;
  createdAt: string;
  lastLoginAt: string | null;
}

interface Overview {
  totalUsers: number;
  todayUsers: number;
  weekUsers: number;
  adminUsers: number;
  members: number;
  guests: number;
  totalJobs: number;
  todayJobs: number;
  textJobs: number;
  videoJobs: number;
  succeededJobs: number;
  failedJobs: number;
  creditBalance: number;
  creditGranted: number;
  creditUsed: number;
}

interface AdminJob {
  id: string;
  userId: string;
  userEmail: string | null;
  userDisplayName: string | null;
  status: "queued" | "running" | "succeeded" | "failed";
  format: string | null;
  title: string | null;
  creditsCharged: number;
  errorCode: string | null;
  createdAt: string;
  completedAt: string | null;
}

interface ApiError {
  error?: { code?: string; message?: string };
}

const PROVIDER_LABEL: Record<string, string> = {
  email: "이메일",
  naver: "네이버",
  kakao: "카카오",
  guest: "체험",
};

const STATUS_LABEL: Record<string, string> = {
  queued: "대기",
  running: "진행",
  succeeded: "완료",
  failed: "실패",
};

const FORMAT_LABEL: Record<string, string> = {
  blog: "블로그",
  instagram: "인스타",
  facebook: "페이스북",
  youtube_video: "영상",
};

export function AdminDashboard({ admin }: { admin: { id: string; email: string | null; displayName: string | null } }) {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [total, setTotal] = useState(0);
  const [query, setQuery] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [jobs, setJobs] = useState<AdminJob[]>([]);
  const [selected, setSelected] = useState<AdminUser | null>(null);
  const [amount, setAmount] = useState("10");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  const loadOverview = useCallback(async () => {
    const response = await fetch("/api/admin/overview", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { overview?: Overview };
    if (data.overview) setOverview(data.overview);
  }, []);

  const loadUsers = useCallback(async (nextQuery: string) => {
    const params = new URLSearchParams({ limit: "50" });
    if (nextQuery) params.set("q", nextQuery);
    const response = await fetch(`/api/admin/users?${params.toString()}`, { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { users?: AdminUser[]; total?: number } & ApiError;
    if (data.users) {
      setUsers(data.users);
      setTotal(data.total ?? data.users.length);
    }
  }, []);

  const loadJobs = useCallback(async () => {
    const response = await fetch("/api/admin/jobs?limit=50", { cache: "no-store" });
    const data = (await response.json().catch(() => ({}))) as { jobs?: AdminJob[] };
    if (data.jobs) setJobs(data.jobs);
  }, []);

  useEffect(() => {
    void Promise.all([loadOverview(), loadUsers(""), loadJobs()]);
  }, [loadOverview, loadUsers, loadJobs]);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 4_000);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const stats = useMemo(
    () =>
      overview
        ? [
            { label: "전체 회원", value: overview.totalUsers, hint: `오늘 +${overview.todayUsers} · 7일 +${overview.weekUsers}` },
            { label: "정식 회원", value: overview.members, hint: `체험 세션 ${overview.guests.toLocaleString("ko-KR")}개` },
            { label: "전체 작업", value: overview.totalJobs, hint: `오늘 ${overview.todayJobs} · 글 ${overview.textJobs} / 영상 ${overview.videoJobs}` },
            { label: "잔여 크레딧", value: overview.creditBalance, hint: `지급 ${overview.creditGranted.toLocaleString("ko-KR")} · 사용 ${overview.creditUsed.toLocaleString("ko-KR")}` },
          ]
        : [],
    [overview],
  );

  async function submitCredit(user: AdminUser) {
    const value = Number(amount);
    if (!Number.isInteger(value) || value === 0) {
      setNotice({ kind: "error", text: "0이 아닌 정수를 입력해 주세요. 양수는 지급, 음수는 차감입니다." });
      return;
    }
    if (reason.trim().length < 2) {
      setNotice({ kind: "error", text: "사유를 2자 이상 적어 주세요(거래 내역에 남습니다)." });
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/admin/credits", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ userId: user.id, amount: value, reason: reason.trim() }),
      });
      const data = (await response.json().catch(() => ({}))) as { balance?: number } & ApiError;
      if (!response.ok) {
        setNotice({ kind: "error", text: data.error?.message ?? "크레딧을 조정하지 못했습니다." });
        return;
      }
      setNotice({
        kind: "ok",
        text: `${user.email ?? user.id.slice(0, 8)} · ${value > 0 ? "+" : ""}${value}크레딧 → 잔액 ${data.balance ?? "?"}`,
      });
      setReason("");
      await Promise.all([loadUsers(query), loadOverview()]);
      if (selected?.id === user.id) {
        setSelected({ ...user, balance: data.balance ?? user.balance });
      }
    } finally {
      setBusy(false);
    }
  }

  async function changeRole(user: AdminUser, role: "user" | "admin") {
    if (role === user.role) return;
    const who = user.email ?? user.displayName ?? user.id.slice(0, 8);
    if (role === "admin" && !window.confirm(`${who} 님에게 관리자 권한을 줄까요? /admin 전체 권한이 생깁니다.`)) return;
    if (role === "user" && !window.confirm(`${who} 님의 관리자 권한을 회수할까요?`)) return;

    setBusy(true);
    try {
      const response = await fetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await response.json().catch(() => ({}))) as ApiError;
      if (!response.ok) {
        setNotice({ kind: "error", text: data.error?.message ?? "역할을 바꾸지 못했습니다." });
        return;
      }
      setNotice({ kind: "ok", text: `${who} · ${role === "admin" ? "관리자로 승격" : "일반 회원으로 변경"}` });
      await loadUsers(query);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-dvh bg-slate-50">
      <header className="bg-night-950 text-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-5 py-4 sm:px-8">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-white/10 text-lg">🔐</span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-extrabold tracking-tight">taest 관리자</p>
            <p className="text-[11px] text-white/50">회원 · 크레딧 · 생성 작업 모니터링</p>
          </div>
          <div className="flex items-center gap-2 text-[11px]">
            <span className="hidden rounded-full bg-white/10 px-3 py-1.5 font-semibold text-white/80 sm:inline">
              {admin.displayName ?? admin.email ?? "관리자"}
            </span>
            <a href="/" className="rounded-full bg-white px-3 py-1.5 font-bold text-night-900 hover:bg-white/90">
              앱으로
            </a>
            <button
              type="button"
              onClick={async () => {
                await fetch("/api/auth/logout", { method: "POST" }).catch(() => undefined);
                window.location.href = "/login";
              }}
              className="rounded-full bg-white/10 px-3 py-1.5 font-semibold text-white/80 hover:bg-white/20"
            >
              로그아웃
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-8">
        {notice ? (
          <div
            className={`rounded-xl px-4 py-3 text-xs font-semibold ${
              notice.kind === "ok" ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-700"
            }`}
            role="status"
          >
            {notice.text}
          </div>
        ) : null}

        <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {(stats.length > 0 ? stats : Array.from({ length: 4 }, (_, index) => ({ label: "–", value: "–", hint: "", key: index }))).map(
            (stat, index) => (
              <div key={`${stat.label}-${index}`} className="card p-4">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">{stat.label}</p>
                <p className="mt-1 text-2xl font-extrabold text-ink">
                  {typeof stat.value === "number" ? stat.value.toLocaleString("ko-KR") : stat.value}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">{stat.hint || "\u00a0"}</p>
              </div>
            ),
          )}
        </section>

        <section className="card overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-ink">회원 관리</h2>
              <p className="text-[11px] text-slate-500">
                전체 {total.toLocaleString("ko-KR")}명 · 이메일·이름·ID 검색
              </p>
            </div>
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const next = searchInput.trim();
                setQuery(next);
                void loadUsers(next);
              }}
              className="flex items-center gap-1.5"
            >
              <input
                value={searchInput}
                onChange={(event) => setSearchInput(event.target.value)}
                placeholder="이메일 · 이름 · ID"
                className="w-48 rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
                aria-label="회원 검색"
              />
              <button type="submit" className="btn-ghost !py-1.5 text-xs">
                검색
              </button>
              {query ? (
                <button
                  type="button"
                  onClick={() => {
                    setSearchInput("");
                    setQuery("");
                    void loadUsers("");
                  }}
                  className="text-[11px] text-slate-400 hover:text-slate-700"
                >
                  초기화
                </button>
              ) : null}
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">회원</th>
                  <th className="px-3 py-2 font-semibold">가입방식</th>
                  <th className="px-3 py-2 font-semibold">역할</th>
                  <th className="px-3 py-2 text-right font-semibold">남은 크레딧</th>
                  <th className="px-3 py-2 font-semibold">가입일</th>
                  <th className="px-4 py-2 text-right font-semibold">관리</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {users.map((user) => (
                  <tr key={user.id} className={selected?.id === user.id ? "bg-brand-50/50" : undefined}>
                    <td className="px-4 py-3">
                      <p className="font-semibold text-ink">{user.displayName || user.email || "이름 없음"}</p>
                      <p className="text-[11px] text-slate-400">{user.email ?? user.id}</p>
                    </td>
                    <td className="px-3 py-3">
                      <span className="chip !text-[10px]">{PROVIDER_LABEL[user.signupProvider] ?? user.signupProvider}</span>
                      {user.oauthProviders.length > 0 ? (
                        <span className="ml-1 text-[10px] text-slate-400">
                          {user.oauthProviders.map((provider) => PROVIDER_LABEL[provider]).join("·")} 연결
                        </span>
                      ) : null}
                    </td>
                    <td className="px-3 py-3">
                      {user.role === "admin" ? (
                        <span className="rounded-full bg-night-950 px-2 py-0.5 text-[10px] font-bold text-white">관리자</span>
                      ) : (
                        <span className="text-[11px] text-slate-500">일반</span>
                      )}
                    </td>
                    <td className="px-3 py-3 text-right">
                      <span className="font-bold text-ink">{user.balance.toLocaleString("ko-KR")}</span>
                      <span className="block text-[10px] text-slate-400">
                        지급 {user.lifetimeGranted.toLocaleString("ko-KR")} · 사용 {user.lifetimeUsed.toLocaleString("ko-KR")}
                      </span>
                    </td>
                    <td className="px-3 py-3 text-[11px] text-slate-500">{formatDate(user.createdAt)}</td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => {
                            setSelected(user);
                            setAmount("10");
                            setReason("");
                          }}
                          className="rounded-lg bg-slate-900 px-2 py-1 text-[10px] font-bold text-white"
                        >
                          크레딧
                        </button>
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => void changeRole(user, user.role === "admin" ? "user" : "admin")}
                          className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-semibold text-slate-600 disabled:opacity-40"
                        >
                          {user.role === "admin" ? "권한 해제" : "관리자 지정"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="px-4 py-10 text-center text-xs text-slate-400">
                      검색 결과가 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        {selected ? (
          <section className="card border-brand-200 p-4">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-ink">크레딧 조정</h3>
                <p className="text-[11px] text-slate-500">
                  {selected.displayName || selected.email || selected.id} · 현재 {selected.balance.toLocaleString("ko-KR")}크레딧
                </p>
              </div>
              <button type="button" onClick={() => setSelected(null)} className="text-[11px] text-slate-400 hover:text-slate-700">
                닫기
              </button>
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-[120px_1fr_auto]">
              <label className="text-[11px] font-semibold text-slate-500">
                수량(±)
                <input
                  type="number"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-bold text-ink outline-none focus:border-brand-400"
                  step={1}
                />
              </label>
              <label className="text-[11px] font-semibold text-slate-500">
                사유(거래 내역에 남습니다)
                <input
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  placeholder="예: 크몽 주문 5,000원 · 50크레딧 충전"
                  className="mt-1 w-full rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs outline-none focus:border-brand-400"
                />
              </label>
              <div className="flex items-end gap-1">
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void submitCredit(selected)}
                  className="btn-primary !py-2 text-xs disabled:opacity-50"
                >
                  {busy ? "처리 중…" : "적용"}
                </button>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => {
                    setAmount("-10");
                    setReason("관리자 수동 차감");
                  }}
                  className="btn-ghost !py-2 text-xs"
                >
                  차감 예시
                </button>
              </div>
            </div>
          </section>
        ) : null}

        <section className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
            <div>
              <h2 className="text-sm font-bold text-ink">최근 생성 작업</h2>
              <p className="text-[11px] text-slate-500">성공 {overview?.succeededJobs ?? 0} · 실패 {overview?.failedJobs ?? 0}</p>
            </div>
            <button type="button" onClick={() => void loadJobs()} className="btn-ghost !py-1.5 text-xs">
              새로고침
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-left text-xs">
              <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-400">
                <tr>
                  <th className="px-4 py-2 font-semibold">회원</th>
                  <th className="px-3 py-2 font-semibold">유형</th>
                  <th className="px-3 py-2 font-semibold">상태</th>
                  <th className="px-3 py-2 text-right font-semibold">사용 크레딧</th>
                  <th className="px-3 py-2 font-semibold">일시</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {jobs.map((job) => (
                  <tr key={job.id}>
                    <td className="px-4 py-2.5">
                      <p className="truncate font-medium text-slate-700">{job.userEmail ?? job.userDisplayName ?? job.userId.slice(0, 8)}</p>
                      <p className="truncate text-[10px] text-slate-400">{job.title ?? "제목 없음"}</p>
                    </td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-600">
                      {job.format ? (FORMAT_LABEL[job.format] ?? job.format) : "–"}
                    </td>
                    <td className="px-3 py-2.5">
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                          job.status === "succeeded"
                            ? "bg-emerald-50 text-emerald-700"
                            : job.status === "failed"
                              ? "bg-rose-50 text-rose-700"
                              : "bg-amber-50 text-amber-700"
                        }`}
                      >
                        {STATUS_LABEL[job.status] ?? job.status}
                      </span>
                      {job.errorCode ? <span className="ml-1 text-[10px] text-rose-400">{job.errorCode}</span> : null}
                    </td>
                    <td className="px-3 py-2.5 text-right text-slate-700">{job.creditsCharged}</td>
                    <td className="px-3 py-2.5 text-[11px] text-slate-400">{formatDateTime(job.createdAt)}</td>
                  </tr>
                ))}
                {jobs.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-10 text-center text-xs text-slate-400">
                      아직 생성 작업이 없습니다.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <p className="pb-4 text-center text-[10px] text-slate-400">
          크레딧 변경은 credit_transactions(kind=adjustment)와 admin_audit_logs에 기록됩니다.
        </p>
      </main>
    </div>
  );
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "–";
  return `${formatDate(value)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}
