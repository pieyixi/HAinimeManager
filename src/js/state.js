var invoke;
if (window.__TAURI__ && window.__TAURI__.core) {
  invoke = window.__TAURI__.core.invoke;
} else if (window.__TAURI__) {
  invoke = window.__TAURI__.invoke;
}

var state = {
  works: [],
  tags: [],
  years: [],
  studios: [],
  coverCache: {},
  activeFilters: {},
  currentSort: 'time-desc',
  currentPage: 1,
  pageSize: 20,
  openDropdown: null,
  currentDetail: null,
  scanFolders: [],
  contextWorkId: null,
  confirmResolver: null,
  player: {
    episode: null,
    timer: null,
    currentTime: 0,
    duration: 0,
    libmpvReady: false,
    muted: false,
    mode: 'detail',
    keySeekTimer: null,
    keySeekInterval: null,
    keySeekDirection: 0,
  },
  archive: {
    draft: null,
    coverData: null,
    episodeCoverData: {},
  },
};

var CAT_MAP = { story: '剧情', attr: '属性', scene: '场景' };
var FILTER_KEY_BY_CATEGORY = { '制作': 'studio', '剧情': 'story', '属性': 'attr', '场景': 'scene' };
var GRID_METRICS = { cardWidth: 158, cardHeight: 255, gap: 16 };

function readPx(style, prop) {
  var value = parseFloat(style[prop]);
  return Number.isFinite(value) ? value : 0;
}

function measurePageSize() {
  var grid = document.getElementById('coverGrid');
  if (!grid) return state.pageSize || 20;
  var style = window.getComputedStyle(grid);
  var contentWidth = grid.clientWidth - readPx(style, 'paddingLeft') - readPx(style, 'paddingRight');
  var contentHeight = grid.clientHeight - readPx(style, 'paddingTop') - readPx(style, 'paddingBottom');
  var columns = Math.max(1, Math.floor((contentWidth + GRID_METRICS.gap) / (GRID_METRICS.cardWidth + GRID_METRICS.gap)));
  var rows = Math.max(1, Math.floor((contentHeight + GRID_METRICS.gap) / (GRID_METRICS.cardHeight + GRID_METRICS.gap)));
  return Math.max(1, columns * rows);
}

function updatePageSize(preservePosition) {
  var oldSize = state.pageSize || 1;
  var firstIndex = (state.currentPage - 1) * oldSize;
  var nextSize = measurePageSize();
  if (nextSize === oldSize) return false;
  state.pageSize = nextSize;
  if (preservePosition) {
    state.currentPage = Math.floor(firstIndex / nextSize) + 1;
  } else {
    state.currentPage = 1;
  }
  return true;
}

