import type { AppStore } from '../stores/app';
import { isTauriConnected } from '../api/tauri';

type RuntimeFunction = (...args: unknown[]) => unknown;

function globalFunction(name: string): RuntimeFunction | undefined {
  const value = (window as typeof window & Record<string, unknown>)[name];
  return typeof value === 'function' ? value as RuntimeFunction : undefined;
}

function call(name: string, ...args: unknown[]): unknown {
  return globalFunction(name)?.(...args);
}

function elementTarget(event: Event): Element | null {
  return event.target instanceof Element ? event.target : null;
}

export function installApplicationEvents(state: AppStore): () => void {
  const cleanups: Array<() => void> = [];
  const listen = <K extends keyof WindowEventMap>(target: Window, type: K, listener: (event: WindowEventMap[K]) => void) => {
    target.addEventListener(type, listener as EventListener);
    cleanups.push(() => target.removeEventListener(type, listener as EventListener));
  };
  const listenDocument = <K extends keyof DocumentEventMap>(type: K, listener: (event: DocumentEventMap[K]) => void) => {
    document.addEventListener(type, listener as EventListener);
    cleanups.push(() => document.removeEventListener(type, listener as EventListener));
  };

  document.querySelectorAll<HTMLElement>('.filter-btn[data-filter]').forEach((button) => {
    const listener = (event: MouseEvent) => {
      event.stopPropagation();
      call('openDropdown', button.getAttribute('data-filter'), button);
    };
    button.addEventListener('click', listener);
    cleanups.push(() => button.removeEventListener('click', listener));
  });

  const sortTimeButton = document.getElementById('sortTimeBtn');
  const sortNameButton = document.getElementById('sortNameBtn');
  const sortTime = () => call('setSort', state.currentSort === 'time-desc' ? 'time-asc' : 'time-desc');
  const sortName = () => call('setSort', (state.currentSort === 'name-asc' || state.currentSort === 'name-desc')
    ? (state.currentSort === 'name-asc' ? 'name-desc' : 'name-asc')
    : 'name-asc');
  sortTimeButton?.addEventListener('click', sortTime);
  sortNameButton?.addEventListener('click', sortName);
  cleanups.push(() => sortTimeButton?.removeEventListener('click', sortTime));
  cleanups.push(() => sortNameButton?.removeEventListener('click', sortName));

  function handlePlayerKeydown(event: KeyboardEvent): boolean {
    if (!document.getElementById('page-player')?.classList.contains('active')) return false;
    const playerSeekFocused = event.target instanceof HTMLElement && event.target.id === 'playerSeek';
    if (isTypingTarget(event.target) && !playerSeekFocused) return false;
    if (event.key === ' ') {
      if (!event.repeat) call('togglePlayerPlay');
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      if (!event.repeat) call('beginPlayerKeySeek', event.key === 'ArrowRight' ? 1 : -1);
    } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
      if (!event.repeat) call('adjustPlayerVolume', event.key === 'ArrowUp' ? 5 : -5);
    } else if (event.key === ',' || event.key === '.') {
      if (!event.repeat) call('stepPlayerFrame', event.key === ',' ? -1 : 1);
    } else if (event.key.toLowerCase() === 'm') {
      if (!event.repeat) call('toggleMute');
    } else if (event.key.toLowerCase() === 'f') {
      if (!event.repeat) call('togglePlayerFullscreen');
    } else if (event.key === 'Enter' && state.player.mode === 'archive') {
      if (!event.repeat) call('captureCurrentFrame');
    } else if (event.key === 'Escape') {
      if (!event.repeat) {
        if (state.player.fullscreen) call('setPlayerFullscreen', false);
        else call('returnFromPlayer');
      }
    } else {
      return false;
    }
    event.preventDefault();
    return true;
  }

  function handlePlayerKeyup(event: KeyboardEvent): void {
    if (!document.getElementById('page-player')?.classList.contains('active')) return;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      call('stopPlayerKeySeek');
      event.preventDefault();
    }
  }

  function isTypingTarget(target: EventTarget | null): boolean {
    if (!(target instanceof HTMLElement)) return false;
    const tag = target.tagName.toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
  }

  listenDocument('click', (event) => {
    const target = elementTarget(event);
    const dropdown = document.getElementById('filterDropdown');
    if (dropdown && target && !dropdown.contains(target) && !target.closest('.filter-btn')) call('closeDropdown');
    if (!target?.closest('.context-menu')) call('closeWorkContextMenu');
  });

  listenDocument('contextmenu', (event) => {
    const target = elementTarget(event);
    if (target?.closest('.cover-card')) return;
    if (target?.closest('#page-home.active .cover-grid') || target?.closest('#page-home.active .workspace')) {
      call('showHomeContextMenu', event);
      return;
    }
    event.preventDefault();
    call('closeWorkContextMenu');
  });

  listenDocument('keydown', (event) => {
    if (handlePlayerKeydown(event)) return;
    if (event.key === 'Escape') {
      call('closeDropdown');
      call('closeWorkContextMenu');
      call('resolveConfirm', false);
    }
  });
  listenDocument('keyup', handlePlayerKeyup);

  const confirmModal = document.getElementById('confirmModal');
  const closeConfirm = (event: MouseEvent) => {
    if (event.target === confirmModal) call('resolveConfirm', false);
  };
  confirmModal?.addEventListener('click', closeConfirm);
  cleanups.push(() => confirmModal?.removeEventListener('click', closeConfirm));

  let resizeTimer: number | null = null;
  listen(window, 'resize', () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (document.getElementById('page-player')?.classList.contains('active')) {
        call('scheduleMpvBoundsSync');
        return;
      }
      if (!document.getElementById('page-home')?.classList.contains('active')) return;
      if (call('updatePageSize', true)) call('applyFilter');
    }, 80);
  });
  listen(window, 'focus', () => { call('scheduleMpvBoundsSync'); });
  listen(window, 'mouseup', () => { call('scheduleMpvBoundsSync'); });

  Object.assign(window, { handlePlayerKeydown, handlePlayerKeyup, isTypingTarget });

  if (isTauriConnected()) {
    void (async () => {
      const libraryStatus = await globalFunction('initializeMediaLibrary')?.() as { needs_binding?: boolean } | undefined;
      await globalFunction('init')?.();
      if (libraryStatus?.needs_binding) call('openSettingsPage');
    })();
  } else {
    const grid = document.getElementById('coverGrid');
    if (grid) grid.innerHTML = '<div class="empty-state"><h2>Tauri 未连接</h2><p>请在 Tauri 窗口中打开此页面</p></div>';
  }

  return () => {
    if (resizeTimer !== null) window.clearTimeout(resizeTimer);
    cleanups.reverse().forEach((cleanup) => cleanup());
  };
}
