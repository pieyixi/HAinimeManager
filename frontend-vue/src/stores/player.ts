import { defineStore } from 'pinia';
import type { PlayerEpisode } from './app';

export type PlayerMode = 'detail' | 'archive';
export type PlayerLoopMode = 'off' | 'one' | 'all';
export type PlayerFitMode = 'contain' | 'fill' | 'original';

export interface PlayerThumbnailRequest {
  videoPath: string;
  time: number;
  key: string;
  requestId: number;
  generation: number;
  exact: boolean;
}

export interface PlayerVideoHole {
  left: number;
  top: number;
  width: number;
  height: number;
}

const emptyVideoHole = (): PlayerVideoHole => ({ left: 0, top: 0, width: 1, height: 1 });

export const usePlayerStore = defineStore('player', {
  state: () => ({
    episode: null as PlayerEpisode | null,
    title: '播放器',
    hint: 'mpv 播放区域',
    currentTime: 0,
    duration: 0,
    timeInput: '00:00',
    editingTime: false,
    paused: false,
    speed: 1,
    volume: 80,
    fitMode: 'contain' as PlayerFitMode,
    fullscreen: false,
    controlsVisible: false,
    sidebarCollapsed: false,
    descriptionExpanded: false,
    descriptionOverflow: false,
    loopMode: 'off' as PlayerLoopMode,
    handlingEnd: false,
    libmpvReady: false,
    nativeVisible: false,
    videoLoading: false,
    muted: false,
    messageKind: '',
    messageText: '',
    mode: 'detail' as PlayerMode,
    keySeekDirection: 0,
    isSeeking: false,
    pendingSeek: null as { value: number; exact: boolean } | null,
    seekCommandRunning: false,
    videoHole: emptyVideoHole(),
    thumbnailVideoPath: '',
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
    previewVisible: false,
    previewLeft: 0,
    previewTimeText: '00:00',
    previewImage: '',
    previewLoading: false,
  }),
});

export type PlayerStore = ReturnType<typeof usePlayerStore>;
