function currentPlayerEpisode() {
  if (state.player.mode === 'archive') return state.player.episode;
  if (!state.currentDetail || !state.player.episode) return null;
  return (state.currentDetail.episodes || []).find(function(e){ return e.id === state.player.episode.id; }) || state.player.episode;
}

function updatePlayerControls() {
  var seek = document.getElementById('playerSeek');
  var time = document.getElementById('playerTime');
  if (!seek || !time) return;
  var duration = Number(state.player.duration) || 0;
  var current = Number(state.player.currentTime) || 0;
  seek.max = duration || 0;
  seek.value = current || 0;
  time.textContent = formatTime(current) + ' / ' + formatTime(duration);
  updateCaptureButtons();
}

function updateCaptureButtons() {
  var disabled = state.player.mode !== 'archive';
  var episodeBtn = document.getElementById('captureEpisodeBtn');
  if (episodeBtn) {
    episodeBtn.disabled = disabled;
    episodeBtn.style.display = disabled ? 'none' : '';
    episodeBtn.title = disabled ? '主库播放不提供设置封面，请到建档助手取帧' : '';
  }
}

function mpvPlugin(command, args) {
  return invoke('plugin:libmpv|' + command, args || {});
}

function mpvCommand(name, args) {
  return mpvPlugin('command', { name: name, args: args || [], windowLabel: 'main' });
}

function mpvSetProperty(name, value) {
  return mpvPlugin('set_property', { name: name, value: value, windowLabel: 'main' });
}

function mpvGetProperty(name, format) {
  return mpvPlugin('get_property', { name: name, format: format, windowLabel: 'main' });
}

async function initLibMpv() {
  if (state.player.libmpvReady) return;
  await mpvPlugin('init', {
    windowLabel: 'main',
    mpvConfig: {
      initialOptions: {
        vo: 'gpu-next',
        hwdec: 'auto-safe',
        'keep-open': 'yes',
        'force-window': 'yes',
        panscan: 1,
        osc: 'no',
      },
      observedProperties: {},
    },
  });
  state.player.libmpvReady = true;
}

async function syncMpvBounds() {
  var stage = document.getElementById('mpvStage');
  if (!stage) return;
  var rect = stage.getBoundingClientRect();
  var width = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
  var height = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
  updatePlayerMasks(rect, width, height);
  if (!state.player.libmpvReady) return;
  var bleed = 2;
  await mpvPlugin('set_video_margin_ratio', {
    windowLabel: 'main',
    ratio: {
      left: Math.max(0, (rect.left - bleed) / width),
      right: Math.max(0, (width - rect.right - bleed) / width),
      top: Math.max(0, (rect.top - bleed) / height),
      bottom: Math.max(0, (height - rect.bottom - bleed) / height),
    },
  }).catch(function(){});
}

function updatePlayerMasks(rect, width, height) {
  var top = document.getElementById('playerMaskTop');
  var right = document.getElementById('playerMaskRight');
  var bottom = document.getElementById('playerMaskBottom');
  var left = document.getElementById('playerMaskLeft');
  if (!top || !right || !bottom || !left) return;
  var l = Math.max(0, Math.round(rect.left));
  var t = Math.max(0, Math.round(rect.top));
  var r = Math.min(width, Math.round(rect.right));
  var b = Math.min(height, Math.round(rect.bottom));
  var overlap = 2;
  top.style.cssText = 'left:0;top:0;width:' + width + 'px;height:' + Math.max(0, t + overlap) + 'px';
  bottom.style.cssText = 'left:0;top:' + Math.max(0, b - overlap) + 'px;width:' + width + 'px;height:' + Math.max(0, height - b + overlap) + 'px';
  left.style.cssText = 'left:0;top:' + t + 'px;width:' + Math.max(0, l + overlap) + 'px;height:' + Math.max(0, b - t) + 'px';
  right.style.cssText = 'left:' + Math.max(0, r - overlap) + 'px;top:' + t + 'px;width:' + Math.max(0, width - r + overlap) + 'px;height:' + Math.max(0, b - t) + 'px';
}

function stopPlayerTimer() {
  if (state.player.timer) {
    clearInterval(state.player.timer);
    state.player.timer = null;
  }
}

async function pollMpvStatus() {
  if (!state.player.libmpvReady) return;
  var current = await safeMpvGetProperty('time-pos', 'double');
  var duration = await safeMpvGetProperty('duration', 'double');
  var muted = await safeMpvGetProperty('mute', 'flag');
  if (Number.isFinite(Number(current))) state.player.currentTime = Number(current);
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) state.player.duration = Number(duration);
  if (muted !== null) state.player.muted = !!muted;
  updatePlayerControls();
  updateMuteControls();
}

async function safeMpvGetProperty(name, format) {
  try { return await mpvGetProperty(name, format); } catch(e) { return null; }
}

async function mpvScreenshotToFile(path) {
  await delay(80);
  await mpvCommand('screenshot-to-file', [path, 'video']);
}

function delay(ms) {
  return new Promise(function(resolve){ setTimeout(resolve, ms); });
}

async function openPlayerWithEpisode(ep, title, mode) {
  if (!ep) return;
  state.player.episode = ep;
  state.player.mode = mode || 'detail';
  document.getElementById('playerTitle').textContent = title;
  document.getElementById('mpvHint').textContent = '正在启动 mpv 播放窗口...';
  playerMessage('info', '正在启动 mpv 播放内核...');
  updateCaptureButtons();
  showPage('page-player');
  syncMpvBounds();
  stopPlayerTimer();
  try {
    await initLibMpv();
    await syncMpvBounds();
    await mpvCommand('loadfile', [ep.video_path]);
    state.player.currentTime = 0;
    state.player.duration = 0;
    updatePlayerControls();
    await delay(140);
    document.body.classList.add('player-mode');
    await syncMpvBounds();
    document.getElementById('mpvHint').textContent = '';
    playerMessage('info', 'libmpv 已启动');
    await setPlayerVolume(document.getElementById('playerVolume').value);
    await updateMuteFromMpv();
    await pollMpvStatus();
    state.player.timer = setInterval(function(){
      syncMpvBounds();
      pollMpvStatus();
    }, 500);
  } catch(e) {
    document.getElementById('mpvHint').textContent = 'mpv 未启动';
    playerMessage('err', String(e));
  }
}

async function openPlayer(episodeId) {
  var detail = state.currentDetail;
  if (!detail) return;
  var ep = (detail.episodes || []).find(function(item){ return item.id === episodeId; });
  await openPlayerWithEpisode(ep, detail.work.title + ' / 第' + ep.number + '集', 'detail');
}

async function returnFromPlayer() {
  stopPlayerTimer();
  var mode = state.player.mode;
  try { await mpvPlugin('destroy', { windowLabel: 'main' }); } catch(e) {}
  state.player.libmpvReady = false;
  state.player.currentTime = 0;
  state.player.duration = 0;
  state.player.muted = false;
  state.player.mode = 'detail';
  updatePlayerControls();
  updateMuteControls();
  showPage(mode === 'archive' ? 'page-archive' : 'page-detail');
}

async function togglePlayerPlay() {
  try { await mpvCommand('cycle', ['pause']); await pollMpvStatus(); } catch(e) { playerMessage('err', String(e)); }
}

async function seekPlayer(delta) {
  try { await mpvCommand('seek', [delta, 'relative']); await pollMpvStatus(); } catch(e) { playerMessage('err', String(e)); }
}

function previewPlayerSeek(value) {
  state.player.currentTime = Math.max(0, Number(value) || 0);
  updatePlayerControls();
}

async function seekPlayerTo(value) {
  state.player.currentTime = Math.max(0, Number(value) || 0);
  updatePlayerControls();
  try { await mpvCommand('seek', [state.player.currentTime, 'absolute']); await pollMpvStatus(); } catch(e) { playerMessage('err', String(e)); }
}

async function setPlayerVolume(value) {
  if (state.player.muted) return;
  try { await mpvSetProperty('volume', Math.max(0, Math.min(100, Number(value) || 0))); } catch(e) { playerMessage('err', String(e)); }
}

async function toggleMute() {
  try {
    await mpvCommand('cycle', ['mute']);
    await updateMuteFromMpv();
  } catch(e) { playerMessage('err', String(e)); }
}

async function updateMuteFromMpv() {
  var muted = await safeMpvGetProperty('mute', 'flag');
  state.player.muted = !!muted;
  updateMuteControls();
}

function updateMuteControls() {
  var btn = document.getElementById('muteBtn');
  var volume = document.getElementById('playerVolume');
  if (btn) btn.textContent = state.player.muted ? '已静音' : '静音';
  if (volume) volume.disabled = !!state.player.muted;
}

async function playEpisode(videoPath) {
  try { await invoke('play_video', { videoPath: videoPath }); } catch(e) { console.error('play failed:', e); }
}

async function openPlayerExternal() {
  var ep = currentPlayerEpisode();
  if (!ep) return;
  await playEpisode(ep.video_path);
}

async function captureCurrentFrame() {
  var ep = currentPlayerEpisode();
  if (!ep) return;
  if (state.player.mode !== 'archive') {
    playerMessage('info', '主库播放不提供设置封面，请到建档助手取帧');
    return;
  }
  await pollMpvStatus();
  var time = Number(state.player.currentTime) || 0;
  playerMessage('info', '正在截取 ' + formatTime(time) + '...');
  try {
    var temp = await invoke('prepare_temp_frame_capture');
    await mpvScreenshotToFile(temp.path);
    var captured = await invoke('read_image_data', { path: temp.path });
    var dirPath = document.getElementById('archiveDir').value.trim();
    var episodeId = Number(ep.id || ep.number);
    var savedPath = await invoke('save_archive_cover', {
      input: { dir_path: dirPath, image_data: captured.image_data, episode_id: episodeId }
    });
    state.archive.episodeCoverData[String(episodeId)] = captured.image_data;
    if (state.archive.draft) {
      var archiveEp = state.archive.draft.episode_list.find(function(item){ return Number(item.id) === Number(episodeId); });
      if (archiveEp) archiveEp.cover_path = savedPath;
    }
    renderArchiveEpisodes();
    await reloadCoverCache(savedPath);
    playerMessage('info', '已截为本集封面');
  } catch(e) {
    playerMessage('err', '取帧失败: ' + (e.message || e));
  }
}

async function openWorkFolder(folderPath) {
  try { await invoke('open_folder', { path: folderPath }); } catch(e) { console.error('open folder failed:', e); }
}

function askConfirm(title, body, actionText) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  var action = document.querySelector('#confirmModal .btn-danger');
  if (action) action.textContent = actionText || '确认';
  document.getElementById('confirmModal').classList.add('active');
  return new Promise(function(resolve){ state.confirmResolver = resolve; });
}

function resolveConfirm(value) {
  document.getElementById('confirmModal').classList.remove('active');
  if (state.confirmResolver) {
    state.confirmResolver(value);
    state.confirmResolver = null;
  }
}

function showWorkContextMenu(event, workId) {
  event.preventDefault();
  event.stopPropagation();
  closeDropdown();
  state.contextWorkId = workId;
  showContextMenuAt(event.clientX, event.clientY, 'work');
}

function showHomeContextMenu(event) {
  event.preventDefault();
  closeDropdown();
  state.contextWorkId = null;
  showContextMenuAt(event.clientX, event.clientY, 'home');
}

function showContextMenuAt(x, y, mode) {
  var menu = document.getElementById('workContextMenu');
  var refresh = document.getElementById('ctxRefreshHome');
  var del = document.getElementById('ctxDeleteWork');
  if (refresh) refresh.style.display = mode === 'home' ? 'block' : 'none';
  if (del) del.style.display = mode === 'work' ? 'block' : 'none';
  menu.classList.add('active');
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';
  var rect = menu.getBoundingClientRect();
  if (rect.right > window.innerWidth - 6) menu.style.left = (window.innerWidth - rect.width - 6) + 'px';
  if (rect.bottom > window.innerHeight - 6) menu.style.top = (window.innerHeight - rect.height - 6) + 'px';
}

function closeWorkContextMenu() {
  var menu = document.getElementById('workContextMenu');
  if (menu) menu.classList.remove('active');
}

async function deleteContextWork() {
  var workId = state.contextWorkId;
  closeWorkContextMenu();
  if (!workId) return;
  var work = state.works.find(function(w){ return w.id === workId; });
  var title = work ? work.title : '';
  var ok = await askConfirm('删除作品', '确定删除作品“' + title + '”？只会删除数据库记录，不会删除视频文件。', '删除');
  if (!ok) return;
  try {
    await invoke('delete_work', { workId: workId });
    if (currentDetailWorkId === workId) {
      currentDetailWorkId = null;
      state.currentDetail = null;
      showHome();
    }
    await init();
  } catch(e) {
    var msg = document.getElementById('scanMsg') || document.getElementById('tagMsg');
    if (msg) msg.innerHTML = '<div class="settings-msg err">删除失败: ' + escHtml(e) + '</div>';
  }
}

async function refreshHomeFromContext() {
  await refreshHomeLibrary({ clearCoverCache: true });
}

