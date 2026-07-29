import { installPlayerController } from '../features/player/controller';
import { useAppStore } from '../stores/app';
import { useLibraryStore } from '../stores/library';
import { installApplicationEvents } from './applicationEvents';

export function startApplicationRuntime(): () => void {
  document.body.dataset.frontend = 'vue';
  const app = useAppStore();
  const library = useLibraryStore();
  installPlayerController(app);
  return installApplicationEvents(app, library);
}
