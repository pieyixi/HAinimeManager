type InvokeArgs = Record<string, unknown>;

interface TauriCore {
  invoke<T>(command: string, args?: InvokeArgs): Promise<T>;
  convertFileSrc?(path: string): string;
}

interface TauriGlobal {
  core?: TauriCore;
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

export function convertFilePath(path: string): string {
  const convertFileSrc = window.__TAURI__?.core?.convertFileSrc;
  if (convertFileSrc) return convertFileSrc(path);
  return `file:///${path.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:')}`;
}
