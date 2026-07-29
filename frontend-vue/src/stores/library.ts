import { defineStore } from 'pinia';
import { invokeTauri } from '../api/tauri';
import type { TagSummary, WorkDetail, WorkSummary } from './app';
import { useNavigationStore } from './navigation';

export type FilterKey = 'year' | 'studio' | 'story' | 'attr' | 'scene';
export type SortKey = 'time-desc' | 'time-asc' | 'name-asc' | 'name-desc';
export type PaginationItem = number | 'ellipsis';

export interface FilterOption {
  value: string;
  label: string;
}

export interface DropdownPosition {
  top: number;
  left: number;
  width: number;
}

export interface ReloadOptions {
  resetFilters?: boolean;
  clearCoverCache?: boolean;
}

const categoryByFilter: Partial<Record<FilterKey, string>> = {
  story: '剧情',
  attr: '属性',
  scene: '场景',
};

function releaseDates(work: WorkSummary): string[] {
  if (Array.isArray(work.release_dates) && work.release_dates.length) return work.release_dates.map(String);
  return [`${work.year}-${String(work.month).padStart(2, '0')}`];
}

export function filterWorks(
  works: WorkSummary[],
  activeFilters: Record<string, Record<string, boolean>>,
  search: string,
  sort: SortKey,
): WorkSummary[] {
  const keyword = search.trim().toLowerCase();
  const results = works.filter((work) => Object.entries(activeFilters).every(([key, selected]) => {
    const values = Object.keys(selected);
    if (!values.length) return true;
    if (key === 'year') {
      return values.some((value) => releaseDates(work).some((date) => value.length === 4 ? date.slice(0, 4) === value : date === value));
    }
    if (key === 'studio') return values.includes(work.studio || '');
    const category = categoryByFilter[key as FilterKey];
    return !category || (work.tags || []).some((tag) => tag.category === category && values.includes(tag.name));
  })).filter((work) => !keyword
    || work.title.toLowerCase().includes(keyword)
    || (work.description || '').toLowerCase().includes(keyword)
    || (work.studio || '').toLowerCase().includes(keyword)
    || (work.tags || []).some((tag) => tag.name.toLowerCase().includes(keyword)));

  return results.sort((left, right) => {
    if (sort === 'time-desc') return Number(right.year) - Number(left.year) || Number(right.month) - Number(left.month);
    if (sort === 'time-asc') return Number(left.year) - Number(right.year) || Number(left.month) - Number(right.month);
    if (sort === 'name-desc') return right.title.localeCompare(left.title);
    return left.title.localeCompare(right.title);
  });
}

export function paginationItems(currentPage: number, totalPages: number): PaginationItem[] {
  const items: PaginationItem[] = [];
  let ellipsisAdded = false;
  for (let page = 1; page <= totalPages; page += 1) {
    if (page === currentPage || page === 1 || page === totalPages || Math.abs(page - currentPage) <= 2) items.push(page);
    else if (!ellipsisAdded) {
      items.push('ellipsis');
      ellipsisAdded = true;
    }
  }
  return items;
}

export const useLibraryStore = defineStore('library', {
  state: () => ({
    works: [] as WorkSummary[],
    tags: [] as TagSummary[],
    years: [] as number[],
    studios: [] as string[],
    coverCache: {} as Record<string, string>,
    activeFilters: {} as Record<string, Record<string, boolean>>,
    search: '',
    currentSort: 'time-desc' as SortKey,
    currentPage: 1,
    pageSize: 20,
    openDropdown: null as FilterKey | null,
    dropdownYear: new Date().getFullYear(),
    dropdownPosition: { top: 0, left: 0, width: 180 } as DropdownPosition,
    currentDetailWorkId: null as number | null,
    currentDetail: null as WorkDetail | null,
    loading: false,
    disconnected: false,
    error: '',
  }),
  getters: {
    filteredWorks(state): WorkSummary[] {
      return filterWorks(state.works, state.activeFilters, state.search, state.currentSort);
    },
    totalPages(): number {
      return Math.max(1, Math.ceil(this.filteredWorks.length / this.pageSize));
    },
    pagedWorks(): WorkSummary[] {
      const page = Math.min(this.currentPage, this.totalPages);
      const start = (page - 1) * this.pageSize;
      return this.filteredWorks.slice(start, start + this.pageSize);
    },
    pageItems(): PaginationItem[] {
      return paginationItems(this.currentPage, this.totalPages);
    },
    hasActiveFilters(state): boolean {
      return Object.values(state.activeFilters).some((selected) => Object.keys(selected).length > 0);
    },
    showClearButton(): boolean {
      return Boolean(this.search.trim()) || this.hasActiveFilters;
    },
  },
  actions: {
    filterOptions(key: FilterKey): FilterOption[] {
      if (key === 'year') return this.years.map((year) => ({ value: String(year), label: `${year}年` }));
      if (key === 'studio') return this.studios.map((studio) => ({ value: studio, label: studio }));
      const category = categoryByFilter[key];
      if (!category) return [];
      const names = [...new Set(this.tags.filter((tag) => tag.category === category).map((tag) => tag.name))].sort((a, b) => a.localeCompare(b));
      return names.map((name) => ({ value: name, label: name }));
    },
    isSelected(key: FilterKey, value: string): boolean {
      return Boolean(this.activeFilters[key]?.[value]);
    },
    isFilterActive(key: FilterKey): boolean {
      return Boolean(this.activeFilters[key] && Object.keys(this.activeFilters[key]).length);
    },
    toggleDropdown(key: FilterKey, button: HTMLElement): void {
      if (this.openDropdown === key) {
        this.closeDropdown();
        return;
      }
      const width = Math.min(key === 'year' ? 392 : key === 'studio' ? 180 : 480, window.innerWidth - 20);
      const bounds = button.getBoundingClientRect();
      const half = width / 2;
      const left = Math.max(4 + half, Math.min(window.innerWidth - 4 - half, bounds.left + bounds.width / 2));
      this.dropdownPosition = { top: bounds.bottom + 2, left, width };
      this.openDropdown = key;
      if (key === 'year') this.dropdownYear = this.years[0] || new Date().getFullYear();
    },
    closeDropdown(): void {
      this.openDropdown = null;
    },
    toggleFilter(key: FilterKey, value: string): void {
      this.activeFilters[key] ||= {};
      if (this.activeFilters[key][value]) delete this.activeFilters[key][value];
      else this.activeFilters[key][value] = true;
      this.currentPage = 1;
    },
    toggleWholeYear(year: number): void {
      this.dropdownYear = year;
      this.toggleFilter('year', String(year));
    },
    toggleYearMonth(value: string): void {
      this.activeFilters.year ||= {};
      delete this.activeFilters.year[value.slice(0, 4)];
      if (this.activeFilters.year[value]) delete this.activeFilters.year[value];
      else this.activeFilters.year[value] = true;
      this.currentPage = 1;
    },
    clearFilter(key: FilterKey): void {
      delete this.activeFilters[key];
      this.currentPage = 1;
      this.closeDropdown();
    },
    clearSearchAndFilters(): void {
      this.search = '';
      this.activeFilters = {};
      this.currentPage = 1;
      this.closeDropdown();
    },
    setSort(sort: SortKey): void {
      this.currentSort = sort;
      this.currentPage = 1;
    },
    toggleTimeSort(): void {
      this.setSort(this.currentSort === 'time-desc' ? 'time-asc' : 'time-desc');
    },
    toggleNameSort(): void {
      this.setSort(this.currentSort === 'name-asc' ? 'name-desc' : 'name-asc');
    },
    goPage(page: number): void {
      this.currentPage = Math.max(1, Math.min(this.totalPages, Math.floor(page) || 1));
    },
    updatePageSize(width: number, height: number, paddingX: number, paddingY: number, preservePosition: boolean): void {
      const cardWidth = 158;
      const cardHeight = 255;
      const gap = 16;
      const contentWidth = width - paddingX;
      const contentHeight = height - paddingY;
      if (contentWidth < cardWidth || contentHeight < cardHeight) return;
      const columns = Math.max(1, Math.floor((contentWidth + gap) / (cardWidth + gap)));
      const rows = Math.max(1, Math.floor((contentHeight + gap) / (cardHeight + gap)));
      const nextSize = columns * rows;
      if (nextSize === this.pageSize) return;
      const firstIndex = (this.currentPage - 1) * this.pageSize;
      this.pageSize = nextSize;
      this.currentPage = preservePosition ? Math.floor(firstIndex / nextSize) + 1 : 1;
    },
    coverUrl(path?: string): string {
      return path ? this.coverCache[path] || '' : '';
    },
    async loadCovers(paths: string[]): Promise<void> {
      const needed = [...new Set(paths.filter((path) => path && !this.coverCache[path]))];
      if (!needed.length) return;
      try {
        const result = await invokeTauri<Array<[string, string]>>('load_cover_cache', { coverPaths: needed });
        result.forEach(([path, dataUrl]) => { this.coverCache[path] = dataUrl; });
      } catch (error) {
        console.error('load covers failed:', error);
      }
    },
    async reloadCoverCache(path?: string): Promise<void> {
      if (!path) return;
      delete this.coverCache[path];
      await this.loadCovers([path]);
    },
    clearArchiveCoverCaches(dirPath: string, episodes: Array<{ id: number }> = []): void {
      const dataDir = `${String(dirPath || '').replace(/[\\/]$/, '')}\\data\\`;
      const stems = ['cover', ...episodes.map((episode) => `cover_ep${episode.id}`)];
      stems.forEach((stem) => ['jpg', 'jpeg', 'png', 'webp'].forEach((extension) => { delete this.coverCache[`${dataDir}${stem}.${extension}`]; }));
    },
    resetHomeFilters(): void {
      this.clearSearchAndFilters();
    },
    async initialize(): Promise<void> {
      this.loading = true;
      this.disconnected = false;
      this.error = '';
      try {
        const [works, tags, studios] = await Promise.all([
          invokeTauri<WorkSummary[]>('get_all_works_with_tags'),
          invokeTauri<TagSummary[]>('get_tags'),
          invokeTauri<string[]>('get_studios'),
        ]);
        this.works = works || [];
        this.tags = tags || [];
        this.studios = studios || [];
        const years = new Set<number>();
        this.works.forEach((work) => releaseDates(work).forEach((date) => {
          const year = Number.parseInt(date.slice(0, 4), 10);
          if (Number.isFinite(year)) years.add(year);
        }));
        this.years = [...years].sort((left, right) => right - left);
        await this.loadCovers(this.works.flatMap((work) => work.cover_path ? [work.cover_path] : []));
      } catch (error) {
        console.error('library initialization failed:', error);
        this.error = '请检查 Tauri 后端是否正常运行';
      } finally {
        this.loading = false;
      }
    },
    async reload(options: ReloadOptions = {}): Promise<void> {
      if (options.resetFilters) this.resetHomeFilters();
      if (options.clearCoverCache) this.coverCache = {};
      await this.initialize();
    },
    async refreshHome(options: ReloadOptions = {}): Promise<void> {
      useNavigationStore().closeContextMenu();
      useNavigationStore().showPage('page-home');
      await this.reload(options);
    },
    showDisconnected(): void {
      this.loading = false;
      this.disconnected = true;
      this.error = '';
    },
    async showDetail(workId: number): Promise<void> {
      try {
        const detail = await invokeTauri<WorkDetail>('get_work_detail', { workId });
        if (!detail?.work) return;
        this.currentDetailWorkId = workId;
        this.currentDetail = detail;
        await this.loadCovers([detail.work.cover_path, ...detail.episodes.map((episode) => episode.cover_path)].filter((path): path is string => Boolean(path)));
        useNavigationStore().showPage('page-detail');
      } catch (error) {
        console.error('show detail failed:', error);
      }
    },
    jumpToSingleFilter(key: FilterKey, value: string): void {
      this.resetHomeFilters();
      this.activeFilters[key] = { [value]: true };
      useNavigationStore().showPage('page-home');
    },
    async openWorkFolder(path?: string): Promise<void> {
      if (!path) return;
      try { await invokeTauri('open_folder', { path }); }
      catch (error) { console.error('open folder failed:', error); }
    },
    async deleteWork(workId: number): Promise<void> {
      const navigation = useNavigationStore();
      const title = this.works.find((work) => Number(work.id) === workId)?.title || '';
      const confirmed = await navigation.askConfirm('删除作品', `确定删除作品“${title}”？只会删除数据库记录，不会删除视频文件。`, '删除', true);
      if (!confirmed) return;
      try {
        await invokeTauri('delete_work', { workId });
        if (this.currentDetailWorkId === workId) {
          this.currentDetailWorkId = null;
          this.currentDetail = null;
          navigation.showPage('page-home');
        }
        await this.initialize();
      } catch (error) {
        this.error = `删除失败: ${String(error)}`;
      }
    },
  },
});
