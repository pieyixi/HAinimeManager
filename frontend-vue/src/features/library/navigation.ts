import { convertFilePath, invokeTauri } from '../../api/tauri';
import type { AppStore, EpisodeSummary, TagSummary, WorkSummary } from '../../stores/app';

interface ReloadOptions {
  resetFilters?: boolean;
  clearCoverCache?: boolean;
}

type LegacyFunction = (...args: unknown[]) => unknown;

function legacyFunction(name: string): LegacyFunction | undefined {
  const candidate = (window as typeof window & Record<string, unknown>)[name];
  return typeof candidate === 'function' ? candidate as LegacyFunction : undefined;
}

function callLegacy(name: string, ...args: unknown[]): unknown {
  return legacyFunction(name)?.(...args);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

export function installNavigationGlobals(state: AppStore): void {
  function showPage(id: string): void {
    document.querySelectorAll('.page').forEach((page) => page.classList.remove('active'));
    const nextPage = document.getElementById(id);
    if (!nextPage) throw new Error(`Unknown page: ${id}`);
    nextPage.classList.add('active');
    state.activePage = id;
    if (id !== 'page-player') {
      document.body.classList.remove('player-mode', 'player-fullscreen', 'player-archive-mode');
    }
    if (id === 'page-home') {
      requestAnimationFrame(() => {
        callLegacy('updatePageSize', true);
        callLegacy('applyFilter');
      });
    }
  }

  function showHome(): void {
    showPage('page-home');
  }

  function resetHomeFilters(): void {
    state.activeFilters = {};
    state.currentPage = 1;
    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    if (searchInput) searchInput.value = '';
    callLegacy('closeDropdown');
  }

  async function refreshHomeLibrary(options: ReloadOptions = {}): Promise<void> {
    callLegacy('closeWorkContextMenu');
    showPage('page-home');
    await delay(30);
    await reloadLibraryData(options);
  }

  async function reloadLibraryData(options: ReloadOptions = {}): Promise<void> {
    if (options.resetFilters) resetHomeFilters();
    if (options.clearCoverCache) state.coverCache = {};
    await init();
  }

  function coverUrl(path?: string): string {
    return path ? state.coverCache[path] || '' : '';
  }

  function fileUrl(path?: string): string {
    return path ? convertFilePath(path) : '';
  }

  async function loadCovers(paths: string[]): Promise<void> {
    const needed = paths.filter((path) => path && !state.coverCache[path]);
    if (!needed.length) return;
    try {
      const result = await invokeTauri<Array<[string, string]>>('load_cover_cache', { coverPaths: needed });
      result.forEach(([path, dataUrl]) => { state.coverCache[path] = dataUrl; });
    } catch (error) {
      console.error('load covers failed:', error);
    }
  }

  async function reloadCoverCache(path?: string): Promise<void> {
    if (!path) return;
    delete state.coverCache[path];
    await loadCovers([path]);
  }

  function clearArchiveCoverCaches(dirPath: string, episodes: EpisodeSummary[] = []): void {
    const dataDir = `${String(dirPath || '').replace(/[\\/]$/, '')}\\data\\`;
    const extensions = ['jpg', 'jpeg', 'png', 'webp'];
    const stems = ['cover', ...episodes.map((episode) => `cover_ep${episode.id}`)];
    stems.forEach((stem) => {
      extensions.forEach((extension) => {
        delete state.coverCache[`${dataDir}${stem}.${extension}`];
      });
    });
  }

  async function init(): Promise<void> {
    const grid = document.getElementById('coverGrid');
    if (!grid) return;
    try {
      grid.innerHTML = '<div class="loading">&#128269; 加载作品数据...</div>';
      const [works, tags, studios] = await Promise.all([
        invokeTauri<WorkSummary[]>('get_all_works_with_tags'),
        invokeTauri<TagSummary[]>('get_tags'),
        invokeTauri<string[]>('get_studios'),
      ]);
      state.works = works || [];
      state.tags = tags || [];

      const years = new Set<number>();
      state.works.forEach((work) => {
        const releaseDates = Array.isArray(work.release_dates) && work.release_dates.length
          ? work.release_dates
          : [String(work.year)];
        releaseDates.forEach((date) => {
          const year = Number.parseInt(String(date).slice(0, 4), 10);
          if (Number.isFinite(year)) years.add(year);
        });
      });
      state.years = [...years].sort((left, right) => right - left);
      state.studios = studios || [];

      await loadCovers(state.works.flatMap((work) => work.cover_path ? [work.cover_path] : []));
      callLegacy('updatePageSize', false);
      callLegacy('applyFilter');
    } catch (error) {
      console.error('init failed:', error);
      grid.innerHTML = '<div class="empty-state"><h2>加载失败</h2><p>请检查 Tauri 后端是否正常运行</p></div>';
    }
  }

  Object.assign(window, {
    showPage,
    showHome,
    resetHomeFilters,
    refreshHomeLibrary,
    reloadLibraryData,
    coverUrl,
    fileUrl,
    loadCovers,
    reloadCoverCache,
    clearArchiveCoverCaches,
    init,
  });
}
