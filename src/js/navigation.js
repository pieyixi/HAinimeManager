// ─── Page Navigation ────────────────────

function showPage(id) {
  document.querySelectorAll('.page').forEach(function(p){p.classList.remove('active')});
  document.getElementById(id).classList.add('active');
  if (id !== 'page-player') document.body.classList.remove('player-mode');
}

function showHome() {
  showPage('page-home');
  if (updatePageSize(true)) applyFilter();
}

function resetHomeFilters() {
  state.activeFilters = {};
  state.currentPage = 1;
  var searchInput = document.getElementById('searchInput');
  if (searchInput) searchInput.value = '';
  closeDropdown();
}

async function refreshHomeLibrary(options) {
  options = options || {};
  closeWorkContextMenu();
  showPage('page-home');
  await delay(30);
  await reloadLibraryData(options);
}

async function reloadLibraryData(options) {
  options = options || {};
  if (options.resetFilters) resetHomeFilters();
  if (options.clearCoverCache) state.coverCache = {};
  await init();
}

// ─── Cover Helpers ──────────────────────

function coverUrl(path) {
  if (!path) return '';
  return state.coverCache[path] || '';
}

function fileUrl(path) {
  if (!path) return '';
  if (window.__TAURI__ && window.__TAURI__.core && window.__TAURI__.core.convertFileSrc) {
    return window.__TAURI__.core.convertFileSrc(path);
  }
  return 'file:///' + String(path).replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1:');
}

async function loadCovers(paths) {
  var needed = paths.filter(function(p){return p && !state.coverCache[p]});
  if (!needed.length) return;
  try {
    var result = await invoke('load_cover_cache', { coverPaths: needed });
    result.forEach(function(pair){ state.coverCache[pair[0]] = pair[1]; });
  } catch(e) { console.error('load covers failed:', e); }
}

async function reloadCoverCache(path) {
  if (!path) return;
  delete state.coverCache[path];
  await loadCovers([path]);
}

function clearArchiveCoverCaches(dirPath, episodes) {
  var dataDir = String(dirPath || '').replace(/[\\\/]$/, '') + '\\data\\';
  var exts = ['jpg', 'jpeg', 'png', 'webp'];
  var stems = ['cover'];
  (episodes || []).forEach(function(ep){ stems.push('cover_ep' + ep.id); });
  stems.forEach(function(stem){
    exts.forEach(function(ext){
      delete state.coverCache[dataDir + stem + '.' + ext];
    });
  });
}

// ─── Init ───────────────────────────────

async function init() {
  try {
    var grid = document.getElementById('coverGrid');
    grid.innerHTML = '<div class="loading">&#128269; 加载作品数据...</div>';

    var results = await Promise.all([
      invoke('get_all_works_with_tags'),
      invoke('get_tags'),
      invoke('get_years'),
      invoke('get_studios'),
    ]);
    state.works = results[0] || [];
    state.tags = results[1] || [];
    state.years = results[2] || [];
    state.studios = results[3] || [];

    var coverPaths = [];
    state.works.forEach(function(w){ if(w.cover_path) coverPaths.push(w.cover_path); });
    await loadCovers(coverPaths);

    updatePageSize(false);
    applyFilter();
  } catch(e) {
    console.error('init failed:', e);
    document.getElementById('coverGrid').innerHTML = '<div class="empty-state"><h2>加载失败</h2><p>请检查 Tauri 后端是否正常运行</p></div>';
  }
}

