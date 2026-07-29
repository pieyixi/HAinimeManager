import { installPlayerController } from '../features/player/controller';
import { useLibraryStore } from '../stores/library';
import { installApplicationEvents } from './applicationEvents';

export function startApplicationRuntime(): () => void {
  document.body.dataset.frontend = 'vue';
  const library = useLibraryStore();
  const stopPlayer = installPlayerController();
  const stopEvents = installApplicationEvents(library);
  return () => {
    stopEvents();
    stopPlayer();
  };
}
