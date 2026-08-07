import { describe, expect, it } from 'vitest';
import { formatLibrarySize, isMissingDirectoryItem } from './settings';

describe('library size formatting', () => {
  it('uses readable binary units', () => {
    expect(formatLibrarySize(0)).toBe('0 B');
    expect(formatLibrarySize(1024)).toBe('1 KB');
    expect(formatLibrarySize(1024 ** 3 * 2.5)).toBe('2.5 GB');
  });
});

describe('library scan actions', () => {
  it('offers database deletion only for an imported work whose directory is missing', () => {
    expect(isMissingDirectoryItem({ work_id: 12, title: 'Missing', folder_path: 'D:\\Missing', status: '作品目录不存在' })).toBe(true);
    expect(isMissingDirectoryItem({ work_id: 12, title: 'Changed', folder_path: 'D:\\Changed', status: '元数据有变化' })).toBe(false);
    expect(isMissingDirectoryItem({ title: 'New', folder_path: 'D:\\New', status: '作品目录不存在' })).toBe(false);
  });
});
