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
    msg.innerHTML = '<div class="settings-msg info">' + escHtml(detail) + '<div class="library-path">' +
      escHtml(status.root_path || '') + '</div></div>';
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

function openSettingsPage() {
  showPage('page-settings');
  if (state.mediaLibrary) applyMediaLibraryStatus(state.mediaLibrary);
}

async function bindMediaLibraryPath(path, showMessage) {
  var status = await invoke('bind_media_library', { rootPath: path });
  applyMediaLibraryStatus(status);
  if (showMessage && status.rebound_paths > 0) {
    document.getElementById('libraryMsg').innerHTML =
      '<div class="settings-msg info">媒体库已移动，成功重绑定 ' +
      status.rebound_paths + ' 条作品、视频及封面路径。</div>';
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
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">绑定失败: ' + escHtml(e) + '</div>';
  }
}

function renderImportFolders(msg, folders, title) {
  state.scanFolders = folders || [];
  if (!state.scanFolders.length) {
    msg.innerHTML = '<div class="settings-msg info">未发现新作品</div>';
    return;
  }
  var html = '<div class="settings-msg info">' + escHtml(title) + state.scanFolders.length + ' 个新作品</div>';
  html += '<div style="margin-top:8px;max-height:200px;overflow-y:auto;font-size:12px;color:#555">';
  state.scanFolders.forEach(function(f){
    var name = f.split(/[\\/]/).pop();
    html += '<div style="padding:4px 0;display:flex;align-items:center;gap:8px">' +
      '<span style="flex:1">' + escHtml(name) + '</span>' +
      '<button class="btn-secondary" onclick="doImportOne(\'' + escAttr(f) + '\')" style="font-size:11px;padding:2px 8px">导入</button></div>';
  });
  html += '</div>';
  html += '<button class="btn-secondary" style="margin-top:6px" onclick="doBatchImport()">全部导入</button>';
  msg.innerHTML = html;
}

async function doScan() {
  var path = document.getElementById('mediaPath').value.trim();
  if (!path) return;
  var msg = document.getElementById('scanMsg');
  msg.innerHTML = '<div class="settings-msg info">扫描中...</div>';
  try {
    await ensureMediaLibraryPath(path);
    var folders = await invoke('scan_folder', { rootPath: path });
    renderImportFolders(msg, folders, '发现 ');
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">扫描失败: ' + e + '</div>';
  }
}

async function doImportOne(dirPath) {
  var msg = document.getElementById('scanMsg');
  try {
    msg.innerHTML = '<div class="settings-msg info">导入中: ' + escHtml(dirPath.split(/[\\/]/).pop()) + '</div>';
    await delay(30);
    var id = await invoke('import_work_via_json', { dirPath: dirPath });
    msg.innerHTML = '<div class="settings-msg info">导入成功 ID=' + id + '</div>';
    await refreshHomeLibrary({ resetFilters: true, clearCoverCache: true });
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">导入失败: ' + e + '</div>';
  }
}

async function doBatchImport() {
  var msg = document.getElementById('scanMsg');
  try {
    msg.innerHTML = '<div class="settings-msg info">批量导入中...</div>';
    await delay(30);
    var count = await invoke('batch_import_folders', { folders: state.scanFolders });
    msg.innerHTML = '<div class="settings-msg info">成功导入 ' + count + ' 个作品</div>';
    await refreshHomeLibrary({ resetFilters: true, clearCoverCache: true });
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">批量导入失败: ' + e + '</div>';
  }
}

async function doSync() {
  var path = document.getElementById('mediaPath').value.trim();
  if (!path) return;
  var msg = document.getElementById('syncMsg');
  msg.innerHTML = '<div class="settings-msg info">同步中...</div>';
  try {
    await ensureMediaLibraryPath(path);
    var result = await invoke('sync_database', { rootPath: path });
    var html = '';
    if (result.new_folders && result.new_folders.length > 0) {
      renderImportFolders(msg, result.new_folders, '同步发现 ');
      html = msg.innerHTML;
    }
    if (result.missing_works && result.missing_works.length > 0) {
      html += '<div class="settings-msg err">有 ' + result.missing_works.length + ' 个作品路径不存在</div>';
    }
    if (!html) html = '<div class="settings-msg info">数据库已是最新</div>';
    msg.innerHTML = html;
    await reloadLibraryData({ resetFilters: false, clearCoverCache: false });
  } catch(e) {
    msg.innerHTML = '<div class="settings-msg err">同步失败: ' + e + '</div>';
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

