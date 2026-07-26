// ─── Settings ───────────────────────────

function mediaLibrarySourceText(source) {
  var labels = {
    database: '已从现有数据库建立便携媒体库',
    relative: '已按程序相对位置自动找到媒体库',
    previous: '已使用上次的媒体目录',
    'repaired-marker': '已修复媒体库标记',
    'drive-scan': '检测到盘符变化并自动找到媒体库',
    manual: '媒体库绑定成功',
    missing: '原媒体目录不可用，请填写移动后的媒体目录',
    unconfigured: '尚未设置媒体目录',
  };
  return labels[source] || '媒体库状态已更新';
}

function applyMediaLibraryStatus(status) {
  state.mediaLibrary = status || null;
  var input = document.getElementById('mediaPath');
  var unarchived = document.getElementById('unarchivedPath');
  if (status && status.root_path) {
    input.value = status.root_path;
    if (unarchived) unarchived.value = status.root_path;
  }
  var msg = document.getElementById('libraryMsg');
  if (!msg || !status) return;
  var detail = mediaLibrarySourceText(status.source);
  if (status.rebound_paths > 0) {
    detail += '，已重绑定 ' + status.rebound_paths + ' 条路径';
  }
  if (status.needs_binding) {
    msg.innerHTML = '<div class="settings-msg err">' + escHtml(detail) + '</div>';
  } else {
    msg.innerHTML = '<div class="library-binding-state">媒体库已连接</div>';
  }
}

async function initializeMediaLibrary() {
  try {
    var status = await invoke('initialize_media_library');
    applyMediaLibraryStatus(status);
    return status;
  } catch(e) {
    var status = {
      root_path: null,
      source: 'unconfigured',
      rebound_paths: 0,
      needs_binding: true,
    };
    state.mediaLibrary = status;
    var msg = document.getElementById('libraryMsg');
    if (msg) msg.innerHTML = '<div class="settings-msg err">媒体库初始化失败: ' + escHtml(e) + '</div>';
    return status;
  }
}

async function openSettingsPage() {
  showPage('page-settings');
  if (state.mediaLibrary) applyMediaLibraryStatus(state.mediaLibrary);
  await loadLibraryConsoleSummary();
}

async function bindMediaLibraryPath(path, showMessage) {
  var status = await invoke('bind_media_library', { rootPath: path });
  applyMediaLibraryStatus(status);
  if (showMessage && status.rebound_paths > 0) {
    document.getElementById('libraryMsg').innerHTML =
      '<div class="library-binding-state">媒体库已连接，已更新 ' + status.rebound_paths + ' 条路径</div>';
  }
  return status;
}

async function ensureMediaLibraryPath(path) {
  var current = state.mediaLibrary && state.mediaLibrary.root_path;
  if (!current || String(current).toLowerCase() !== String(path).toLowerCase()) {
    return bindMediaLibraryPath(path, false);
  }
  return state.mediaLibrary;
}

async function doBindMediaLibrary() {
  var path = document.getElementById('mediaPath').value.trim();
  if (!path) return;
  var msg = document.getElementById('libraryMsg');
  msg.innerHTML = '<div class="settings-msg info">正在验证媒体库...</div>';
  try {
    await bindMediaLibraryPath(path, true);
    await reloadLibraryData({ resetFilters: false, clearCoverCache: true });
    state.libraryScan = null;
    document.getElementById('consoleResults').innerHTML = '<div class="console-empty">扫描后会在这里列出需要处理的变化。</div>';
    await loadLibraryConsoleSummary();
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">绑定失败: ' + escHtml(e) + '</div>';
  }
}

function formatLibrarySize(bytes) {
  var value = Number(bytes || 0);
  var units = ['B', 'KB', 'MB', 'GB', 'TB'];
  var index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return (index < 3 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[index];
}

function renderLibraryMetrics(summary) {
  summary = summary || {};
  var archived = Number(summary.archived_count || 0);
  var unarchived = Number(summary.unarchived_count || 0);
  var total = archived + unarchived;
  var percent = total ? Math.round(archived / total * 100) : 0;
  document.getElementById('metricArchived').textContent = archived;
  document.getElementById('metricUnarchived').textContent = unarchived;
  document.getElementById('metricEpisodes').textContent = summary.episode_count || 0;
  document.getElementById('metricSize').textContent = formatLibrarySize(summary.total_bytes);
  document.getElementById('metricTotalWorks').textContent = total;
  document.getElementById('metricProgress').textContent = percent + '%';
  var ring = document.getElementById('archiveProgressRing');
  var bar = document.getElementById('archiveRatioBar');
  ring.style.setProperty('--archive-angle', '0deg');
  bar.style.width = '0';
  requestAnimationFrame(function(){
    requestAnimationFrame(function(){
      ring.style.setProperty('--archive-angle', (percent * 3.6) + 'deg');
      bar.style.width = percent + '%';
    });
  });
}

async function loadLibraryConsoleSummary() {
  var path = document.getElementById('mediaPath').value.trim();
  if (!path) return;
  try {
    var summary = await invoke('get_library_console_summary', { rootPath: path });
    renderLibraryMetrics(summary);
  } catch(e) {
    document.getElementById('consoleResults').innerHTML =
      '<div class="console-empty error">统计失败：' + escHtml(e) + '</div>';
  }
}

function setConsoleProgress(active, percent, text) {
  var progress = document.getElementById('consoleProgress');
  progress.classList.toggle('active', active);
  progress.setAttribute('aria-hidden', active ? 'false' : 'true');
  document.getElementById('consoleProgressBar').style.width = Math.max(0, Math.min(100, percent)) + '%';
  document.getElementById('consoleProgressText').textContent = text || '';
}

function consoleItems(group) {
  return (state.libraryScan && state.libraryScan[group]) || [];
}

async function consoleOpenFolder(group, index) {
  var item = consoleItems(group)[index];
  if (item) await invoke('open_folder', { path: item.folder_path });
}

function consoleContinueArchive(group, index) {
  var item = consoleItems(group)[index];
  if (!item) return;
  var focus = item.new_episode_numbers && item.new_episode_numbers.length ? item.new_episode_numbers[0] : null;
  openArchiveAssistant(item.folder_path, focus);
}

function renderConsoleGroup(config) {
  var items = consoleItems(config.key);
  if (!items.length) return '';
  var html = '<section class="console-result-group" style="--result-order:' + config.order + '">' +
    '<div class="console-result-head"><div><h3>' + escHtml(config.title) + '</h3><span>' +
    items.length + ' 项</span></div>' + (config.action || '') + '</div><div class="console-result-list">';
  items.forEach(function(item, index){
    var episodes = item.new_episode_numbers && item.new_episode_numbers.length
      ? '<div class="console-episode-numbers">' + item.new_episode_numbers.map(function(number){ return '#' + number; }).join('、') + '</div>'
      : '';
    var action = config.itemAction ? config.itemAction(index) : '';
    html += '<div class="console-result-row"><div class="console-result-copy"><strong>' + escHtml(item.title) +
      '</strong><span>' + escHtml(item.status) + '</span>' + episodes + '</div><div class="console-row-actions">' +
      action + '<button class="btn-secondary" onclick="consoleOpenFolder(\'' + config.key + '\',' + index + ')">打开文件夹</button></div></div>';
  });
  return html + '</div></section>';
}

function renderLibraryScan(result) {
  state.libraryScan = result;
  renderLibraryMetrics(result.summary);
  var total = ['changed_works', 'new_episode_works', 'new_complete_works', 'attention_works']
    .reduce(function(sum, key){ return sum + ((result[key] || []).length); }, 0);
  if (!total) {
    document.getElementById('consoleResults').innerHTML =
      '<div class="console-empty compact success"><strong>没有待处理变化</strong></div>';
    return;
  }
  var html = '';
  html += renderConsoleGroup({
    key: 'changed_works', title: '已建档内容有变化', order: 1,
    action: '<button class="btn-primary compact" onclick="doApplyLibraryUpdates()">全部更新</button>'
  });
  html += renderConsoleGroup({
    key: 'new_episode_works', title: '发现新增集数', order: 2,
    itemAction: function(index){ return '<button class="btn-primary compact" onclick="consoleContinueArchive(\'new_episode_works\',' + index + ')">继续建档</button>'; }
  });
  html += renderConsoleGroup({
    key: 'new_complete_works', title: '可导入的新作品', order: 3,
    action: '<button class="btn-primary compact" onclick="doImportConsoleWorks()">导入新作品</button>'
  });
  html += renderConsoleGroup({ key: 'attention_works', title: '需要检查', order: 4 });
  document.getElementById('consoleResults').innerHTML = html;
}

async function doScanLibraryChanges() {
  var path = document.getElementById('mediaPath').value.trim();
  var button = document.getElementById('consoleScanButton');
  if (!path || button.disabled) return;
  button.disabled = true;
  document.getElementById('consoleResults').innerHTML = '<div class="console-empty">正在读取媒体库...</div>';
  var percent = 8;
  setConsoleProgress(true, percent, '正在检查目录和视频');
  var timer = setInterval(function(){
    percent = Math.min(88, percent + Math.max(1, Math.round((88 - percent) * 0.08)));
    var text = percent < 42 ? '正在检查目录和视频' : percent < 72 ? '正在比对元数据和封面' : '正在计算媒体库容量';
    setConsoleProgress(true, percent, text);
  }, 220);
  try {
    await ensureMediaLibraryPath(path);
    var result = await invoke('scan_library_changes', { rootPath: path });
    clearInterval(timer);
    setConsoleProgress(true, 100, '扫描完成');
    renderLibraryScan(result);
    setTimeout(function(){ setConsoleProgress(false, 0, ''); }, 650);
  } catch(e) {
    clearInterval(timer);
    setConsoleProgress(false, 0, '');
    document.getElementById('consoleResults').innerHTML = '<div class="console-empty error">扫描失败：' + escHtml(e) + '</div>';
  } finally {
    button.disabled = false;
  }
}

async function doApplyLibraryUpdates() {
  var items = consoleItems('changed_works').filter(function(item){ return item.can_update; });
  if (!items.length) return;
  var confirmed = await askConfirm('全部更新', '将按当前文件重新导入 ' + items.length + ' 个已建档作品，数据库中的对应信息会完整更新。', '确认更新');
  if (!confirmed) return;
  try {
    setConsoleProgress(true, 35, '正在更新已建档作品');
    await invoke('apply_library_updates', { folders: items.map(function(item){ return item.folder_path; }) });
    setConsoleProgress(true, 100, '更新完成');
    await reloadLibraryData({ resetFilters: false, clearCoverCache: true });
    await doScanLibraryChanges();
  } catch(e) {
    setConsoleProgress(false, 0, '');
    document.getElementById('consoleResults').insertAdjacentHTML('afterbegin', '<div class="settings-msg err">更新失败：' + escHtml(e) + '</div>');
  }
}

async function doImportConsoleWorks() {
  var items = consoleItems('new_complete_works');
  if (!items.length) return;
  var confirmed = await askConfirm('导入新作品', '将把 ' + items.length + ' 个建档完整的新作品导入主库。', '确认导入');
  if (!confirmed) return;
  try {
    setConsoleProgress(true, 35, '正在导入新作品');
    await invoke('batch_import_folders', { folders: items.map(function(item){ return item.folder_path; }) });
    setConsoleProgress(true, 100, '导入完成');
    await reloadLibraryData({ resetFilters: false, clearCoverCache: true });
    await doScanLibraryChanges();
  } catch(e) {
    setConsoleProgress(false, 0, '');
    document.getElementById('consoleResults').insertAdjacentHTML('afterbegin', '<div class="settings-msg err">导入失败：' + escHtml(e) + '</div>');
  }
}

async function doDuplicateCheck() {
  var path = document.getElementById('mediaPath').value.trim();
  if (!path) return;
  var msg = document.getElementById('duplicateMsg');
  msg.innerHTML = '<div class="settings-msg info">查重中...</div>';
  try {
    await ensureMediaLibraryPath(path);
    var groups = await invoke('detect_duplicates', { rootPath: path });
    if (!groups.length) {
      msg.innerHTML = '<div class="settings-msg info">未发现重复作品</div>';
      return;
    }
    var html = '<div class="settings-msg err">发现 ' + groups.length + ' 组疑似重复</div>';
    html += '<div style="margin-top:10px;display:flex;flex-direction:column;gap:10px">';
    groups.forEach(function(group, idx){
      html += '<div style="border:1px solid var(--line);border-radius:8px;background:#fff;padding:10px">';
      html += '<div style="font-size:12px;color:#6b7280;margin-bottom:6px">重复组 ' + (idx + 1) + '</div>';
      group.items.forEach(function(item){
        var size = item.total_size ? Math.round(item.total_size / 1024 / 1024) + ' MB' : '未知大小';
        html += '<div style="font-size:12px;line-height:1.6;padding:4px 0;border-top:1px solid #f1f3f6">' +
          '<div><strong>' + escHtml(item.title) + '</strong> <span style="color:#6b7280">(' + escHtml(item.source) + ' / ' + item.video_count + '集 / ' + size + ')</span></div>' +
          '<div style="color:#6b7280;word-break:break-all">' + escHtml(item.folder_path) + '</div>' +
          '</div>';
      });
      html += '</div>';
    });
    html += '</div>';
    msg.innerHTML = html;
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">查重失败: ' + escHtml(e) + '</div>';
  }
}

async function doBackup() {
  var path = document.getElementById('dbFilePath').value.trim() || 'D:\\HAnime\\backup.db';
  var msg = document.getElementById('dbMsg');
  try {
    await invoke('backup_database', { backupPath: path });
    msg.innerHTML = '<div class="settings-msg info">备份成功: ' + escHtml(path) + '</div>';
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">备份失败: ' + e + '</div>';
  }
}

async function doDataBackup() {
  var path = document.getElementById('dbFilePath').value.trim() || 'D:\\Ark\\hanime-data-backup.zip';
  var msg = document.getElementById('dbMsg');
  try {
    var result = await invoke('backup_data_package', { backupPath: path });
    msg.innerHTML = '<div class="settings-msg info">资料包备份成功: ' + escHtml(result) + '</div>';
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">资料包备份失败: ' + escHtml(e) + '</div>';
  }
}

async function doRestore() {
  var path = document.getElementById('dbFilePath').value.trim();
  if (!path) return;
  var msg = document.getElementById('dbMsg');
  try {
    await invoke('restore_database', { restorePath: path });
    msg.innerHTML = '<div class="settings-msg info">恢复成功，请重启应用</div>';
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">恢复失败: ' + e + '</div>';
  }
}

