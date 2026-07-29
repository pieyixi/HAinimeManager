import { describe, expect, it } from 'vitest';
import { formatPlayerSpeed, formatPlayerTime, nextPlayerEpisodeIndex, parsePlayerTime, playerEpisodeSubtitle } from './model';

describe('player display model', () => {
  it('formats and parses editable playback times', () => {
    expect(formatPlayerTime(83.9)).toBe('01:23');
    expect(formatPlayerTime(3723)).toBe('1:02:03');
    expect(parsePlayerTime('1:02:03')).toBe(3723);
    expect(parsePlayerTime('1::3')).toBeNull();
  });

  it('formats speed labels without redundant zeroes', () => {
    expect(formatPlayerSpeed(1)).toBe('1×');
    expect(formatPlayerSpeed(1.5)).toBe('1.5×');
  });

  it('hides generated episode labels while preserving real subtitles', () => {
    expect(playerEpisodeSubtitle({ id: 1, video_path: 'a', subtitle: '第01集' }, '作品')).toBe('');
    expect(playerEpisodeSubtitle({ id: 2, video_path: 'b', subtitle: '作品 #2' }, '作品')).toBe('');
    expect(playerEpisodeSubtitle({ id: 3, video_path: 'c', subtitle: '正式副标题' }, '作品')).toBe('正式副标题');
  });

  it('advances normally and only wraps in list-loop mode', () => {
    expect(nextPlayerEpisodeIndex(0, 2, false)).toBe(1);
    expect(nextPlayerEpisodeIndex(1, 2, false)).toBeNull();
    expect(nextPlayerEpisodeIndex(1, 2, true)).toBe(0);
  });
});
