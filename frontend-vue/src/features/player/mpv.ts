import { invokeTauri } from '../../api/tauri';

type MpvFormat = 'double' | 'flag' | 'string' | 'node';

export function mpvPlugin<T = unknown>(command: string, args: Record<string, unknown> = {}): Promise<T> {
  return invokeTauri<T>(`plugin:libmpv|${command}`, args);
}

export function mpvCommand<T = unknown>(name: string, args: unknown[] = []): Promise<T> {
  return mpvPlugin<T>('command', { name, args, windowLabel: 'main' });
}

export function mpvSetProperty<T = unknown>(name: string, value: unknown): Promise<T> {
  return mpvPlugin<T>('set_property', { name, value, windowLabel: 'main' });
}

export function mpvGetProperty<T = unknown>(name: string, format: MpvFormat): Promise<T> {
  return mpvPlugin<T>('get_property', { name, format, windowLabel: 'main' });
}

export async function safeMpvGetProperty<T>(name: string, format: MpvFormat): Promise<T | null> {
  try {
    return await mpvGetProperty<T>(name, format);
  } catch {
    return null;
  }
}

export async function initLibMpv(): Promise<void> {
  await mpvPlugin('init', {
    windowLabel: 'main',
    mpvConfig: {
      initialOptions: {
        vo: 'gpu-next',
        hwdec: 'auto-safe',
        'keep-open': 'yes',
        'force-window': 'yes',
        panscan: 0,
        keepaspect: 'yes',
        'video-unscaled': 'no',
        'video-aspect-override': '-1',
        osc: 'no',
      },
      observedProperties: {},
    },
  });
}

export const delay = (milliseconds: number): Promise<void> => new Promise((resolve) => {
  window.setTimeout(resolve, milliseconds);
});
