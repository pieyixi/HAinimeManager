import { isTauriConnected } from '../api/tauri';
import { playerCommands } from '../features/player/commands';
import type { useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';
import { usePlayerStore } from '../stores/player';
import { useSettingsStore } from '../stores/settings';

type LibraryStore = ReturnType<typeof useLibraryStore>;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

export function installApplicationEvents(library: LibraryStore): () => void {
  const navigation = useNavigationStore();
  const player = usePlayerStore();
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
      if (!event.repeat) void playerCommands.togglePlay();
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!event.repeat) playerCommands.beginKeySeek(event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!event.repeat) playerCommands.adjustVolume(event.key === 'ArrowUp' ? 5 : -5);
    } else if (event.key === ',' || event.key === '.') {
      if (!event.repeat) void playerCommands.stepFrame(event.key === ',' ? -1 : 1);
    } else if (event.key.toLowerCase() === 'm') {
      if (!event.repeat) void playerCommands.toggleMute();
    } else if (event.key.toLowerCase() === 'f') {
      if (!event.repeat) void playerCommands.toggleFullscreen();
    } else if (event.key === 'Enter' && player.mode === 'archive') {
      if (!event.repeat) void playerCommands.captureCurrentFrame();
    } else if (event.key === 'Escape') {
      if (!event.repeat) {
        if (player.fullscreen) void playerCommands.setFullscreen(false);
        else void playerCommands.returnFromPlayer();
      }
    } else return false;
    event.preventDefault();
    return true;
  }

  function handlePlayerKeyup(event: KeyboardEvent): void {
    if (navigation.activePage !== 'page-player') return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      playerCommands.stopKeySeek();
      event.preventDefault();
    }
  }

  listenDocument('keydown', (event) => { handlePlayerKeydown(event); });
  listenDocument('keyup', handlePlayerKeyup);
  listenDocument('contextmenu', (event) => {
    event.preventDefault();
    const insideHomeGrid = navigation.activePage === 'page-home'
      && event.composedPath().some((node) => node instanceof HTMLElement && node.id === 'coverGrid');
    if (insideHomeGrid) return;
    library.closeDropdown();
    navigation.closeContextMenu();
  });

  let resizeTimer: number | null = null;
  listen(window, 'resize', () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (navigation.activePage === 'page-player') playerCommands.scheduleBoundsSync();
    }, 80);
  });
  listen(window, 'focus', () => { if (navigation.activePage === 'page-player') playerCommands.scheduleBoundsSync(); });
  listen(window, 'mouseup', () => { if (navigation.activePage === 'page-player') playerCommands.scheduleBoundsSync(); });

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
