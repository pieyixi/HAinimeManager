import { isTauriConnected } from '../api/tauri';
import type { AppStore } from '../stores/app';
import type { useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';
import { useSettingsStore } from '../stores/settings';

type LibraryStore = ReturnType<typeof useLibraryStore>;
type PlayerFunction = (...args: unknown[]) => unknown;

function playerFunction(name: string): PlayerFunction | undefined {
  const value = (window as typeof window & Record<string, unknown>)[name];
  return typeof value === 'function' ? value as PlayerFunction : undefined;
}

function playerCall(name: string, ...args: unknown[]): unknown {
  return playerFunction(name)?.(...args);
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function installApplicationEvents(state: AppStore, library: LibraryStore): () => void {
  const navigation = useNavigationStore();
  const settings = useSettingsStore();
  const cleanups: Array<() => void> = [];

  function listen<K extends keyof WindowEventMap>(target: Window, type: K, listener: (event: WindowEventMap[K]) => void): void {
    target.addEventListener(type, listener as EventListener);
    cleanups.push(() => target.removeEventListener(type, listener as EventListener));
  }

  function listenDocument<K extends keyof DocumentEventMap>(type: K, listener: (event: DocumentEventMap[K]) => void): void {
    document.addEventListener(type, listener as EventListener);
    cleanups.push(() => document.removeEventListener(type, listener as EventListener));
  }

  function handlePlayerKeydown(event: KeyboardEvent): boolean {
    if (navigation.activePage !== 'page-player') return false;
    const seekFocused = event.target instanceof HTMLElement && event.target.id === 'playerSeek';
    if (isTypingTarget(event.target) && !seekFocused) return false;
    if (event.key === ' ') {
      if (!event.repeat) playerCall('togglePlayerPlay');
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!event.repeat) playerCall('beginPlayerKeySeek', event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!event.repeat) playerCall('adjustPlayerVolume', event.key === 'ArrowUp' ? 5 : -5);
    } else if (event.key === ',' || event.key === '.') {
      if (!event.repeat) playerCall('stepPlayerFrame', event.key === ',' ? -1 : 1);
    } else if (event.key.toLowerCase() === 'm') {
      if (!event.repeat) playerCall('toggleMute');
    } else if (event.key.toLowerCase() === 'f') {
      if (!event.repeat) playerCall('togglePlayerFullscreen');
    } else if (event.key === 'Enter' && state.player.mode === 'archive') {
      if (!event.repeat) playerCall('captureCurrentFrame');
    } else if (event.key === 'Escape') {
      if (!event.repeat) {
        if (state.player.fullscreen) playerCall('setPlayerFullscreen', false);
        else playerCall('returnFromPlayer');
      }
    } else return false;
    event.preventDefault();
    return true;
  }

  function handlePlayerKeyup(event: KeyboardEvent): void {
    if (navigation.activePage !== 'page-player') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      playerCall('stopPlayerKeySeek');
      event.preventDefault();
    }
  }

  listenDocument('keydown', (event) => { handlePlayerKeydown(event); });
  listenDocument('keyup', handlePlayerKeyup);

  let resizeTimer: number | null = null;
  listen(window, 'resize', () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (navigation.activePage === 'page-player') playerCall('scheduleMpvBoundsSync');
    }, 80);
  });
  listen(window, 'focus', () => { if (navigation.activePage === 'page-player') playerCall('scheduleMpvBoundsSync'); });
  listen(window, 'mouseup', () => { if (navigation.activePage === 'page-player') playerCall('scheduleMpvBoundsSync'); });

  if (isTauriConnected()) {
    void (async () => {
      const status = await settings.initializeMediaLibrary();
      await library.initialize();
      if (status.needs_binding) await settings.openSettingsPage();
    })();
  } else library.showDisconnected();

  return () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    cleanups.reverse().forEach((cleanup) => cleanup());
  };
}
