import path from "node:path";
import { pathToFileURL } from "node:url";

import { app, BrowserWindow, Menu, ipcMain, session, shell } from "electron";

import {
  clearSettings,
  readBundledServerUrl,
  readSettings,
  readSidecarServerUrl,
  resolveServerUrl,
  saveSettings,
  type ResolvedServerUrl,
} from "./config";
import { displayHost, isSameOrigin, normalizeServerUrl } from "./url";

const APP_TITLE = "taest";
const APP_VERSION = app.getVersion();

let mainWindow: BrowserWindow | null = null;
let current: ResolvedServerUrl | null = null;
let lastError: string | null = null;

function setupPagePath(): string {
  return path.join(__dirname, "..", "renderer", "index.html");
}

function setupPageUrl(error?: string | null): string {
  const url = pathToFileURL(setupPagePath());
  if (error) url.searchParams.set("error", error);
  if (current) url.searchParams.set("current", current.url);
  return url.toString();
}

function bundledUrlPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, "default-url.json")
    : path.join(__dirname, "..", "default-url.json");
}

function sidecarUrlPath(): string {
  return path.join(path.dirname(app.getPath("exe")), "tae-saas-url.txt");
}

async function resolveCurrent(): Promise<ResolvedServerUrl | null> {
  const settings = await readSettings(app.getPath("userData"));
  const bundled = await readBundledServerUrl(bundledUrlPath());
  const sidecar = await readSidecarServerUrl(sidecarUrlPath());
  return resolveServerUrl({
    settings: settings.serverUrl,
    env: process.env.TAE_SAAS_WEB_URL,
    bundled,
    sidecar,
  });
}

function friendlyLoadError(errorCode: number, description: string): string {
  if (errorCode === -105 || errorCode === -106) return "서버에 연결할 수 없습니다. 주소와 인터넷 연결을 확인해 주세요.";
  if (errorCode === -137) return "서버 주소를 찾을 수 없습니다. 주소 철자를 확인해 주세요.";
  if (errorCode === -200 || errorCode === -201) return "보안 인증서에 문제가 있어 연결하지 못했습니다.";
  return `페이지를 불러오지 못했습니다 (${description || errorCode}).`;
}

async function showSetup(error?: string | null) {
  if (!mainWindow) return;
  lastError = error ?? null;
  mainWindow.setTitle(`${APP_TITLE} · 서버 연결`);
  await mainWindow.loadURL(setupPageUrl(lastError)).catch(() => undefined);
}

async function connect(window: BrowserWindow, target: ResolvedServerUrl) {
  current = target;
  lastError = null;
  window.setTitle(`${APP_TITLE} · ${displayHost(target.url)}`);
  await window.loadURL(target.url).catch(() => undefined);
}

function createWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 420,
    minHeight: 560,
    show: false,
    backgroundColor: "#ffffff",
    title: APP_TITLE,
    icon: path.join(__dirname, "..", "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: true,
    },
  });

  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    mainWindow = null;
  });

  // 새 창은 기본 브라우저로 넘기고, 앱 밖으로 나가는 이동도 브라우저에서 엽니다.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  window.webContents.on("will-navigate", (event, url) => {
    if (url.startsWith("file://")) return;
    if (current && isSameOrigin(url, current.url)) return;
    event.preventDefault();
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
  });

  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, _validatedUrl, isMainFrame) => {
    // -3(ABORTED)은 정상적인 취소입니다.
    if (!isMainFrame || errorCode === -3) return;
    if (current && lastError === null) {
      void showSetup(friendlyLoadError(errorCode, errorDescription));
    }
  });

  return window;
}

function buildMenu() {
  const template: Electron.MenuItemConstructorOptions[] = [
    {
      label: "파일",
      submenu: [
        {
          label: "새로고침",
          accelerator: "CmdOrCtrl+R",
          click: () => {
            if (!mainWindow) return;
            if (current) void connect(mainWindow, current);
            else void showSetup(lastError);
          },
        },
        { type: "separator" },
        {
          label: "서버 연결 설정",
          accelerator: "CmdOrCtrl+,",
          click: () => void showSetup(lastError),
        },
        { type: "separator" },
        { role: "quit", label: "종료" },
      ],
    },
    {
      label: "편집",
      submenu: [
        { role: "undo", label: "실행 취소" },
        { role: "redo", label: "다시 실행" },
        { type: "separator" },
        { role: "cut", label: "잘라내기" },
        { role: "copy", label: "복사" },
        { role: "paste", label: "붙여넣기" },
        { role: "selectAll", label: "모두 선택" },
      ],
    },
    {
      label: "보기",
      submenu: [
        { role: "resetZoom", label: "기본 크기" },
        { role: "zoomIn", label: "확대" },
        { role: "zoomOut", label: "축소" },
        { type: "separator" },
        { role: "togglefullscreen", label: "전체 화면" },
        { role: "toggleDevTools", label: "개발자 도구" },
      ],
    },
    {
      label: "도움말",
      submenu: [
        {
          label: "taest 웹사이트 열기",
          click: () => void shell.openExternal("https://taest.info"),
        },
        {
          label: `버전 ${APP_VERSION}`,
          enabled: false,
        },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function registerIpc() {
  ipcMain.handle("taest:get-state", async () => {
    if (!current) current = await resolveCurrent();
    return {
      serverUrl: current?.url ?? null,
      source: current?.source ?? null,
      error: lastError,
      version: APP_VERSION,
      platform: process.platform,
      packaged: app.isPackaged,
    };
  });

  ipcMain.handle("taest:test-connection", async (_event, rawUrl: unknown) => {
    const checked = normalizeServerUrl(typeof rawUrl === "string" ? rawUrl : "");
    if (!checked.ok) return { ok: false, message: checked.error };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 6000);
    const startedAt = Date.now();
    try {
      const response = await fetch(checked.url, { method: "GET", signal: controller.signal, redirect: "follow" });
      const elapsed = Date.now() - startedAt;
      return {
        ok: response.status < 500,
        status: response.status,
        elapsed,
        message: response.status < 500 ? `${elapsed}ms 만에 응답했습니다 (HTTP ${response.status}).` : `서버가 HTTP ${response.status}로 응답했습니다.`,
      };
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError" ? "6초 안에 응답이 없습니다." : "서버에 연결할 수 없습니다.";
      return { ok: false, message };
    } finally {
      clearTimeout(timer);
    }
  });

  ipcMain.handle("taest:connect", async (_event, rawUrl: unknown) => {
    if (!mainWindow) return { ok: false, message: "창이 준비되지 않았습니다." };

    let target: ResolvedServerUrl | null = null;
    if (typeof rawUrl === "string" && rawUrl.trim().length > 0) {
      const checked = normalizeServerUrl(rawUrl);
      if (!checked.ok) return { ok: false, message: checked.error };
      try {
        await saveSettings(app.getPath("userData"), checked.url);
      } catch (error) {
        return { ok: false, message: error instanceof Error ? error.message : "설정을 저장하지 못했습니다." };
      }
      target = { url: checked.url, source: "settings" };
    } else {
      target = await resolveCurrent();
    }

    if (!target) {
      await showSetup("연결할 서버 주소가 없습니다. 주소를 입력해 주세요.");
      return { ok: false, message: "연결할 서버 주소가 없습니다." };
    }

    await connect(mainWindow, target);
    return { ok: true, serverUrl: target.url, source: target.source };
  });

  ipcMain.handle("taest:reset", async () => {
    await clearSettings(app.getPath("userData"));
    current = null;
    await showSetup(null);
    return { ok: true };
  });
}

async function bootstrap() {
  registerIpc();
  buildMenu();

  // 클립보드 복사·알림만 허용하고 카메라·위치 등 나머지 권한은 요청하지 않습니다.
  const allowedPermissions = new Set([
    "clipboard-read",
    "clipboard-sanitized-write",
    "clipboard-write",
    "notifications",
    "fullscreen",
  ]);
  session.defaultSession.setPermissionRequestHandler((_contents, permission, callback) => {
    callback(allowedPermissions.has(permission));
  });

  mainWindow = createWindow();
  current = await resolveCurrent();

  if (current) {
    await connect(mainWindow, current);
  } else {
    await showSetup("처음 실행입니다. taest 서버 주소를 입력해 주세요.");
  }
}

const hasLock = app.requestSingleInstanceLock();
if (!hasLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  app.setAppUserModelId("info.taest.desktop");
  app.userAgentFallback = `${app.userAgentFallback} taestDesktop/${APP_VERSION}`;

  app.whenReady().then(bootstrap).catch((error) => {
    console.error("[taest] 시작 실패", error);
    app.quit();
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length > 0) return;
    mainWindow = createWindow();
    void (current ? connect(mainWindow, current) : showSetup(lastError));
  });
}
