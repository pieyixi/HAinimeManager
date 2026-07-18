// ─── Event Bindings ─────────────────────

document.querySelectorAll('.filter-btn[data-filter]').forEach(function(btn){
  btn.addEventListener('click', function(e){
    e.stopPropagation();
    openDropdown(this.getAttribute('data-filter'), this);
  });
});

document.getElementById('sortTimeBtn').addEventListener('click', function(){
  setSort(state.currentSort === 'time-desc' ? 'time-asc' : 'time-desc');
});
document.getElementById('sortNameBtn').addEventListener('click', function(){
  setSort((state.currentSort === 'name-asc' || state.currentSort === 'name-desc') ? (state.currentSort === 'name-asc' ? 'name-desc' : 'name-asc') : 'name-asc');
});

document.addEventListener('click', function(e){
  var dd = document.getElementById('filterDropdown');
  if (dd && !dd.contains(e.target) && !e.target.closest('.filter-btn')) { dd.remove(); }
  if (!e.target.closest('.context-menu')) closeWorkContextMenu();
});

document.addEventListener('contextmenu', function(e){
  if (e.target.closest('.cover-card')) return;
  if (e.target.closest('#page-home.active .cover-grid') || e.target.closest('#page-home.active .workspace')) {
    showHomeContextMenu(e);
    return;
  }
  e.preventDefault();
  closeWorkContextMenu();
});

document.addEventListener('keydown', function(e){
  if (handlePlayerKeydown(e)) return;
  if (e.key === 'Escape') {
    closeDropdown();
    closeWorkContextMenu();
    resolveConfirm(false);
  }
});

document.addEventListener('keyup', function(e){
  handlePlayerKeyup(e);
});

function handlePlayerKeydown(e) {
  if (!document.getElementById('page-player').classList.contains('active')) return false;
  if (isTypingTarget(e.target)) return false;
  if (e.key === ' ') {
    if (!e.repeat) togglePlayerPlay();
    e.preventDefault();
    return true;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    if (!e.repeat) beginPlayerKeySeek(e.key === 'ArrowRight' ? 1 : -1);
    e.preventDefault();
    return true;
  }
  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
    if (!e.repeat) adjustPlayerVolume(e.key === 'ArrowUp' ? 5 : -5);
    e.preventDefault();
    return true;
  }
  return false;
}

function handlePlayerKeyup(e) {
  if (!document.getElementById('page-player').classList.contains('active')) return;
  if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    stopPlayerKeySeek();
    e.preventDefault();
  }
}

function isTypingTarget(target) {
  if (!target) return false;
  var tag = String(target.tagName || '').toLowerCase();
  return tag === 'input' || tag === 'textarea' || tag === 'select' || target.isContentEditable;
}

document.getElementById('confirmModal').addEventListener('click', function(e){
  if (e.target === this) resolveConfirm(false);
});

var resizeTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){
    if (document.getElementById('page-player').classList.contains('active')) {
      scheduleMpvBoundsSync();
      return;
    }
    if (!document.getElementById('page-home').classList.contains('active')) return;
    if (updatePageSize(true)) applyFilter();
  }, 80);
});

window.addEventListener('focus', scheduleMpvBoundsSync);
window.addEventListener('mouseup', scheduleMpvBoundsSync);

// ─── Start ──────────────────────────────

if (invoke) {
  init();
} else {
  document.getElementById('coverGrid').innerHTML = '<div class="empty-state"><h2>Tauri 未连接</h2><p>请在 Tauri 窗口中打开此页面</p></div>';
}
