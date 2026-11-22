"use client";

import { useState } from "react";

export function BuyButton({
  packId,
  label = "크레딧 충전",
  disabled = false,
}: {
  packId: string;
  label?: string;
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function startCheckout() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ packId }),
      });
      const data = (await response.json()) as { url?: string; error?: { message?: string } };

      if (!response.ok || !data.url) {
        setError(data.error?.message ?? "결제 페이지를 열지 못했습니다.");
        return;
      }
      window.location.assign(data.url);
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <button
        type="button"
        onClick={startCheckout}
        disabled={busy || disabled}
        className="btn-primary w-full !py-2.5 text-xs"
        aria-busy={busy}
      >
        {busy ? "이동 중…" : label}
      </button>
      {error ? <p className="mt-2 text-[11px] text-rose-600">{error}</p> : null}
    </div>
  );
}
