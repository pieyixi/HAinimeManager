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
  var returningFromArchive = document.getElementById('page-archive').classList.contains('active');
  if (!returningFromArchive) {
    state.unarchivedScrollTop = 0;
    state.unarchivedActiveIndex = '';
  }
  document.getElementById('unarchivedPath').value = document.getElementById('mediaPath').value.trim() || 'D:\\HAnime';
  showPage('page-unarchived');
  await loadUnarchivedFolders();
}

var unarchivedCollator = new Intl.Collator('zh-CN-u-co-pinyin', {
  numeric: true,
  sensitivity: 'base',
});
var unarchivedIndexLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
var pinyinBoundaries = '阿八嚓哒妸发旮哈讥咔垃妈拿哦啪期然撒塌挖昔压匝';
var pinyinBoundaryLetters = 'ABCDEFGHJKLMNOPQRSTWXYZ';

function firstIndexableCharacter(title) {
  var normalized = String(title || '').normalize('NFKC').trim();
  for (var ch of normalized) {
    if (/[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(ch)) return ch;
  }
  return '';
}

function kanaIndexLetter(ch) {
  var groups = {
    A: 'あぁアァ', E: 'えぇエェ', I: 'いぃイィ', O: 'おぉオォ', U: 'うぅウゥ',
    B: 'ばびぶべぼバビブベボ', C: 'ちチ', D: 'だでどダデド',
    F: 'ふフ', G: 'がぎぐげごガギグゲゴ', H: 'はひへほハヒヘホ',
    J: 'じぢジヂ', K: 'かきくけこゕゖカキクケコヵヶ', M: 'まみむめもマミムメモ',
    N: 'なにぬねのんナニヌネノン', P: 'ぱぴぷぺぽパピプペポ',
    R: 'らりるれろラリルレロ', S: 'さしすせそサシスセソ',
    T: 'たつてとっタツテトッ', V: 'ゔヴ',
    W: 'わをゐゑゎワヲヰヱヮ', Y: 'やゆよゃゅょヤユヨャュョ',
    Z: 'ざずぜぞづザズゼゾヅ',
  };
  for (var letter in groups) {
    if (groups[letter].indexOf(ch) >= 0) return letter;
  }
  return '';
}

function hanIndexLetter(ch) {
  for (var i = pinyinBoundaries.length - 1; i >= 0; i--) {
    if (unarchivedCollator.compare(ch, pinyinBoundaries[i]) >= 0) {
      return pinyinBoundaryLetters[i];
    }
  }
  return '';
}

function getUnarchivedIndexLetter(title) {
  var ch = firstIndexableCharacter(title);
  if (!ch || /[0-9]/.test(ch)) return '#';
  if (/[A-Za-z]/.test(ch)) return ch.toUpperCase();
  if (/[\u3040-\u30ff]/.test(ch)) return kanaIndexLetter(ch) || '#';
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(ch)) return hanIndexLetter(ch) || '#';
  return '#';
}

function renderUnarchivedIndex(available) {
  var index = document.getElementById('unarchivedIndex');
  index.innerHTML = unarchivedIndexLetters.map(function(letter){
    var disabled = !available[letter];
    return '<button class="unarchived-index-btn" data-letter="' + letter + '"' +
      (disabled ? ' disabled' : '') + ' onclick="scrollToUnarchivedIndex(\'' + letter + '\')">' + letter + '</button>';
  }).join('');
}

function setUnarchivedActiveIndex(letter) {
  state.unarchivedActiveIndex = letter || '';
  document.querySelectorAll('.unarchived-index-btn').forEach(function(button){
    button.classList.toggle('active', button.getAttribute('data-letter') === letter);
  });
}

function scrollToUnarchivedIndex(letter) {
  var box = document.getElementById('unarchivedList');
  var anchor = box.querySelector('[data-index-anchor="' + letter + '"]');
  if (!anchor) return;
  setUnarchivedActiveIndex(letter);
  box.scrollTo({ top: Math.max(0, anchor.offsetTop - 6), behavior: 'smooth' });
}

var unarchivedScrollFrame = null;
function updateUnarchivedIndexFromScroll() {
  var box = document.getElementById('unarchivedList');
  state.unarchivedScrollTop = box.scrollTop;
  var anchors = Array.from(box.querySelectorAll('[data-index-anchor]'));
  if (!anchors.length) return;
  var current = anchors[0].getAttribute('data-index-anchor');
  var threshold = box.scrollTop + 18;
  anchors.forEach(function(anchor){
    if (anchor.offsetTop <= threshold) current = anchor.getAttribute('data-index-anchor');
  });
  setUnarchivedActiveIndex(current);
}

function handleUnarchivedScroll() {
  if (unarchivedScrollFrame) cancelAnimationFrame(unarchivedScrollFrame);
  unarchivedScrollFrame = requestAnimationFrame(updateUnarchivedIndexFromScroll);
}

function summarizeUnarchivedReasons(item) {
  var reasons = item.missing_reasons || [];
  var summary = [];
  function add(text) { if (summary.indexOf(text) < 0) summary.push(text); }
  if (!item.has_data_dir) add('缺少 data 文件夹');
  if (!item.has_meta_json) add('缺少 meta.json');
  if (reasons.some(function(reason){ return /视频.*编号|编号.*视频/.test(reason); })) add('视频编号有误');
  if (reasons.indexOf('缺少主封面') >= 0) add('缺少主封面');
  if (reasons.some(function(reason){ return /^缺少第\d+集封面$/.test(reason); })) add('集数封面不齐全');
  if (item.has_meta_json && reasons.some(function(reason){
    return !/视频.*编号|编号.*视频/.test(reason) && reason !== '缺少主封面' && !/^缺少第\d+集封面$/.test(reason);
  })) add('meta.json 不完整');
  return summary;
}

async function loadUnarchivedFolders() {
  var path = document.getElementById('unarchivedPath').value.trim();
  var box = document.getElementById('unarchivedList');
  if (!path) return;
  document.getElementById('unarchivedIndex').innerHTML = '';
  box.innerHTML = '<div class="settings-msg info">扫描未建档作品中...</div>';
  try {
    var folders = await invoke('list_unarchived_folders', { rootPath: path });
    if (!folders.length) {
      document.getElementById('unarchivedIndex').innerHTML = '';
      box.innerHTML = '<div class="settings-msg info">没有未建档作品</div>';
      return;
    }
    folders.forEach(function(item){ item.index_letter = getUnarchivedIndexLetter(item.title); });
    folders.sort(function(a, b){
      var rankA = unarchivedIndexLetters.indexOf(a.index_letter);
      var rankB = unarchivedIndexLetters.indexOf(b.index_letter);
      return rankA - rankB || unarchivedCollator.compare(a.title, b.title);
    });
    var available = {};
    folders.forEach(function(item){ available[item.index_letter] = true; });
    renderUnarchivedIndex(available);
    var html = '<div class="unarchived-list">';
    var currentLetter = '';
    folders.forEach(function(item){
      if (item.index_letter !== currentLetter) {
        currentLetter = item.index_letter;
        html += '<div class="unarchived-anchor" data-index-anchor="' + currentLetter + '">' + currentLetter + '</div>';
      }
      var reasons = summarizeUnarchivedReasons(item).map(function(reason){
        return '<span class="reason-pill">' + escHtml(reason) + '</span>';
      }).join('');
      html += '<div class="unarchived-card">' +
        '<div>' +
          '<div class="unarchived-name">' + escHtml(item.title) + '</div>' +
          '<div class="unarchived-path">' + escHtml(item.folder_path) + '</div>' +
        '</div>' +
        '<div class="unarchived-meta">' +
          '<span class="status-pill">' + item.video_count + ' 个视频</span>' +
          '<span class="status-pill warn">' + (item.has_meta_json ? '待补齐' : '未建档') + '</span>' +
        '</div>' +
        '<div class="reason-list">' + reasons + '</div>' +
        '<div class="unarchived-actions">' +
          '<button class="btn-secondary" onclick="openArchiveAssistant(\'' + escAttr(item.folder_path) + '\')">建档</button>' +
        '</div>' +
      '</div>';
    });
    html += '</div>';
    box.innerHTML = html;
    box.onscroll = handleUnarchivedScroll;
    requestAnimationFrame(function(){
      var maxScroll = Math.max(0, box.scrollHeight - box.clientHeight);
      box.scrollTop = Math.min(state.unarchivedScrollTop || 0, maxScroll);
      updateUnarchivedIndexFromScroll();
    });
  } catch(e) {
    document.getElementById('unarchivedIndex').innerHTML = '';
    box.innerHTML = '<div class="settings-msg err">扫描失败: ' + escHtml(e) + '</div>';
  }
}

async function openArchiveAssistant(dirPath) {
  var unarchivedList = document.getElementById('unarchivedList');
  if (unarchivedList) state.unarchivedScrollTop = unarchivedList.scrollTop;
  state.archive = { draft: null, coverData: null, episodeCoverData: {}, dataPath: '' };
  document.getElementById('archiveDir').value = dirPath || '';
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
  if (dirPath) {
    try {
      state.archive.dataPath = await invoke('ensure_archive_data_dir', { dirPath: dirPath });
      await loadArchiveDraft();
    } catch(e) {
      showArchiveMsg('err', '准备 data 文件夹失败: ' + e);
    }
  }
}

async function loadArchiveDraft() {
  var dirPath = document.getElementById('archiveDir').value.trim();
  if (!dirPath) { showArchiveMsg('err', '请先填写作品目录'); return; }
  try {
    var draft = await invoke('inspect_archive_folder', { dirPath: dirPath });
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
    await loadArchiveDraft();
    try {
      await invoke('import_work_via_json', { dirPath: dirPath });
      await refreshHomeLibrary({ resetFilters: true, clearCoverCache: true });
      showJsonPasteMsg('info', '已保存并导入主库: ' + outPath);
    } catch(importError) {
      showJsonPasteMsg('info', '已保存: ' + outPath + '；暂未导入主库: ' + (importError.message || importError));
    }
  } catch(e) {
    showJsonPasteMsg('err', '保存失败: ' + (e.message || e));
  }
}

function openArchiveWorkFolder() {
  var dirPath = document.getElementById('archiveDir').value.trim();
  if (dirPath) openWorkFolder(dirPath);
}

async function refreshArchiveDraft(button) {
  var dirPath = document.getElementById('archiveDir').value.trim();
  if (!dirPath) return;
  var original = button.textContent;
  button.disabled = true;
  button.textContent = '刷新中';
  try {
    var oldDraft = state.archive.draft;
    if (oldDraft) {
      if (oldDraft.cover_path) delete state.coverCache[oldDraft.cover_path];
      (oldDraft.episode_list || []).forEach(function(ep){
        if (ep.cover_path) delete state.coverCache[ep.cover_path];
      });
      clearArchiveCoverCaches(dirPath, oldDraft.episode_list || []);
    }
    state.archive.coverData = null;
    state.archive.episodeCoverData = {};
    document.getElementById('archiveJsonPaste').value = '';
    document.getElementById('jsonPasteMsg').innerHTML = '';
    renderCoverDrop('');
    await loadArchiveDraft();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

async function copyArchiveDataPath(button) {
  var dirPath = document.getElementById('archiveDir').value.trim();
  var dataPath = state.archive.dataPath || (dirPath.replace(/[\\/]+$/, '') + '\\data');
  if (!dirPath) return;
  try {
    var copied = false;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      try {
        await navigator.clipboard.writeText(dataPath);
        copied = true;
      } catch (_) {}
    }
    if (!copied) {
      var textarea = document.createElement('textarea');
      textarea.value = dataPath;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      copied = document.execCommand('copy');
      textarea.remove();
      if (!copied) throw new Error('复制失败');
    }
    var original = button.textContent;
    button.textContent = '已复制';
    button.disabled = true;
    setTimeout(function(){ button.textContent = original; button.disabled = false; }, 1200);
  } catch(e) {
    showArchiveMsg('err', '复制 data 路径失败: ' + e);
  }
}

