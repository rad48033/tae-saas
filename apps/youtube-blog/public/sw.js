/* taest 서비스 워커
 * - 앱 셸(오프라인 안내 · 아이콘 · 매니페스트)을 미리 캐시합니다.
 * - 페이지 이동은 네트워크 우선, 실패하면 캐시 → 오프라인 안내 순서로 대응합니다.
 * - /api/ 요청은 절대 캐시하지 않습니다(항상 네트워크).
 * - Next.js 정적 자산(/_next/static)은 캐시 우선으로 빠르게 불러옵니다.
 */
const VERSION = "v1";
const SHELL_CACHE = `taest-shell-${VERSION}`;
const RUNTIME_CACHE = `taest-runtime-${VERSION}`;

const SHELL_ASSETS = [
  "/offline.html",
  "/manifest.webmanifest",
  "/favicon.svg",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // 한 파일이 실패해도 설치는 계속되도록 개별적으로 담습니다.
      await Promise.all(
        SHELL_ASSETS.map((asset) => cache.add(new Request(asset, { cache: "reload" })).catch(() => undefined)),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => key !== SHELL_CACHE && key !== RUNTIME_CACHE).map((key) => caches.delete(key)),
      );
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname === "/favicon.svg" ||
    url.pathname === "/manifest.webmanifest"
  );
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response && response.ok && response.type === "basic") {
      cache.put(request, response.clone()).catch(() => undefined);
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) {
    // 백그라운드에서 최신본으로 갱신합니다.
    fetch(request)
      .then((response) => {
        if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
      })
      .catch(() => undefined);
    return cached;
  }
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone()).catch(() => undefined);
  return response;
}

async function handleNavigation(request) {
  try {
    return await networkFirst(request, RUNTIME_CACHE);
  } catch (error) {
    const cache = await caches.open(RUNTIME_CACHE);
    const cachedPage = await cache.match(request);
    if (cachedPage) return cachedPage;
    const shell = await caches.open(SHELL_CACHE);
    const offline = await shell.match("/offline.html");
    if (offline) return offline;
    throw error;
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  // 결제·변환 등 동적 API는 서비스 워커가 관여하지 않습니다.
  if (url.pathname.startsWith("/api/")) return;

  if (request.mode === "navigate") {
    event.respondWith(handleNavigation(request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request, SHELL_CACHE));
    return;
  }

  event.respondWith(networkFirst(request, RUNTIME_CACHE));
});
