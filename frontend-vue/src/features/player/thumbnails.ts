import { invokeTauri } from '../../api/tauri';
import type { PlayerStore } from '../../stores/player';
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

export function createPlayerThumbnails(player: PlayerStore, formatTime: (seconds: number) => string) {
  let requestTimer: number | null = null;
  let refineTimer: number | null = null;

  function clearTimers(): void {
    if (requestTimer !== null) window.clearTimeout(requestTimer);
    if (refineTimer !== null) window.clearTimeout(refineTimer);
    requestTimer = null;
    refineTimer = null;
  }

  function store(time: number, imageData: string, exact: boolean): string | null {
    if (!imageData) return null;
    const key = playerThumbnailKey(Math.max(0, Number(time) || 0));
    const safeTime = Number(key);
    if (player.thumbnailExactKeys[key] && !exact) return key;
    if (!player.thumbnailCache[key]) {
      let low = 0;
      let high = player.thumbnailCacheTimes.length;
      while (low < high) {
        const middle = (low + high) >> 1;
        if (player.thumbnailCacheTimes[middle] < safeTime) low = middle + 1;
        else high = middle;
      }
      if (player.thumbnailCacheTimes[low] !== safeTime) player.thumbnailCacheTimes.splice(low, 0, safeTime);
      player.thumbnailCacheOrder.push(key);
    }
    player.thumbnailCache[key] = imageData;
    if (exact) player.thumbnailExactKeys[key] = true;
    while (player.thumbnailCacheOrder.length > 180) {
      const expiredKey = player.thumbnailCacheOrder.shift();
      if (!expiredKey) break;
      delete player.thumbnailCache[expiredKey];
      delete player.thumbnailExactKeys[expiredKey];
      const index = player.thumbnailCacheTimes.indexOf(Number(expiredKey));
      if (index >= 0) player.thumbnailCacheTimes.splice(index, 1);
    }
    return key;
  }

  function nearest(time: number): { time: number; imageData: string } | null {
    if (!player.thumbnailCacheTimes.length) return null;
    const target = Math.max(0, Number(time) || 0);
    let low = 0;
    let high = player.thumbnailCacheTimes.length;
    while (low < high) {
      const middle = (low + high) >> 1;
      if (player.thumbnailCacheTimes[middle] < target) low = middle + 1;
      else high = middle;
    }
    const right = player.thumbnailCacheTimes[Math.min(low, player.thumbnailCacheTimes.length - 1)];
    const left = player.thumbnailCacheTimes[Math.max(0, low - 1)];
    const found = Math.abs(target - left) <= Math.abs(right - target) ? left : right;
    return { time: found, imageData: player.thumbnailCache[playerThumbnailKey(found)] };
  }

  function display(imageData: string, time: number): void {
    if (!imageData) return;
    player.previewImage = imageData;
    player.previewLoading = false;
    if (Number.isFinite(time)) player.thumbnailDisplayedTime = time;
  }

  async function prime(videoPath: string, generation: number): Promise<void> {
    try {
      const captured = await invokeTauri<CapturedThumbnail>('prime_video_thumbnail', { videoPath, generation });
      if (generation !== player.thumbnailPrefetchGeneration || videoPath !== player.thumbnailVideoPath) return;
      store(0, captured.image_data, false);
      if (player.previewVisible && !player.previewImage) display(captured.image_data, 0);
    } catch { /* Preview failure must never interrupt playback. */ }
  }

  function reset(videoPath: string): void {
    clearTimers();
    Object.assign(player, {
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
      previewVisible: false,
      previewLeft: 0,
      previewTimeText: '00:00',
      previewImage: '',
      previewLoading: false,
    });
    player.thumbnailRequestId += 1;
    player.thumbnailPrefetchGeneration += 1;
    if (videoPath) void prime(videoPath, player.thumbnailPrefetchGeneration);
  }

  async function release(): Promise<void> {
    reset('');
    try {
      await invokeTauri('release_video_thumbnail_decoders', { generation: player.thumbnailPrefetchGeneration });
    } catch { /* Decoder teardown must not block leaving the player. */ }
  }

  async function prefetch(videoPath: string, duration: number): Promise<void> {
    if (!videoPath || !(duration > 0)) return;
    const generation = player.thumbnailPrefetchGeneration;
    for (const times of buildPlayerThumbnailPrefetchBatches(duration)) {
      if (generation !== player.thumbnailPrefetchGeneration || videoPath !== player.thumbnailVideoPath) return;
      try {
        const frames = await invokeTauri<CapturedThumbnail[]>('prefetch_video_thumbnails', { videoPath, times, generation });
        if (generation !== player.thumbnailPrefetchGeneration || videoPath !== player.thumbnailVideoPath) return;
        frames.forEach((frame) => store(frame.time, frame.image_data, false));
        if (player.previewVisible) {
          const found = nearest(player.thumbnailHoverTime);
          const displayedDistance = player.thumbnailDisplayedTime === null ? Infinity : Math.abs(player.thumbnailDisplayedTime - player.thumbnailHoverTime);
          if (found && Math.abs(found.time - player.thumbnailHoverTime) < displayedDistance) display(found.imageData, found.time);
        }
      } catch { return; }
      await delay(12);
    }
  }

  function seekElement(event: PointerEvent): HTMLInputElement | null {
    return event.currentTarget instanceof HTMLInputElement ? event.currentTarget : null;
  }

  function valueFromPointer(event: PointerEvent): number {
    const seek = seekElement(event);
    if (!seek) return 0;
    const rect = seek.getBoundingClientRect();
    const ratio = rect.width > 0 ? Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)) : 0;
    return ratio * (Number(player.duration) || Number(seek.max) || 0);
  }

  function show(event: PointerEvent): number {
    const seek = seekElement(event);
    if (!seek) return 0;
    const rect = seek.getBoundingClientRect();
    const offset = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
    const halfWidth = 85;
    player.previewLeft = Math.max(halfWidth, Math.min(Math.max(halfWidth, rect.width - halfWidth), offset));
    const target = valueFromPointer(event);
    player.previewTimeText = formatTime(target);
    player.previewVisible = true;
    request(target);
    return target;
  }

  function request(value: number): void {
    const videoPath = player.thumbnailVideoPath;
    if (!videoPath) return;
    const duration = Number(player.duration) || 0;
    let target = Math.max(0, Number(value) || 0);
    if (duration > 0) target = Math.min(Math.max(0, duration - 0.05), target);
    const now = performance.now();
    if (player.thumbnailLastPointerTime !== null) {
      const elapsed = now - player.thumbnailLastPointerStamp;
      if (elapsed > 0 && elapsed < 250) {
        const measured = Math.max(-1000, Math.min(1000, (target - player.thumbnailLastPointerTime) / (elapsed / 1000)));
        player.thumbnailPointerVelocity = player.thumbnailPointerVelocity * 0.62 + measured * 0.38;
      } else player.thumbnailPointerVelocity *= 0.35;
    }
    player.thumbnailLastPointerTime = target;
    player.thumbnailLastPointerStamp = now;
    player.thumbnailHoverTime = target;
    const found = nearest(target);
    if (found) display(found.imageData, found.time);

    const speed = Math.abs(player.thumbnailPointerVelocity);
    const quantum = speed > 500 ? 8 : speed > 200 ? 5 : speed > 60 ? 3 : 2;
    const lookAhead = Math.max(-8, Math.min(8, player.thumbnailPointerVelocity * player.thumbnailLatency));
    let cacheTime = Math.round((target + lookAhead) / quantum) * quantum;
    if (duration > 0) cacheTime = Math.min(Math.max(0, duration - 0.05), cacheTime);
    const key = playerThumbnailKey(cacheTime);
    player.thumbnailHoverKey = key;
    if (player.thumbnailCache[key]) {
      display(player.thumbnailCache[key], cacheTime);
      player.thumbnailPending = null;
      if (requestTimer !== null) window.clearTimeout(requestTimer);
      requestTimer = null;
    } else {
      if (!player.previewImage) player.previewLoading = true;
      queue(videoPath, cacheTime, key, false);
    }

    if (refineTimer !== null) window.clearTimeout(refineTimer);
    const refineTime = target;
    refineTimer = window.setTimeout(() => {
      refineTimer = null;
      if (!player.previewVisible || Math.abs(player.thumbnailHoverTime - refineTime) > 0.06) return;
      const refineKey = playerThumbnailKey(refineTime);
      player.thumbnailHoverKey = refineKey;
      if (player.thumbnailExactKeys[refineKey] && player.thumbnailCache[refineKey]) display(player.thumbnailCache[refineKey], refineTime);
      else queue(videoPath, refineTime, refineKey, true);
    }, 140);
  }

  function queue(videoPath: string, time: number, key: string, exact: boolean): void {
    player.thumbnailPending = { videoPath, time, key, exact, requestId: ++player.thumbnailRequestId, generation: player.thumbnailPrefetchGeneration };
    if (!player.thumbnailInFlight && requestTimer === null) {
      requestTimer = window.setTimeout(() => { requestTimer = null; void drain(); }, 25);
    }
  }

  async function drain(): Promise<void> {
    if (player.thumbnailInFlight || !player.thumbnailPending) return;
    const pending = player.thumbnailPending;
    player.thumbnailPending = null;
    player.thumbnailInFlight = true;
    const started = performance.now();
    try {
      const captured = await invokeTauri<CapturedThumbnail>('get_video_thumbnail', {
        videoPath: pending.videoPath,
        time: pending.time,
        exact: pending.exact,
        generation: pending.generation,
      });
      const latency = Math.max(0.02, Math.min(0.35, (performance.now() - started) / 1000));
      player.thumbnailLatency = player.thumbnailLatency * 0.72 + latency * 0.28;
      if (pending.generation !== player.thumbnailPrefetchGeneration || pending.videoPath !== player.thumbnailVideoPath) return;
      store(pending.time, captured.image_data, pending.exact);
      if (pending.key === player.thumbnailHoverKey) display(captured.image_data, pending.time);
    } catch {
      if (pending.key === player.thumbnailHoverKey) player.previewLoading = false;
    } finally {
      player.thumbnailInFlight = false;
      if (player.thumbnailPending) requestTimer = window.setTimeout(() => { requestTimer = null; void drain(); }, 10);
    }
  }

  function hide(): void {
    if (player.isSeeking) return;
    clearTimers();
    player.thumbnailPending = null;
    player.thumbnailHoverKey = null;
    player.previewVisible = false;
  }

  function dispose(): void {
    reset('');
  }

  return { reset, release, prefetch, show, hide, valueFromPointer, dispose };
}
