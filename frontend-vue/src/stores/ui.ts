import { defineStore } from 'pinia';

export type ColorTheme = 'light' | 'dark';

export interface ThemeTransitionAnimation {
  clipPath: [string, string];
  easing: string;
  pseudoElement: '::view-transition-new(root)' | '::view-transition-old(root)';
}

const themeStorageKey = 'media-library-theme';
const themeTransitionDuration = 480;
const themeTransitionEasing = 'cubic-bezier(.22,.8,.28,1)';
let themeTransitionRunning = false;

function applyTheme(theme: ColorTheme): void {
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = theme;
}

export function themeTransitionAnimation(
  nextTheme: ColorTheme,
  origin: { x: number; y: number },
  viewport: { width: number; height: number },
): ThemeTransitionAnimation {
  const radius = Math.hypot(
    Math.max(origin.x, viewport.width - origin.x),
    Math.max(origin.y, viewport.height - origin.y),
  );
  const collapsed = `circle(0 at ${origin.x}px ${origin.y}px)`;
  const expanded = `circle(${radius}px at ${origin.x}px ${origin.y}px)`;
  return nextTheme === 'dark'
    ? {
        clipPath: [collapsed, expanded],
        easing: themeTransitionEasing,
        pseudoElement: '::view-transition-new(root)',
      }
    : {
        clipPath: [expanded, collapsed],
        easing: themeTransitionEasing,
        pseudoElement: '::view-transition-old(root)',
      };
}

function afterTwoFrames(callback: () => void): void {
  requestAnimationFrame(() => requestAnimationFrame(callback));
}

export const useUiStore = defineStore('ui', {
  state: () => ({
    theme: 'light' as ColorTheme,
  }),
  actions: {
    initialize(): void {
      const stored = window.localStorage.getItem(themeStorageKey);
      this.theme = stored === 'dark' ? 'dark' : 'light';
      applyTheme(this.theme);
    },
    toggleTheme(origin?: { x: number; y: number }): void {
      if (themeTransitionRunning) return;
      const nextTheme = this.theme === 'light' ? 'dark' : 'light';
      const commit = () => {
        this.theme = nextTheme;
        window.localStorage.setItem(themeStorageKey, this.theme);
        applyTheme(this.theme);
      };
      const startViewTransition = (document as unknown as {
        startViewTransition?: (callback: () => void) => { ready: Promise<void>; finished: Promise<void> };
      }).startViewTransition?.bind(document);
      if (!startViewTransition || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        commit();
        return;
      }
      themeTransitionRunning = true;
      document.documentElement.dataset.themeTransition = nextTheme;
      const transition = startViewTransition(commit);
      void transition.ready.then(() => {
        const x = origin?.x ?? window.innerWidth / 2;
        const y = origin?.y ?? window.innerHeight / 2;
        const animationSpec = themeTransitionAnimation(
          nextTheme,
          { x, y },
          { width: window.innerWidth, height: window.innerHeight },
        );
        const animation = document.documentElement.animate(
          { clipPath: animationSpec.clipPath },
          {
            duration: themeTransitionDuration,
            easing: animationSpec.easing,
            fill: 'both',
            pseudoElement: animationSpec.pseudoElement,
          },
        );
        void Promise.allSettled([animation.finished, transition.finished]).then(() => {
          afterTwoFrames(() => {
            animation.cancel();
            delete document.documentElement.dataset.themeTransition;
            themeTransitionRunning = false;
          });
        });
      }).catch(() => {
        delete document.documentElement.dataset.themeTransition;
        themeTransitionRunning = false;
      });
    },
  },
});
