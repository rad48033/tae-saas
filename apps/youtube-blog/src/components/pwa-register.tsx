"use client";

import { useEffect } from "react";

/**
 * 서비스 워커 등록 컴포넌트.
 *
 * - 운영 환경에서만 등록합니다. 개발 중에는 Next.js 핫 리로드와 캐시가 부딪히지 않도록 건너뜁니다.
 * - 새 버전이 준비되면 다음 방문에서 자동으로 활성화되도록 SKIP_WAITING 메시지를 보냅니다.
 */
export function PwaRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;

    let cancelled = false;

    const register = async () => {
      try {
        const registration = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
        if (cancelled) return;

        // 업데이트가 내려오면 대기 없이 새 워커로 교체합니다.
        registration.addEventListener("updatefound", () => {
          const installing = registration.installing;
          if (!installing) return;
          installing.addEventListener("statechange", () => {
            if (installing.state === "installed" && navigator.serviceWorker.controller) {
              installing.postMessage("SKIP_WAITING");
            }
          });
        });
      } catch (error) {
        // 등록 실패는 앱 사용을 막지 않습니다. (사생활 보호 모드 등)
        if (process.env.NODE_ENV !== "production") {
          console.warn("[pwa] 서비스 워커 등록 실패", error);
        }
      }
    };

    if (document.readyState === "complete") void register();
    else window.addEventListener("load", register, { once: true });

    return () => {
      cancelled = true;
      window.removeEventListener("load", register);
    };
  }, []);

  return null;
}
