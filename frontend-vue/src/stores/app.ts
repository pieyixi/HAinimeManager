import { defineStore } from 'pinia';

export interface WorkSummary {
  id?: number;
  title: string;
  year?: number | string;
  month?: number | string;
  studio?: string;
  description?: string;
  release_dates?: string[];
  cover_path?: string;
  tags?: TagSummary[];
  [key: string]: unknown;
}

export interface TagSummary {
  name: string;
  category: string;
  [key: string]: unknown;
}

export interface EpisodeSummary {
  id: number;
  number?: number;
  title?: string;
  subtitle?: string;
  release_date?: string;
  video_path?: string;
  cover_path?: string;
  [key: string]: unknown;
}

export interface WorkDetail {
  work: WorkSummary & { id: number; folder_path?: string };
  episodes: EpisodeSummary[];
  tags: TagSummary[];
  characters?: string[];
}

export interface PlayerThumbnailRequest {
  videoPath: string;
  time: number;
  key: string;
  requestId: number;
  exact: boolean;
}

export type PlayerEpisode = EpisodeSummary & { video_path: string };

export interface ArchiveEpisode {
  id: number;
  subtitle?: string;
  release_date?: string;
  video_path: string;
  cover_path?: string;
  tags: {
    theme: string[];
    attribute: string[];
    scene: string[];
  };
}

export interface ArchiveDraft {
  title: string;
  studio: string;
  synopsis: string;
  characters: Record<string, string>;
  cover_path?: string;
  episodes: number;
  episode_list: ArchiveEpisode[];
}

export const useAppStore = defineStore('app', {
  state: () => ({
    activePage: 'page-home',
    works: [] as WorkSummary[],
    tags: [] as TagSummary[],
    years: [] as number[],
    studios: [] as string[],
    coverCache: {} as Record<string, string>,
    activeFilters: {} as Record<string, Record<string, boolean>>,
    currentSort: 'time-desc',
    currentPage: 1,
    pageSize: 20,
    openDropdown: null as string | null,
    currentDetailWorkId: null as number | null,
    currentDetail: null as WorkDetail | null,
    unarchivedScrollTop: 0,
    unarchivedActiveIndex: '',
    scanFolders: [] as unknown[],
    libraryScan: null as unknown,
    contextWorkId: null as number | null,
    confirmResolver: null as ((confirmed: boolean) => void) | null,
    mediaLibrary: null as unknown,
    player: {
      episode: null as PlayerEpisode | null,
      timer: null as number | null,
      currentTime: 0,
      duration: 0,
      paused: false,
      speed: 1,
      fitMode: 'contain',
      fullscreen: false,
      sidebarCollapsed: false,
      loopMode: 'off',
      handlingEnd: false,
      libmpvReady: false,
      muted: false,
      mode: 'detail',
      keySeekTimer: null as number | null,
      keySeekInterval: null as number | null,
      keySeekDirection: 0,
      isSeeking: false,
      pendingSeek: null as { value: number; exact: boolean } | null,
      seekCommandRunning: false,
      thumbnailVideoPath: '',
      thumbnailTimer: null as number | null,
      thumbnailRefineTimer: null as number | null,
      thumbnailRequestId: 0,
      thumbnailHoverKey: null as string | null,
      thumbnailHoverTime: 0,
      thumbnailDisplayedTime: null as number | null,
      thumbnailInFlight: false,
      thumbnailPending: null as PlayerThumbnailRequest | null,
      thumbnailCache: {} as Record<string, string>,
      thumbnailExactKeys: {} as Record<string, boolean>,
      thumbnailCacheOrder: [] as string[],
      thumbnailCacheTimes: [] as number[],
      thumbnailPrefetchGeneration: 0,
      thumbnailLastPointerTime: null as number | null,
      thumbnailLastPointerStamp: 0,
      thumbnailPointerVelocity: 0,
      thumbnailLatency: 0.08,
    },
    archive: {
      draft: null as ArchiveDraft | null,
      coverData: null as string | null,
      episodeCoverData: {} as Record<number, string>,
      dataPath: '',
      focusEpisode: null as number | null,
    },
  }),
});

export type AppStore = ReturnType<typeof useAppStore>;
