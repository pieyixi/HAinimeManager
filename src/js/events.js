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
  if (e.key === 'Escape') {
    closeDropdown();
    closeWorkContextMenu();
    resolveConfirm(false);
  }
});

document.getElementById('confirmModal').addEventListener('click', function(e){
  if (e.target === this) resolveConfirm(false);
});

var resizeTimer = null;
window.addEventListener('resize', function(){
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(function(){
    if (document.getElementById('page-player').classList.contains('active')) {
      syncMpvBounds();
      return;
    }
    if (!document.getElementById('page-home').classList.contains('active')) return;
    if (updatePageSize(true)) applyFilter();
  }, 80);
});

// ─── Start ──────────────────────────────

if (invoke) {
  init();
} else {
  document.getElementById('coverGrid').innerHTML = '<div class="empty-state"><h2>Tauri 未连接</h2><p>请在 Tauri 窗口中打开此页面</p></div>';
}
