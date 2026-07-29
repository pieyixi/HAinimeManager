import type { PlayerEpisode } from '../../stores/app';
import type { PlayerLayoutElements } from './layout';

export type PlayerMode = 'detail' | 'archive';

export interface PlayerCommandApi {
  bindLayout(elements: PlayerLayoutElements): void;
  openPlayer(episodeId: number): Promise<void>;
  openPlayerWithEpisode(episode: PlayerEpisode, title: string, mode?: PlayerMode): Promise<void>;
  returnFromPlayer(): Promise<void>;
  togglePlay(): Promise<void>;
  setSpeed(value: number): Promise<void>;
  playEpisodeById(episodeId: number): Promise<void>;
  playNextEpisode(forceWrap?: boolean): Promise<void>;
  setLoopMode(mode: string): Promise<void>;
  commitTime(value: string): Promise<boolean>;
  resetTimeInput(): void;
  stepFrame(direction: number): Promise<void>;
  toggleSidebar(): void;
  cycleFitMode(): void;
  setFullscreen(value: boolean): Promise<void>;
  toggleFullscreen(): Promise<void>;
  beginKeySeek(direction: number): void;
  stopKeySeek(): void;
  beginPointerSeek(event: PointerEvent): void;
  movePointerSeek(event: PointerEvent): void;
  endPointerSeek(event: PointerEvent): void;
  hideSeekPreview(): void;
  setVolume(value: string | number): Promise<void>;
  adjustVolume(delta: number): void;
  toggleMute(): Promise<void>;
  openExternal(): Promise<void>;
  captureCurrentFrame(): Promise<void>;
  scheduleBoundsSync(): void;
  showFullscreenControls(): void;
  hideFullscreenControls(): void;
}

let activeCommands: PlayerCommandApi | null = null;
let pendingLayout: PlayerLayoutElements | null = null;

export function registerPlayerCommands(commands: PlayerCommandApi | null): void {
  activeCommands = commands;
  if (commands && pendingLayout) commands.bindLayout(pendingLayout);
}

function commands(): PlayerCommandApi {
  if (!activeCommands) throw new Error('Player controller is not initialized');
  return activeCommands;
}

export const playerCommands: PlayerCommandApi = {
  bindLayout: (elements) => {
    pendingLayout = elements;
    activeCommands?.bindLayout(elements);
  },
  openPlayer: (episodeId) => commands().openPlayer(episodeId),
  openPlayerWithEpisode: (episode, title, mode) => commands().openPlayerWithEpisode(episode, title, mode),
  returnFromPlayer: () => commands().returnFromPlayer(),
  togglePlay: () => commands().togglePlay(),
  setSpeed: (value) => commands().setSpeed(value),
  playEpisodeById: (episodeId) => commands().playEpisodeById(episodeId),
  playNextEpisode: (forceWrap) => commands().playNextEpisode(forceWrap),
  setLoopMode: (mode) => commands().setLoopMode(mode),
  commitTime: (value) => commands().commitTime(value),
  resetTimeInput: () => commands().resetTimeInput(),
  stepFrame: (direction) => commands().stepFrame(direction),
  toggleSidebar: () => commands().toggleSidebar(),
  cycleFitMode: () => commands().cycleFitMode(),
  setFullscreen: (value) => commands().setFullscreen(value),
  toggleFullscreen: () => commands().toggleFullscreen(),
  beginKeySeek: (direction) => commands().beginKeySeek(direction),
  stopKeySeek: () => commands().stopKeySeek(),
  beginPointerSeek: (event) => commands().beginPointerSeek(event),
  movePointerSeek: (event) => commands().movePointerSeek(event),
  endPointerSeek: (event) => commands().endPointerSeek(event),
  hideSeekPreview: () => commands().hideSeekPreview(),
  setVolume: (value) => commands().setVolume(value),
  adjustVolume: (delta) => commands().adjustVolume(delta),
  toggleMute: () => commands().toggleMute(),
  openExternal: () => commands().openExternal(),
  captureCurrentFrame: () => commands().captureCurrentFrame(),
  scheduleBoundsSync: () => commands().scheduleBoundsSync(),
  showFullscreenControls: () => commands().showFullscreenControls(),
  hideFullscreenControls: () => commands().hideFullscreenControls(),
};
