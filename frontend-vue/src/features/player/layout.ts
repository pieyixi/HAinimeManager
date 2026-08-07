import type { PlayerStore, PlayerVideoHole } from '../../stores/player';
import { useNavigationStore } from '../../stores/navigation';
import { mpvPlugin } from './mpv';

interface Bounds { left: number; top: number; right: number; bottom: number }

export interface PlayerLayoutElements {
  stage: HTMLElement | null;
  controls: HTMLElement | null;
}

function viewportSize(): { width: number; height: number } {
  return {
    width: Math.max(1, document.documentElement.clientWidth || 0, window.innerWidth || 0),
    height: Math.max(1, document.documentElement.clientHeight || 0, window.innerHeight || 0),
  };
}

function clampBounds(rect: DOMRect, width: number, height: number): Bounds {
  const left = Math.max(0, Math.min(width, Math.round(rect.left)));
  const top = Math.max(0, Math.min(height, Math.round(rect.top)));
  const right = Math.max(left + 1, Math.min(width, Math.round(rect.right)));
  const bottom = Math.max(top + 1, Math.min(height, Math.round(rect.bottom)));
  return { left, top, right, bottom };
}

function videoHole(left: number, top: number, width: number, height: number): PlayerVideoHole {
  return { left, top, width: Math.max(0, width), height: Math.max(0, height) };
}

export function createPlayerLayout(player: PlayerStore) {
  const navigation = useNavigationStore();
  const elements: PlayerLayoutElements = { stage: null, controls: null };
  const scheduled = new Set<number>();

  function bind(next: PlayerLayoutElements): void {
    elements.stage = next.stage;
    elements.controls = next.controls;
  }

  function applyHitTestGuard(bounds: Bounds): Bounds {
    const guarded = { ...bounds };
    if (player.fullscreen) return guarded;
    const controlsTop = Math.round(elements.controls?.getBoundingClientRect().top ?? Number.NaN);
    if (Number.isFinite(controlsTop) && controlsTop <= guarded.bottom) guarded.bottom = Math.max(guarded.top + 1, controlsTop - 1);
    return guarded;
  }

  async function syncBounds(): Promise<void> {
    if (!elements.stage) return;
    const viewport = viewportSize();
    const bounds = applyHitTestGuard(clampBounds(elements.stage.getBoundingClientRect(), viewport.width, viewport.height));
    if (player.libmpvReady) {
      await mpvPlugin('set_video_margin_ratio', {
        windowLabel: 'main',
        ratio: {
        left: bounds.left / viewport.width,
        right: (viewport.width - bounds.right) / viewport.width,
        top: bounds.top / viewport.height,
        bottom: (viewport.height - bounds.bottom) / viewport.height,
        },
      }).catch(() => undefined);
    }
    player.videoHole = videoHole(bounds.left, bounds.top, bounds.right - bounds.left, bounds.bottom - bounds.top);
  }

  function scheduleSync(): void {
    if (navigation.activePage !== 'page-player') return;
    void syncBounds();
    [80, 240, 600, 1000].forEach((delay) => {
      const timer = window.setTimeout(() => {
        scheduled.delete(timer);
        void syncBounds();
      }, delay);
      scheduled.add(timer);
    });
  }

  function showFullscreenControls(): void {
    if (!player.fullscreen || player.controlsVisible) return;
    player.controlsVisible = true;
  }

  function hideFullscreenControls(): void {
    if (!player.fullscreen) return;
    const timer = window.setTimeout(() => {
      scheduled.delete(timer);
      if (elements.controls?.matches(':hover')) return;
      player.controlsVisible = false;
    }, 120);
    scheduled.add(timer);
  }

  function dispose(): void {
    scheduled.forEach((timer) => window.clearTimeout(timer));
    scheduled.clear();
    bind({ stage: null, controls: null });
  }

  return { bind, syncBounds, scheduleSync, showFullscreenControls, hideFullscreenControls, dispose };
}
