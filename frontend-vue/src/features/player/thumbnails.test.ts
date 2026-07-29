import { describe, expect, it } from 'vitest';
import { buildPlayerThumbnailPrefetchBatches, playerThumbnailKey } from './thumbnails';

describe('player thumbnail planning', () => {
  it('normalizes keys to 50ms precision', () => {
    expect(playerThumbnailKey(1.024)).toBe('1');
    expect(playerThumbnailKey(1.026)).toBe('1.05');
  });

  it('builds unique, bounded progressive batches', () => {
    const batches = buildPlayerThumbnailPrefetchBatches(120);
    const frames = batches.flat();
    expect(batches.length).toBeGreaterThan(1);
    expect(batches.every((batch) => batch.length <= 8)).toBe(true);
    expect(new Set(frames).size).toBe(frames.length);
    expect(frames.every((time) => time >= 0 && time < 120)).toBe(true);
    expect(frames.slice(0, 3)).toContain(60);
  });

  it('does not schedule previews for an empty video', () => {
    expect(buildPlayerThumbnailPrefetchBatches(0)).toEqual([]);
  });
});
