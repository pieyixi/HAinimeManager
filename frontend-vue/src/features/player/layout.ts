import type { AppStore } from '../../stores/app';
import { mpvPlugin, mpvSetProperty } from './mpv';

interface Bounds { left: number; top: number; right: number; bottom: number }

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

function applyHitTestGuard(state: AppStore, bounds: Bounds): Bounds {
  const guarded = { ...bounds };
  if (state.player.fullscreen && !document.body.classList.contains('player-controls-visible')) return guarded;
  const controls = document.querySelector<HTMLElement>('.player-controls');
  if (controls) {
    const controlsTop = Math.round(controls.getBoundingClientRect().top);
    if (Number.isFinite(controlsTop) && controlsTop <= guarded.bottom) {
      guarded.bottom = Math.max(guarded.top + 1, controlsTop - 1);
    }
  }
  return guarded;
}

function updateMasks(bounds: Bounds, width: number, height: number): void {
  const top = document.getElementById('playerMaskTop');
  const right = document.getElementById('playerMaskRight');
  const bottom = document.getElementById('playerMaskBottom');
  const left = document.getElementById('playerMaskLeft');
  if (!top || !right || !bottom || !left) return;
  const overlap = 2;
  top.style.cssText = `left:0;top:0;width:${width}px;height:${Math.max(0, bounds.top + overlap)}px`;
  bottom.style.cssText = `left:0;top:${Math.max(0, bounds.bottom - overlap)}px;width:${width}px;height:${Math.max(0, height - bounds.bottom + overlap)}px`;
  left.style.cssText = `left:0;top:${bounds.top}px;width:${Math.max(0, bounds.left + overlap)}px;height:${Math.max(0, bounds.bottom - bounds.top)}px`;
  right.style.cssText = `left:${Math.max(0, bounds.right - overlap)}px;top:${bounds.top}px;width:${Math.max(0, width - bounds.right + overlap)}px;height:${Math.max(0, bounds.bottom - bounds.top)}px`;
}

export function createPlayerLayout(state: AppStore) {
  async function syncBounds(): Promise<void> {
    const stage = document.getElementById('mpvStage');
    if (!stage) return;
    const viewport = viewportSize();
    const bounds = applyHitTestGuard(state, clampBounds(stage.getBoundingClientRect(), viewport.width, viewport.height));
    updateMasks(bounds, viewport.width, viewport.height);
    if (!state.player.libmpvReady) return;
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

  function scheduleSync(): void {
    if (!document.getElementById('page-player')?.classList.contains('active')) return;
    void syncBounds();
    [80, 240, 600, 1000].forEach((delay) => window.setTimeout(() => { void syncBounds(); }, delay));
  }

  function showFullscreenControls(): void {
    if (!state.player.fullscreen || document.body.classList.contains('player-controls-visible')) return;
    document.body.classList.add('player-controls-visible');
    if (state.player.libmpvReady) void mpvSetProperty('panscan', 1).catch(() => undefined);
    scheduleSync();
  }

  function hideFullscreenControls(applyFitMode: () => Promise<void>): void {
    if (!state.player.fullscreen) return;
    window.setTimeout(() => {
      const controls = document.querySelector('.player-controls');
      if (controls?.matches(':hover')) return;
      document.body.classList.remove('player-controls-visible');
      void applyFitMode();
      scheduleSync();
    }, 120);
  }

  return { syncBounds, scheduleSync, showFullscreenControls, hideFullscreenControls };
}
