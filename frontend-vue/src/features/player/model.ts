import type { PlayerEpisode } from '../../stores/app';
import type { PlayerFitMode } from '../../stores/player';

export const playerFitModes: Record<PlayerFitMode, { label: string; panscan: number; unscaled: boolean }> = {
  contain: { label: '完整显示', panscan: 0, unscaled: false },
  fill: { label: '填满画面', panscan: 1, unscaled: false },
  original: { label: '原始尺寸', panscan: 0, unscaled: true },
};

export function formatPlayerTime(seconds: number): string {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = Math.floor(total % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

export function parsePlayerTime(value: string): number | null {
  const parts = String(value || '').trim().split(':');
  if (parts.length > 3 || parts.some((part) => !part || !/^\d+$/.test(part))) return null;
  const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
  return Number.isFinite(seconds) ? seconds : null;
}

export function formatPlayerSpeed(value: number): string {
  return `${(Number(value) || 1).toFixed(2).replace(/\.00$/, '').replace(/0$/, '')}×`;
}

export function playerEpisodeNumber(episode: PlayerEpisode): number {
  return Number(episode.number || episode.id) || 1;
}

export function nextPlayerEpisodeIndex(currentIndex: number, length: number, wrap: boolean): number | null {
  if (currentIndex < 0 || length <= 0) return null;
  const next = currentIndex + 1;
  if (next < length) return next;
  return wrap ? 0 : null;
}

export function playerEpisodeSubtitle(episode: PlayerEpisode, workTitle: string): string {
  const title = String(episode.subtitle || episode.title || '').trim();
  if (!title || /^第?\s*0*\d+\s*[集话話]$/i.test(title) || /^#\s*0*\d+$/i.test(title)) return '';
  const normalizedTitle = title.replace(/\s+/g, '');
  const normalizedWork = String(workTitle).replace(/\s+/g, '');
  if (normalizedWork && (normalizedTitle === normalizedWork || normalizedTitle.startsWith(`${normalizedWork}#`))) return '';
  return title;
}
