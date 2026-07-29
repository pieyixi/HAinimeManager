import { describe, expect, it } from 'vitest';
import { getUnarchivedIndexLetter, summarizeUnarchivedReasons, type UnarchivedItem } from './archive';

function item(overrides: Partial<UnarchivedItem> = {}): UnarchivedItem {
  return {
    title: '测试',
    folder_path: 'D:\\Media\\测试',
    video_count: 2,
    has_data_dir: true,
    has_meta_json: true,
    missing_reasons: [],
    ...overrides,
  };
}

describe('unarchived title index', () => {
  it('uses Chinese pinyin initials', () => {
    expect(getUnarchivedIndexLetter('恋騎士 Purely☆Kiss')).toBe('L');
    expect(getUnarchivedIndexLetter('姉SUMMER！')).toBe('Z');
  });

  it('supports latin, kana and symbols', () => {
    expect(getUnarchivedIndexLetter('True Blue')).toBe('T');
    expect(getUnarchivedIndexLetter('アキバ系彼女')).toBe('A');
    expect(getUnarchivedIndexLetter('123 Works')).toBe('#');
  });
});
describe('unarchived reason summary', () => {
  it('collapses episode-specific cover errors into one stable label', () => {
    expect(summarizeUnarchivedReasons(item({ missing_reasons: ['缺少第1集封面', '缺少第2集封面'] })))
      .toEqual(['集数封面不齐全']);
  });

  it('keeps only the fixed user-facing problem categories', () => {
    expect(summarizeUnarchivedReasons(item({
      has_data_dir: false,
      has_meta_json: false,
      missing_reasons: ['视频文件名缺少数字编号', '缺少主封面', '缺少第1集封面'],
    }))).toEqual(['缺少 data 文件夹', '缺少 meta.json', '视频编号有误', '缺少主封面', '集数封面不齐全']);
  });
});
