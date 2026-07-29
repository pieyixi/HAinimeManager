import type { PlayerEpisode } from '../../stores/app';

export type PlayerMode = 'detail' | 'archive';

interface PlayerCommandApi {
  openPlayer(episodeId: number): Promise<void>;
  openPlayerWithEpisode(episode: PlayerEpisode, title: string, mode?: PlayerMode): Promise<void>;
}

let activeCommands: PlayerCommandApi | null = null;

export function registerPlayerCommands(commands: PlayerCommandApi): void {
  activeCommands = commands;
}

function commands(): PlayerCommandApi {
  if (!activeCommands) throw new Error('Player controller is not initialized');
  return activeCommands;
}

export const playerCommands: PlayerCommandApi = {
  openPlayer: (episodeId) => commands().openPlayer(episodeId),
  openPlayerWithEpisode: (episode, title, mode) => commands().openPlayerWithEpisode(episode, title, mode),
};
