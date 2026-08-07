type InvokeArgs = Record<string, unknown>;

interface TauriCore {
  invoke<T>(command: string, args?: InvokeArgs): Promise<T>;
  convertFileSrc?(path: string): string;
}

export interface TauriWindowHandle {
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  startDragging(): Promise<void>;
  isMaximized(): Promise<boolean>;
  onResized(handler: () => void): Promise<() => void>;
}

interface TauriGlobal {
  core?: TauriCore;
  event?: {
    listen<T>(event: string, handler: (event: { payload: T }) => void): Promise<() => void>;
  };
  window?: {
    getCurrentWindow?(): TauriWindowHandle;
  };
  invoke?: TauriCore['invoke'];
}

declare global {
  interface Window {
    __TAURI__?: TauriGlobal;
  }
}

function core(): TauriCore | undefined {
  if (window.__TAURI__?.core) return window.__TAURI__.core;
  if (window.__TAURI__?.invoke) return { invoke: window.__TAURI__.invoke };
  return undefined;
}

export function isTauriConnected(): boolean {
  return Boolean(core());
}

export async function invokeTauri<T>(command: string, args?: InvokeArgs): Promise<T> {
  const tauri = core();
  if (!tauri) throw new Error('Tauri runtime is not connected');
  return tauri.invoke<T>(command, args);
}

export async function listenTauri<T>(event: string, handler: (payload: T) => void): Promise<() => void> {
  const listen = window.__TAURI__?.event?.listen;
  if (!listen) throw new Error('Tauri event runtime is not connected');
  return listen<T>(event, ({ payload }) => handler(payload));
}

export function convertFilePath(path: string): string {
  const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
  if (convertFileSrc) return convertFileSrc(path);
  return `file:///${path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')}`;
}

export function currentTauriWindow(): TauriWindowHandle | null {
  return window.__TAURI__?.window?.getCurrentWindow?.() || null;
}
