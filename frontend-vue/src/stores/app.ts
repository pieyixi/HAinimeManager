import { defineStore } from 'pinia';

export interface WorkSummary {
  id?: number;
  title: string;
  year?: number | string;
  month?: number | string;
  studio?: string;
  description?: string;
  search_aliases?: string[];
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
  search_aliases: string[];
  studio: string;
  synopsis: string;
  characters: Record<string, string>;
  cover_path?: string;
  episodes: number;
  episode_list: ArchiveEpisode[];
}

export const useAppStore = defineStore('app', {
  state: () => ({
    unarchivedScrollTop: 0,
    unarchivedActiveIndex: '',
    unarchivedFocusPath: '',
    unarchivedFocusOffset: 0,
    mediaLibrary: null as unknown,
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
