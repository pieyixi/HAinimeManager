import { invokeTauri } from '../../api/tauri';
import type { AppStore } from '../../stores/app';
import { delay } from './mpv';

interface CapturedThumbnail { time: number; image_data: string }

export const playerThumbnailKey = (time: number): string => String(Math.round((Number(time) || 0) * 20) / 20);

export function buildPlayerThumbnailPrefetchBatches(duration: number): number[][] {
  const safeDuration = Math.max(0, Number(duration) || 0);
  if (!safeDuration) return [];
  const seen = new Set<string>();
  const batches: number[][] = [];
  for (let depth = 1; depth <= 7; depth += 1) {
    const denominator = 2 ** depth;
    const level: number[] = [];
    for (let numerator = 1; numerator < denominator; numerator += 2) {
      const time = Math.min(Math.max(0, safeDuration - 0.05), Math.max(0, Math.round((safeDuration * numerator / denominator) / 2) * 2));
      const key = playerThumbnailKey(time);
      if (seen.has(key) || key === '0') continue;
      seen.add(key);
      level.push(time);
    }
    for (let offset = 0; offset < level.length; offset += 8) batches.push(level.slice(offset, offset + 8));
  }
  return batches;
}

export function createPlayerThumbnails(state: AppStore, formatTime: (seconds: number) => string) {
  function store(time: number, imageData: string, exact: boolean): string | null {
    if (!imageData) return null;
    const key = playerThumbnailKey(Math.max(0, Number(time) || 0));
    const safeTime = Number(key);
    if (state.player.thumbnailExactKeys[key] && !exact) return key;
    if (!state.player.thumbnailCache[key]) {
      const times = state.player.thumbnailCacheTimes;
      let low = 0;
      let high = times.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (times[middle] < safeTime) low = middle + 1;
        else high = middle;
      }
      if (times[low] !== safeTime) times.splice(low, 0, safeTime);
      state.player.thumbnailCacheOrder.push(key);
    }
    state.player.thumbnailCache[key] = imageData;
    if (exact) state.player.thumbnailExactKeys[key] = true;
    while (state.player.thumbnailCacheOrder.length > 180) {
      const expiredKey = state.player.thumbnailCacheOrder.shift();
      if (!expiredKey) break;
      delete state.player.thumbnailCache[expiredKey];
      delete state.player.thumbnailExactKeys[expiredKey];
      const index = state.player.thumbnailCacheTimes.indexOf(Number(expiredKey));
      if (index >= 0) state.player.thumbnailCacheTimes.splice(index, 1);
    }
    return key;
  }

  function nearest(time: number): { time: number; imageData: string } | null {
    const times = state.player.thumbnailCacheTimes;
    if (!times.length) return null;
    const target = Math.max(0, Number(time) || 0);
    let low = 0;
    let high = times.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (times[middle] < target) low = middle + 1;
      else high = middle;
    }
    const right = times[Math.min(low, times.length - 1)];
    const left = times[Math.max(0, low - 1)];
    const found = Math.abs(target - left) <= Math.abs(right - target) ? left : right;
    return { time: found, imageData: state.player.thumbnailCache[playerThumbnailKey(found)] };
  }

  function display(imageData: string, time: number): void {
    const frame = document.getElementById('playerSeekPreviewFrame');
    if (!frame || !imageData) return;
    frame.style.backgroundImage = `url("${imageData}")`;
    frame.classList.remove('loading');
    frame.classList.add('has-frame');
    if (Number.isFinite(time)) state.player.thumbnailDisplayedTime = time;
  }

  async function prime(videoPath: string): Promise<void> {
    try {
      const captured = await invokeTauri<CapturedThumbnail>('prime_video_thumbnail', { videoPath });
      if (videoPath !== state.player.thumbnailVideoPath) return;
      store(0, captured.image_data, false);
      const preview = document.getElementById('playerSeekPreview');
      const frame = document.getElementById('playerSeekPreviewFrame');
      if (preview?.classList.contains('visible') && frame && !frame.classList.contains('has-frame')) display(captured.image_data, 0);
    } catch { /* A preview failure must never interrupt playback. */ }
  }

  function reset(videoPath: string): void {
    if (state.player.thumbnailTimer !== null) window.clearTimeout(state.player.thumbnailTimer);
    if (state.player.thumbnailRefineTimer !== null) window.clearTimeout(state.player.thumbnailRefineTimer);
    Object.assign(state.player, {
      thumbnailTimer: null,
      thumbnailRefineTimer: null,
      thumbnailVideoPath: videoPath || '',
      thumbnailHoverKey: null,
      thumbnailHoverTime: 0,
      thumbnailDisplayedTime: null,
      thumbnailPending: null,
      thumbnailCache: {},
      thumbnailExactKeys: {},
      thumbnailCacheOrder: [],
      thumbnailCacheTimes: [],
      thumbnailLastPointerTime: null,
      thumbnailLastPointerStamp: 0,
      thumbnailPointerVelocity: 0,
      thumbnailLatency: 0.08,
    });
    state.player.thumbnailRequestId += 1;
    state.player.thumbnailPrefetchGeneration += 1;
    const frame = document.getElementById('playerSeekPreviewFrame');
    if (frame) {
      frame.style.backgroundImage = '';
      frame.classList.remove('loading', 'has-frame');
    }
    if (videoPath) void prime(videoPath);
  }

  async function prefetch(videoPath: string, duration: number): Promise<void> {
    if (!videoPath || !(duration > 0)) return;
    const generation = state.player.thumbnailPrefetchGeneration;
    for (const times of buildPlayerThumbnailPrefetchBatches(duration)) {
      if (generation !== state.player.thumbnailPrefetchGeneration || videoPath !== state.player.thumbnailVideoPath) return;
      try {
        const frames = await invokeTauri<CapturedThumbnail[]>('prefetch_video_thumbnails', { videoPath, times });
        if (generation !== state.player.thumbnailPrefetchGeneration || videoPath !== state.player.thumbnailVideoPath) return;
        frames.forEach((frame) => store(frame.time, frame.image_data, false));
        const preview = document.getElementById('playerSeekPreview');
        if (preview?.classList.contains('visible')) {
          const found = nearest(state.player.thumbnailHoverTime);
          const displayedDistance = state.player.thumbnailDisplayedTime === null ? Infinity : Math.abs(state.player.thumbnailDisplayedTime - state.player.thumbnailHoverTime);
          if (found && Math.abs(found.time - state.player.thumbnailHoverTime) < displayedDistance) display(found.imageData, found.time);
        }
      } catch { return; }
      await delay(12);
    }
  }

  function valueFromPointer(event: PointerEvent): number {
    const seek = document.getElementById('playerSeek') as HTMLInputElement | null;
    if (!seek) return 0;
    const rect = seek.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
    return ratio * (Number(state.player.duration) || Number(seek.max) || 0);
  }

  function show(event: PointerEvent): number {
    const seek = document.getElementById('playerSeek') as HTMLInputElement | null;
    const preview = document.getElementById('playerSeekPreview');
    const time = document.getElementById('playerSeekPreviewTime');
    if (!seek || !preview) return 0;
    const rect = seek.getBoundingClientRect();
    const offset = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const halfWidth = (preview.offsetWidth || 170) / 2;
    preview.style.left = `${Math.max(halfWidth, Math.min(rect.width - halfWidth, offset))}px`;
    const target = valueFromPointer(event);
    if (time) time.textContent = formatTime(target);
    preview.classList.add('visible');
    request(target);
    return target;
  }

  function request(value: number): void {
    const frame = document.getElementById('playerSeekPreviewFrame');
    const videoPath = state.player.thumbnailVideoPath;
    if (!frame || !videoPath) return;
    const duration = Number(state.player.duration) || 0;
    let target = Math.max(0, Number(value) || 0);
    if (duration > 0) target = Math.min(Math.max(0, duration - 0.05), target);
    const now = performance.now();
    if (state.player.thumbnailLastPointerTime !== null) {
      const elapsed = now - state.player.thumbnailLastPointerStamp;
      if (elapsed > 0 && elapsed < 250) {
        const measured = Math.max(-1000, Math.min(1000, (target - state.player.thumbnailLastPointerTime) / (elapsed / 1000)));
        state.player.thumbnailPointerVelocity = state.player.thumbnailPointerVelocity * 0.62 + measured * 0.38;
      } else state.player.thumbnailPointerVelocity *= 0.35;
    }
    state.player.thumbnailLastPointerTime = target;
    state.player.thumbnailLastPointerStamp = now;
    state.player.thumbnailHoverTime = target;
    const found = nearest(target);
    if (found) display(found.imageData, found.time);

    const speed = Math.abs(state.player.thumbnailPointerVelocity);
    const quantum = speed > 500 ? 8 : speed > 200 ? 5 : speed > 60 ? 3 : 2;
    const lookAhead = Math.max(-8, Math.min(8, state.player.thumbnailPointerVelocity * state.player.thumbnailLatency));
    let cacheTime = Math.round((target + lookAhead) / quantum) * quantum;
    if (duration > 0) cacheTime = Math.min(Math.max(0, duration - 0.05), cacheTime);
    const key = playerThumbnailKey(cacheTime);
    state.player.thumbnailHoverKey = key;
    if (state.player.thumbnailCache[key]) {
      display(state.player.thumbnailCache[key], cacheTime);
      state.player.thumbnailPending = null;
      if (state.player.thumbnailTimer !== null) window.clearTimeout(state.player.thumbnailTimer);
      state.player.thumbnailTimer = null;
    } else {
      if (!frame.classList.contains('has-frame')) frame.classList.add('loading');
      queue(videoPath, cacheTime, key, false);
    }

    if (state.player.thumbnailRefineTimer !== null) window.clearTimeout(state.player.thumbnailRefineTimer);
    const refineTime = target;
    state.player.thumbnailRefineTimer = window.setTimeout(() => {
      const preview = document.getElementById('playerSeekPreview');
      if (!preview?.classList.contains('visible') || Math.abs(state.player.thumbnailHoverTime - refineTime) > 0.06) return;
      const refineKey = playerThumbnailKey(refineTime);
      state.player.thumbnailHoverKey = refineKey;
      if (state.player.thumbnailExactKeys[refineKey] && state.player.thumbnailCache[refineKey]) display(state.player.thumbnailCache[refineKey], refineTime);
      else queue(videoPath, refineTime, refineKey, true);
    }, 140);
  }

  function queue(videoPath: string, time: number, key: string, exact: boolean): void {
    state.player.thumbnailPending = { videoPath, time, key, exact, requestId: ++state.player.thumbnailRequestId };
    if (!state.player.thumbnailInFlight && state.player.thumbnailTimer === null) {
      state.player.thumbnailTimer = window.setTimeout(() => { state.player.thumbnailTimer = null; void drain(); }, 25);
    }
  }

  async function drain(): Promise<void> {
    if (state.player.thumbnailInFlight || !state.player.thumbnailPending) return;
    const pending = state.player.thumbnailPending;
    state.player.thumbnailPending = null;
    state.player.thumbnailInFlight = true;
    const started = performance.now();
    try {
      const captured = await invokeTauri<CapturedThumbnail>('get_video_thumbnail', { videoPath: pending.videoPath, time: pending.time, exact: pending.exact });
      const latency = Math.max(0.02, Math.min(0.35, (performance.now() - started) / 1000));
      state.player.thumbnailLatency = state.player.thumbnailLatency * 0.72 + latency * 0.28;
      if (pending.videoPath !== state.player.thumbnailVideoPath) return;
      store(pending.time, captured.image_data, pending.exact);
      if (pending.key === state.player.thumbnailHoverKey) display(captured.image_data, pending.time);
    } catch {
      if (pending.key === state.player.thumbnailHoverKey) document.getElementById('playerSeekPreviewFrame')?.classList.remove('loading');
    } finally {
      state.player.thumbnailInFlight = false;
      if (state.player.thumbnailPending) state.player.thumbnailTimer = window.setTimeout(() => { state.player.thumbnailTimer = null; void drain(); }, 10);
    }
  }

  function hide(): void {
    if (state.player.isSeeking) return;
    if (state.player.thumbnailTimer !== null) window.clearTimeout(state.player.thumbnailTimer);
    if (state.player.thumbnailRefineTimer !== null) window.clearTimeout(state.player.thumbnailRefineTimer);
    state.player.thumbnailTimer = null;
    state.player.thumbnailRefineTimer = null;
    state.player.thumbnailPending = null;
    state.player.thumbnailHoverKey = null;
    document.getElementById('playerSeekPreview')?.classList.remove('visible');
  }

  return { reset, prefetch, show, hide, valueFromPointer };
}
