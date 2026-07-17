// ─── Archive Assistant ───────────────────

function fileToDataUrl(file) {
  return new Promise(function(resolve, reject){
    var reader = new FileReader();
    reader.onload = function(){ resolve(reader.result); };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function showArchiveMsg(kind, text) {
  var msg = document.getElementById('archiveMsg');
  if (!msg) return;
  msg.innerHTML = '<div class="settings-msg ' + kind + '">' + escHtml(text) + '</div>';
}

function showJsonPasteMsg(kind, text) {
  var msg = document.getElementById('jsonPasteMsg');
  if (!msg) return;
  msg.innerHTML = '<div class="settings-msg ' + kind + '">' + escHtml(text) + '</div>';
}

async function openUnarchivedPage() {
  document.getElementById('unarchivedPath').value = document.getElementById('mediaPath').value.trim() || 'D:\\HAnime';
  showPage('page-unarchived');
  await loadUnarchivedFolders();
}

async function loadUnarchivedFolders() {
  var path = document.getElementById('unarchivedPath').value.trim();
  var box = document.getElementById('unarchivedList');
  if (!path) return;
  box.innerHTML = '<div class="settings-msg info">扫描未建档作品中...</div>';
  try {
    var folders = await invoke('list_unarchived_folders', { rootPath: path });
    if (!folders.length) {
      box.innerHTML = '<div class="settings-msg info">没有未建档作品</div>';
      return;
    }
    var html = '<div class="unarchived-list">';
    folders.forEach(function(item){
      var reasons = (item.missing_reasons || []).slice(0, 8).map(function(reason){
        return '<span class="reason-pill">' + escHtml(reason) + '</span>';
      }).join('');
      if ((item.missing_reasons || []).length > 8) {
        reasons += '<span class="reason-pill">还有 ' + ((item.missing_reasons || []).length - 8) + ' 项</span>';
      }
      html += '<div class="unarchived-card">' +
        '<div>' +
          '<div class="unarchived-name">' + escHtml(item.title) + '</div>' +
          '<div class="unarchived-path">' + escHtml(item.folder_path) + '</div>' +
        '</div>' +
        '<div class="unarchived-meta">' +
          '<span class="status-pill">' + item.video_count + ' 个视频</span>' +
          '<span class="status-pill warn">' + (item.has_meta_json ? 'meta 不完整' : '未建档') + '</span>' +
        '</div>' +
        '<div class="reason-list">' + reasons + '</div>' +
        '<div class="unarchived-actions">' +
          '<button class="btn-secondary" onclick="openArchiveAssistant(\'' + escAttr(item.folder_path) + '\')">建档</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
  } catch(e) {
    box.innerHTML = '<div class="settings-msg err">扫描失败: ' + escHtml(e) + '</div>';
  }
}

function openArchiveAssistant(dirPath) {
  state.archive = { draft: null, coverData: null, episodeCoverData: {} };
  document.getElementById('archiveDir').value = dirPath || '';
  document.getElementById('archiveOfficialTitle').value = '';
  document.getElementById('archiveTitle').value = '';
  document.getElementById('archiveStudio').value = '';
  document.getElementById('archiveCharacters').value = '';
  document.getElementById('archiveSynopsis').value = '';
  document.getElementById('archiveEpisodes').innerHTML = '';
  document.getElementById('archiveCoverDrop').innerHTML = '拖入主封面';
  document.getElementById('archiveMsg').innerHTML = '';
  document.getElementById('archiveJsonPaste').value = '';
  document.getElementById('jsonPasteMsg').innerHTML = '';
  showPage('page-archive');
  setupArchiveDropZones();
  if (dirPath) loadArchiveDraft();
}

async function loadArchiveDraft() {
  var dirPath = document.getElementById('archiveDir').value.trim();
  var title = document.getElementById('archiveOfficialTitle').value.trim();
  if (!dirPath) { showArchiveMsg('err', '请先填写作品目录'); return; }
  try {
    var draft = await invoke('inspect_archive_folder', { dirPath: dirPath, title: title || null });
    state.archive.draft = draft;
    document.getElementById('archiveTitle').value = draft.title || '';
    document.getElementById('archiveStudio').value = draft.studio || '';
    document.getElementById('archiveSynopsis').value = draft.synopsis || '';
    var characters = draft.characters || {};
    document.getElementById('archiveCharacters').value = Object.keys(characters).sort(function(a, b){
      return Number(a) - Number(b);
    }).map(function(key){ return characters[key]; }).filter(Boolean).join('\n');
    if (draft.cover_path) {
      await loadCovers([draft.cover_path]);
      renderCoverDrop(coverUrl(draft.cover_path));
    }
    var epCovers = draft.episode_list.map(function(ep){ return ep.cover_path; }).filter(Boolean);
    await loadCovers(epCovers);
    renderArchiveEpisodes();
    showArchiveMsg('info', '已读取目录，发现 ' + draft.episodes + ' 个视频');
  } catch(e) {
    showArchiveMsg('err', '读取失败: ' + e);
  }
}

function renderCoverDrop(src) {
  var box = document.getElementById('archiveCoverDrop');
  box.innerHTML = src ? '<img src="' + src + '">' : '拖入主封面';
}

function renderArchiveEpisodes() {
  var draft = state.archive.draft;
  var box = document.getElementById('archiveEpisodes');
  if (!draft || !draft.episode_list.length) {
    box.innerHTML = '<div class="archive-hint">未发现视频文件</div>';
    return;
  }
  box.innerHTML = draft.episode_list.map(function(ep, index){
    var preview = '';
    if (state.archive.episodeCoverData[ep.id]) {
      preview = '<img src="' + state.archive.episodeCoverData[ep.id] + '">';
    } else if (ep.cover_path && coverUrl(ep.cover_path)) {
      preview = '<img src="' + coverUrl(ep.cover_path) + '">';
    } else {
      preview = '拖入第' + ep.id + '集封面';
    }
    return '<div class="episode-editor" data-ep="' + ep.id + '">' +
      '<div><div class="drop-zone small" data-episode-drop="' + ep.id + '">' + preview + '</div>' +
      '<div class="archive-inline-actions"><button class="btn-secondary" onclick="playArchiveEpisodeForCover(' + ep.id + ')">播放取帧</button></div></div>' +
      '<div class="episode-editor-main">' +
        '<div><div class="archive-label">第' + ep.id + '集官方副标题（可空）</div><input class="archive-input" data-ep-field="subtitle" data-index="' + index + '" value="' + escHtml(ep.subtitle || '') + '"></div>' +
        '<div><div class="archive-label">发售时间</div><input class="archive-input" data-ep-field="release_date" data-index="' + index + '" value="' + escHtml(ep.release_date || '') + '" placeholder="YYYY-MM"></div>' +
        '<div class="episode-tags">' +
          '<div><div class="archive-label">剧情 Tag</div><input class="archive-input" data-ep-field="theme" data-index="' + index + '" value="' + escHtml((ep.tags.theme || []).join(', ')) + '"></div>' +
          '<div><div class="archive-label">属性 Tag</div><input class="archive-input" data-ep-field="attribute" data-index="' + index + '" value="' + escHtml((ep.tags.attribute || []).join(', ')) + '"></div>' +
          '<div><div class="archive-label">场景 Tag</div><input class="archive-input" data-ep-field="scene" data-index="' + index + '" value="' + escHtml((ep.tags.scene || []).join(', ')) + '"></div>' +
        '</div>' +
      '</div>' +
    '</div>';
  }).join('');
  setupArchiveDropZones();
}

function setupArchiveDropZones() {
  var main = document.getElementById('archiveCoverDrop');
  if (main && !main.dataset.bound) {
    main.dataset.bound = '1';
    bindDropZone(main, async function(file){
      state.archive.coverData = await fileToDataUrl(file);
      renderCoverDrop(state.archive.coverData);
    });
  }
  document.querySelectorAll('[data-episode-drop]').forEach(function(zone){
    if (zone.dataset.bound) return;
    zone.dataset.bound = '1';
    bindDropZone(zone, async function(file){
      var epId = zone.getAttribute('data-episode-drop');
      state.archive.episodeCoverData[epId] = await fileToDataUrl(file);
      zone.innerHTML = '<img src="' + state.archive.episodeCoverData[epId] + '">';
    });
  });
}

function archiveEpisodeById(epId) {
  var draft = state.archive.draft;
  if (!draft) return null;
  return (draft.episode_list || []).find(function(ep){ return Number(ep.id) === Number(epId); });
}

async function playArchiveEpisodeForCover(epId) {
  var ep = archiveEpisodeById(epId);
  if (!ep) { showArchiveMsg('err', '请先读取目录'); return; }
  await openPlayerWithEpisode({
    id: ep.id,
    number: ep.id,
    video_path: ep.video_path,
  }, (state.archive.draft.title || '建档') + ' / 第' + ep.id + '集取帧', 'archive');
}

function bindDropZone(el, onFile) {
  el.addEventListener('dragover', function(e){ e.preventDefault(); el.classList.add('dragover'); });
  el.addEventListener('dragleave', function(){ el.classList.remove('dragover'); });
  el.addEventListener('drop', function(e){
    e.preventDefault();
    el.classList.remove('dragover');
    var file = e.dataTransfer.files && e.dataTransfer.files[0];
    if (file) onFile(file);
  });
}

function splitTags(value) {
  return String(value || '').split(/[,，、;；]/).map(function(s){ return s.trim(); }).filter(Boolean);
}

function collectArchiveInput() {
  var draft = state.archive.draft;
  if (!draft) throw new Error('请先读取目录');
  var episodes = draft.episode_list.map(function(ep, index){
    var get = function(field){ var el = document.querySelector('[data-ep-field="' + field + '"][data-index="' + index + '"]'); return el ? el.value.trim() : ''; };
    ep.subtitle = get('subtitle');
    ep.release_date = get('release_date');
    ep.tags = {
      theme: splitTags(get('theme')),
      attribute: splitTags(get('attribute')),
      scene: splitTags(get('scene')),
    };
    return ep;
  });
  var characters = {};
  document.getElementById('archiveCharacters').value.split(/\r?\n/).map(function(s){ return s.trim(); }).filter(Boolean).forEach(function(name, i){ characters[String(i + 1)] = name; });
  return {
    dir_path: document.getElementById('archiveDir').value.trim(),
    title: document.getElementById('archiveTitle').value.trim(),
    studio: document.getElementById('archiveStudio').value.trim(),
    synopsis: document.getElementById('archiveSynopsis').value.trim(),
    characters: characters,
    episode_list: episodes,
    cover_data: state.archive.coverData,
  };
}

async function saveArchive(shouldImport) {
  try {
    var input = collectArchiveInput();
    if (!input.title) { showArchiveMsg('err', '标题不能为空'); return; }
    var coverInputs = Object.keys(state.archive.episodeCoverData).map(function(id){
      return { id: parseInt(id, 10), image_data: state.archive.episodeCoverData[id] };
    });
    if (coverInputs.length) {
      await invoke('save_archive_episode_covers', { input: { dir_path: input.dir_path, covers: coverInputs } });
    }
    var outPath = await invoke('save_archive_draft', { input: input });
    clearArchiveCoverCaches(input.dir_path, input.episode_list);
    if (shouldImport) {
      await invoke('import_work_via_json', { dirPath: input.dir_path });
      await refreshHomeLibrary({ resetFilters: true, clearCoverCache: true });
    }
    showArchiveMsg('info', shouldImport ? '已保存并导入: ' + outPath : '已保存: ' + outPath);
  } catch(e) {
    showArchiveMsg('err', '保存失败: ' + (e.message || e));
  }
}

async function savePastedArchiveJson() {
  var dirPath = document.getElementById('archiveDir').value.trim();
  var jsonText = document.getElementById('archiveJsonPaste').value.trim();
  if (!dirPath) { showJsonPasteMsg('err', '请先填写作品目录'); return; }
  if (!jsonText) { showJsonPasteMsg('err', '请先粘贴 meta.json'); return; }
  try {
    JSON.parse(jsonText);
  } catch(e) {
    showJsonPasteMsg('err', 'JSON 格式错误: ' + e.message);
    return;
  }
  try {
    var outPath = await invoke('save_archive_json', { dirPath: dirPath, jsonText: jsonText });
    showJsonPasteMsg('info', '已保存: ' + outPath);
    await loadArchiveDraft();
  } catch(e) {
    showJsonPasteMsg('err', '保存失败: ' + (e.message || e));
  }
}

