import { contextBridge, ipcRenderer } from "electron";

export type ConnectionState = {
  serverUrl: string | null;
  source: "settings" | "env" | "bundled" | "sidecar" | null;
  error: string | null;
  version: string;
  platform: string;
  packaged: boolean;
};

export type TestResult = { ok: boolean; message: string; status?: number; elapsed?: number };

export type ConnectResult = { ok: boolean; message?: string; serverUrl?: string; source?: string };

const bridge = {
  getState: (): Promise<ConnectionState> => ipcRenderer.invoke("taest:get-state"),
  testConnection: (serverUrl: string): Promise<TestResult> => ipcRenderer.invoke("taest:test-connection", serverUrl),
  connect: (serverUrl?: string): Promise<ConnectResult> => ipcRenderer.invoke("taest:connect", serverUrl ?? ""),
  reset: (): Promise<{ ok: boolean }> => ipcRenderer.invoke("taest:reset"),
};

contextBridge.exposeInMainWorld("taest", bridge);

export type TaestBridge = typeof bridge;
