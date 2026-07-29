import { useAppStore } from '../stores/app';
import { installDetailGlobals } from '../features/library/detail';
import { installApplicationEvents } from './applicationEvents';
import { installFilterGlobals } from '../features/library/filters';
import { installNavigationGlobals } from '../features/library/navigation';
import { installStateGlobals } from '../features/library/state';
import { installSettingsGlobals } from '../stores/settings';
import { installArchiveGlobals } from '../stores/archive';
import { installLibraryActions } from '../features/library/actions';
import { installPlayerController } from '../features/player/controller';

export function startApplicationRuntime(): () => void {
  document.body.dataset.frontend = 'vue';
  const state = useAppStore();
  installStateGlobals(state);
  installNavigationGlobals(state);
  installFilterGlobals(state);
  installDetailGlobals(state);
  installSettingsGlobals();
  installArchiveGlobals();
  installLibraryActions(state);
  installPlayerController(state);
  const stopEvents = installApplicationEvents(state);
  return () => {
    stopEvents();
  };
}
