import { describe, expect, it } from 'vitest';
import { formatLibrarySize } from './settings';

describe('library size formatting', () => {
  it('uses readable binary units', () => {
    expect(formatLibrarySize(0)).toBe('0 B');
    expect(formatLibrarySize(1024)).toBe('1 KB');
    expect(formatLibrarySize(1024 ** 3 * 2.5)).toBe('2.5 GB');
  });
});
