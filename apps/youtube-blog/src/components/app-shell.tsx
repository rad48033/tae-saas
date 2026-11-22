"use client";

import { useCallback, useEffect, useState } from "react";

import type { ResolvedPack, ResolvedSubscriptionPlan } from "@tae/stripe";

import type { ConvertRequestPayload, ConvertResult, CreditCosts } from "@/lib/api-types";
import {
  addArchiveItem,
  archiveItemFrom,
  browserArchiveStorage,
  readArchive,
  removeArchiveItem,
  writeArchive,
  type ArchiveItem,
} from "@/lib/archive";
import { mergeResults } from "@/lib/results";

import { LibraryIcon, CreditIcon, PlusIcon, SettingsIcon, StudioIcon } from "./app-icons";
import { CreditsView } from "./credits-view";
import { LibraryView } from "./library-view";
import { SettingsView } from "./settings-view";
import { StudioView } from "./studio-view";

export type TabId = "studio" | "library" | "credits" | "settings";

const TABS: { id: TabId; label: string; description: string; Icon: typeof StudioIcon }[] = [
  { id: "studio", label: "스튜디오", description: "원문 하나로 영상 · 블로그 · 인스타 · 페이스북", Icon: StudioIcon },
  { id: "library", label: "보관함", description: "이 기기에 저장된 결과 다시 열기", Icon: LibraryIcon },
  { id: "credits", label: "크레딧", description: "충전 팩과 차감 기준", Icon: CreditIcon },
  { id: "settings", label: "설정", description: "서버 상태 · 안내 · 사용설명서", Icon: SettingsIcon },
];

export interface AppShellProps {
  packs: ResolvedPack[];
  subscriptions: ResolvedSubscriptionPlan[];
  costs: CreditCosts;
  aiMode: string;
  storeMode: string;
  videoMode: "worker" | "inline" | "disabled";
  appUrl: string;
}

export function AppShell({ packs, subscriptions, costs, aiMode, storeMode, videoMode, appUrl }: AppShellProps) {
  const [tab, setTab] = useState<TabId>(() => initialTab());
  const [credits, setCredits] = useState<number | null>(null);
  const [result, setResult] = useState<ConvertResult | null>(null);
  const [request, setRequest] = useState<ConvertRequestPayload | null>(null);
  const [archive, setArchive] = useState<ArchiveItem[]>([]);

  const refreshCredits = useCallback(async () => {
    try {
      const response = await fetch("/api/credits", { cache: "no-store" });
      if (!response.ok) return;
      const data = (await response.json()) as { balance?: number };
      if (typeof data.balance === "number") setCredits(data.balance);
    } catch {
      // 오프라인 등에서는 마지막으로 받은 잔액을 그대로 보여 줍니다.
    }
  }, []);

  useEffect(() => {
    const storage = browserArchiveStorage();
    setArchive(readArchive(storage));
    void refreshCredits();
  }, [refreshCredits]);

  useEffect(() => {
    function onVisible() {
      if (document.visibilityState === "visible") void refreshCredits();
    }
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [refreshCredits]);

  const handleResult = useCallback(
    (next: ConvertResult, sent: ConvertRequestPayload) => {
      setResult((previous) => {
        const merged = mergeResults(previous, next);
        const item = archiveItemFrom(merged, sent);
        setArchive((items) => {
          const updated = addArchiveItem(items, item);
          writeArchive(browserArchiveStorage(), updated);
          return updated;
        });
        return merged;
      });
      setRequest(sent);
      setCredits(next.credits.remaining);
    },
    [],
  );

  const openArchive = useCallback((item: ArchiveItem) => {
    setResult(item.result);
    setRequest(item.request);
    setTab("studio");
  }, []);

  const removeArchived = useCallback((id: string) => {
    setArchive((items) => {
      const updated = removeArchiveItem(items, id);
      writeArchive(browserArchiveStorage(), updated);
      return updated;
    });
  }, []);

  const clearArchive = useCallback(() => {
    setArchive([]);
    writeArchive(browserArchiveStorage(), []);
  }, []);

  const current = TABS.find((entry) => entry.id === tab) ?? TABS[0]!;

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* 데스크톱: 좌측 사이드바 */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-64 flex-col bg-night-950 text-white lg:flex">
        <div className="flex items-center gap-2.5 px-5 pb-6 pt-7">
          <BrandMark />
          <div>
            <p className="text-[17px] font-extrabold leading-none tracking-tight">taest</p>
            <p className="mt-1 text-[11px] text-white/50">콘텐츠 스튜디오</p>
          </div>
        </div>

        <nav className="flex-1 space-y-1 px-3">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={active ? "page" : undefined}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left text-sm font-semibold transition ${
                  active ? "bg-white/12 text-white shadow-inner" : "text-white/60 hover:bg-white/6 hover:text-white"
                }`}
              >
                <entry.Icon className={`h-5 w-5 ${active ? "text-white" : "text-white/50"}`} />
                {entry.label}
              </button>
            );
          })}
        </nav>

        <div className="m-3 rounded-2xl bg-white/8 p-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-white/50">남은 크레딧</p>
          <p className="mt-1 flex items-baseline gap-1">
            <span className="text-2xl font-extrabold">{credits ?? "–"}</span>
            <span className="text-xs text-white/60">크레딧</span>
          </p>
          <button
            type="button"
            onClick={() => setTab("credits")}
            className="mt-3 flex w-full items-center justify-center gap-1.5 rounded-xl bg-white px-3 py-2 text-xs font-bold text-night-900 transition hover:bg-white/90"
          >
            <PlusIcon className="h-4 w-4" /> 충전하기
          </button>
          <p className="mt-2 text-[10px] leading-relaxed text-white/40">
            글 3종 1크레딧 · 영상 1편 {costs.videoTotal}크레딧
          </p>
        </div>

        <div className="px-5 pb-6 text-[11px] text-white/40">
          <a href="/manual/taest-manual.pdf" target="_blank" rel="noreferrer" className="hover:text-white/70">
            사용설명서 PDF
          </a>
          <span className="mx-2">·</span>
          <a href="mailto:rad48033@gmail.com" className="hover:text-white/70">
            문의
          </a>
        </div>
      </aside>

      <div className="lg:pl-64">
        {/* 모바일: 상단 슬림 앱바 */}
        <header className="safe-top sticky top-0 z-30 bg-night-950 text-white lg:hidden">
          <div className="flex h-14 items-center gap-2.5 px-4">
            <BrandMark size={30} />
            <div className="min-w-0 flex-1">
              <p className="text-[15px] font-extrabold leading-none tracking-tight">taest</p>
              <p className="mt-1 truncate text-[10px] text-white/50">{current.description}</p>
            </div>
            <button
              type="button"
              onClick={() => setTab("credits")}
              className="flex items-center gap-1.5 rounded-full bg-white/12 px-3 py-1.5 text-xs font-bold text-white"
              aria-label={`남은 크레딧 ${credits ?? "확인 중"}`}
            >
              <CreditIcon className="h-4 w-4" />
              {credits ?? "–"}
            </button>
          </div>
        </header>

        {/* 데스크톱: 상단 앱 내비게이션 */}
        <header className="sticky top-0 z-30 hidden border-b border-slate-200/80 bg-white/85 backdrop-blur lg:block">
          <div className="flex h-16 items-center justify-between gap-4 px-8">
            <div className="min-w-0">
              <p className="text-sm font-bold text-ink">{current.label}</p>
              <p className="text-xs text-slate-500">{current.description}</p>
            </div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1.5 text-xs font-bold text-slate-700">
                <CreditIcon className="h-4 w-4 text-brand-600" />
                크레딧 {credits ?? "–"}
              </span>
              <button type="button" onClick={() => setTab("credits")} className="btn-ghost !py-2 text-xs">
                <PlusIcon className="h-4 w-4" /> 충전
              </button>
              <button type="button" onClick={() => setTab("studio")} className="btn-primary !py-2 text-xs">
                새로 만들기
              </button>
            </div>
          </div>
        </header>

        <main className="pb-tabbar lg:pb-12">
          {tab === "studio" ? (
            <StudioView
              costs={costs}
              credits={credits}
              aiMode={aiMode}
              videoMode={videoMode}
              result={result}
              request={request}
              onResult={handleResult}
              onCredits={setCredits}
              onNavigate={setTab}
            />
          ) : null}

          {tab === "library" ? (
            <LibraryView
              items={archive}
              onOpen={openArchive}
              onRemove={removeArchived}
              onClear={clearArchive}
              onNavigate={setTab}
            />
          ) : null}

          {tab === "credits" ? (
            <CreditsView
              packs={packs}
              subscriptions={subscriptions}
              costs={costs}
              credits={credits}
              onNavigate={setTab}
            />
          ) : null}

          {tab === "settings" ? (
            <SettingsView
              costs={costs}
              aiMode={aiMode}
              storeMode={storeMode}
              videoMode={videoMode}
              appUrl={appUrl}
              archiveCount={archive.length}
              onClearArchive={clearArchive}
            />
          ) : null}
        </main>
      </div>

      {/* 모바일: 하단 고정 탭바 */}
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-slate-200 bg-white/95 backdrop-blur lg:hidden">
        <div className="grid grid-cols-4">
          {TABS.map((entry) => {
            const active = entry.id === tab;
            return (
              <button
                key={entry.id}
                type="button"
                onClick={() => setTab(entry.id)}
                aria-current={active ? "page" : undefined}
                className={`flex h-[var(--tabbar-height)] flex-col items-center justify-center gap-1 text-[11px] font-semibold transition ${
                  active ? "text-brand-700" : "text-slate-400"
                }`}
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-xl transition ${
                    active ? "bg-brand-50 text-brand-700" : "text-slate-400"
                  }`}
                >
                  <entry.Icon className="h-5 w-5" />
                </span>
                {entry.label}
              </button>
            );
          })}
        </div>
      </nav>
    </div>
  );
}

function BrandMark({ size = 34 }: { size?: number }) {
  return (
    // 선택한 앱 아이콘을 그대로 씁니다(public/icons/icon-192.png).
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src="/icons/icon-192.png"
      alt=""
      width={size}
      height={size}
      className="rounded-[9px] shadow-[0_2px_10px_rgba(91,59,240,0.45)]"
      style={{ width: size, height: size }}
    />
  );
}

function initialTab(): TabId {
  if (typeof window === "undefined") return "studio";
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("tab");
  if (fromQuery === "library" || fromQuery === "credits" || fromQuery === "settings") return fromQuery;
  if (window.location.hash === "#pricing" || window.location.hash === "#credits") return "credits";
  return "studio";
}
