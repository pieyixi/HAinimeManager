import { describe, expect, it } from 'vitest';
import type { WorkSummary } from './app';
import { filterWorks, paginationItems } from './library';

const works: WorkSummary[] = [
  {
    id: 1,
    title: 'Alpha',
    year: 2024,
    month: 2,
    studio: 'Studio A',
    description: 'first work',
    release_dates: ['2024-02', '2025-01'],
    tags: [{ name: '校园', category: '场景' }],
  },
  {
    id: 2,
    title: 'Beta',
    year: 2023,
    month: 8,
    studio: 'Studio B',
    description: 'second work',
    release_dates: ['2023-08'],
    tags: [{ name: '纯爱', category: '剧情' }],
  },
];

describe('library filtering', () => {
  it('matches a whole year against every episode release date', () => {
    expect(filterWorks(works, { year: { '2025': true } }, '', 'time-desc').map((work) => work.title)).toEqual(['Alpha']);
  });

  it('combines category filters and text search', () => {
    expect(filterWorks(works, { scene: { 校园: true } }, 'studio a', 'name-asc').map((work) => work.title)).toEqual(['Alpha']);
    expect(filterWorks(works, { story: { 纯爱: true } }, 'beta', 'name-asc').map((work) => work.title)).toEqual(['Beta']);
  });

  it('keeps time and name sorting deterministic', () => {
    expect(filterWorks(works, {}, '', 'time-desc').map((work) => work.title)).toEqual(['Alpha', 'Beta']);
    expect(filterWorks(works, {}, '', 'name-desc').map((work) => work.title)).toEqual(['Beta', 'Alpha']);
  });
});

describe('library pagination', () => {
  it('keeps nearby pages and a compact gap marker', () => {
    expect(paginationItems(5, 10)).toEqual([1, 'ellipsis', 3, 4, 5, 6, 7, 10]);
  });
});
