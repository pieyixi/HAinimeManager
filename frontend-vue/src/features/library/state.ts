import type { AppStore } from '../../stores/app';
import { invokeTauri, isTauriConnected } from '../../api/tauri';

const CAT_MAP = { story: '剧情', attr: '属性', scene: '场景' } as const;
const FILTER_KEY_BY_CATEGORY = { 制作: 'studio', 剧情: 'story', 属性: 'attr', 场景: 'scene' } as const;
const GRID_METRICS = { cardWidth: 158, cardHeight: 255, gap: 16 } as const;

function readPx(style: CSSStyleDeclaration, prop: keyof CSSStyleDeclaration): number {
  const value = Number.parseFloat(String(style[prop]));
  return Number.isFinite(value) ? value : 0;
}

function measurePageSize(state: AppStore): number {
  const grid = document.getElementById('coverGrid');
  if (!grid) return state.pageSize || 20;
  const style = window.getComputedStyle(grid);
  const contentWidth = grid.clientWidth - readPx(style, 'paddingLeft') - readPx(style, 'paddingRight');
  const contentHeight = grid.clientHeight - readPx(style, 'paddingTop') - readPx(style, 'paddingBottom');
  if (contentWidth < GRID_METRICS.cardWidth || contentHeight < GRID_METRICS.cardHeight) {
    return state.pageSize || 20;
  }
  const columns = Math.max(1, Math.floor((contentWidth + GRID_METRICS.gap) / (GRID_METRICS.cardWidth + GRID_METRICS.gap)));
  const rows = Math.max(1, Math.floor((contentHeight + GRID_METRICS.gap) / (GRID_METRICS.cardHeight + GRID_METRICS.gap)));
  return Math.max(1, columns * rows);
}

function updatePageSize(state: AppStore, preservePosition: boolean): boolean {
  const oldSize = state.pageSize || 1;
  const firstIndex = (state.currentPage - 1) * oldSize;
  const nextSize = measurePageSize(state);
  if (nextSize === oldSize) return false;
  state.pageSize = nextSize;
  state.currentPage = preservePosition ? Math.floor(firstIndex / nextSize) + 1 : 1;
  return true;
}

export function installStateGlobals(state: AppStore): void {
  const target = window as typeof window & Record<string, unknown>;
  target.invoke = isTauriConnected() ? invokeTauri : undefined;
  target.state = state;
  target.CAT_MAP = CAT_MAP;
  target.FILTER_KEY_BY_CATEGORY = FILTER_KEY_BY_CATEGORY;
  target.GRID_METRICS = GRID_METRICS;
  target.readPx = readPx;
  target.measurePageSize = () => measurePageSize(state);
  target.updatePageSize = (preservePosition: boolean) => updatePageSize(state, preservePosition);
  Object.defineProperty(target, 'currentDetailWorkId', {
    configurable: true,
    get: () => state.currentDetailWorkId,
    set: (value: number | null) => { state.currentDetailWorkId = value; },
  });
}
