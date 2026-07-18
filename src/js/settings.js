// ─── Settings ───────────────────────────

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

