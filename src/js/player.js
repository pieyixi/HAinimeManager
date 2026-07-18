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
        panscan: 0,
        keepaspect: 'yes',
        'video-unscaled': 'no',
        'video-aspect-override': '-1',
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
  var viewport = getPlayerViewportSize();
  var box = clampMpvRect(rect, viewport.width, viewport.height);
  box = applyMpvHitTestGuard(box, viewport.width, viewport.height);
  updatePlayerDebugSnapshot(rect, box, viewport);
  updatePlayerMasks(box, viewport.width, viewport.height);
  if (!state.player.libmpvReady) return;
  await mpvPlugin('set_video_margin_ratio', {
    windowLabel: 'main',
    ratio: {
      left: box.left / viewport.width,
      right: (viewport.width - box.right) / viewport.width,
      top: box.top / viewport.height,
      bottom: (viewport.height - box.bottom) / viewport.height,
    },
  }).catch(function(){});
}

function roundRectForDebug(rect) {
  return {
    left: Math.round(rect.left),
    top: Math.round(rect.top),
    right: Math.round(rect.right),
    bottom: Math.round(rect.bottom),
    width: Math.round(rect.width || (rect.right - rect.left)),
    height: Math.round(rect.height || (rect.bottom - rect.top)),
  };
}

function updatePlayerDebugSnapshot(stageRect, mpvBox, viewport) {
  var controls = document.querySelector('.player-controls');
  var shell = document.querySelector('.player-shell');
  var controlsRect = controls ? controls.getBoundingClientRect() : null;
  var shellRect = shell ? shell.getBoundingClientRect() : null;
  state.player.debugSnapshot = {
    dpr: window.devicePixelRatio || 1,
    viewport: viewport,
    shell: shellRect ? roundRectForDebug(shellRect) : null,
    stage: roundRectForDebug(stageRect),
    controls: controlsRect ? roundRectForDebug(controlsRect) : null,
    mpvBox: mpvBox,
    marginRatio: {
      left: Number((mpvBox.left / viewport.width).toFixed(5)),
      right: Number(((viewport.width - mpvBox.right) / viewport.width).toFixed(5)),
      top: Number((mpvBox.top / viewport.height).toFixed(5)),
      bottom: Number(((viewport.height - mpvBox.bottom) / viewport.height).toFixed(5)),
    },
  };
  renderPlayerDebug();
}

function renderPlayerDebug() {
  var box = document.getElementById('playerDebug');
  if (!box) return;
  box.classList.toggle('active', !!state.player.debug);
  if (!state.player.debug) return;
  box.textContent = JSON.stringify(state.player.debugSnapshot || {}, null, 2);
}

function togglePlayerDebug() {
  state.player.debug = !state.player.debug;
  renderPlayerDebug();
  if (state.player.debug) scheduleMpvBoundsSync();
}

function applyMpvHitTestGuard(box, width, height) {
  var controls = document.querySelector('.player-controls');
  var guarded = {
    left: Math.min(width - 1, box.left + 2),
    top: Math.min(height - 1, box.top + 2),
    right: Math.max(box.left + 1, box.right - 2),
    bottom: Math.max(box.top + 1, box.bottom - 10),
  };
  if (controls) {
    var controlsRect = controls.getBoundingClientRect();
    if (Number.isFinite(controlsRect.top)) {
      guarded.bottom = Math.min(guarded.bottom, Math.max(guarded.top + 1, Math.round(controlsRect.top) - 18));
    }
  }
  return guarded;
}

function getPlayerViewportSize() {
  return {
    width: Math.max(1, document.documentElement.clientWidth || 0, window.innerWidth || 0),
    height: Math.max(1, document.documentElement.clientHeight || 0, window.innerHeight || 0),
  };
}

function clampMpvRect(rect, width, height) {
  var left = Math.max(0, Math.min(width, Math.round(rect.left)));
  var top = Math.max(0, Math.min(height, Math.round(rect.top)));
  var right = Math.max(left + 1, Math.min(width, Math.round(rect.right)));
  var bottom = Math.max(top + 1, Math.min(height, Math.round(rect.bottom)));
  return { left: left, top: top, right: right, bottom: bottom };
}

function updatePlayerMasks(rect, width, height) {
  var top = document.getElementById('playerMaskTop');
  var right = document.getElementById('playerMaskRight');
  var bottom = document.getElementById('playerMaskBottom');
  var left = document.getElementById('playerMaskLeft');
  if (!top || !right || !bottom || !left) return;
  var l = rect.left;
  var t = rect.top;
  var r = rect.right;
  var b = rect.bottom;
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

function scheduleMpvBoundsSync() {
  if (!document.getElementById('page-player').classList.contains('active')) return;
  syncMpvBounds();
  setTimeout(syncMpvBounds, 80);
  setTimeout(syncMpvBounds, 240);
  setTimeout(syncMpvBounds, 600);
  setTimeout(syncMpvBounds, 1000);
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
    setTimeout(syncMpvBounds, 120);
    setTimeout(syncMpvBounds, 360);
    document.getElementById('mpvHint').textContent = '';
    playerMessage('info', 'libmpv 已启动');
    await setPlayerVolume(document.getElementById('playerVolume').value);
    await updateMuteFromMpv();
    await pollMpvStatus();
    var tick = 0;
    state.player.timer = setInterval(function(){
      syncMpvBounds();
      tick += 1;
      if (tick % 2 === 0) pollMpvStatus();
    }, 250);
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
  stopPlayerKeySeek();
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

async function setPlayerSpeed(value) {
  try { await mpvSetProperty('speed', value); } catch(e) { playerMessage('err', String(e)); }
}

function isPlayerPageActive() {
  var page = document.getElementById('page-player');
  return !!(page && page.classList.contains('active'));
}

function beginPlayerKeySeek(direction) {
  if (!isPlayerPageActive() || !state.player.libmpvReady) return;
  if (state.player.keySeekDirection === direction) return;
  stopPlayerKeySeek();
  state.player.keySeekDirection = direction;
  seekPlayer(direction * 3);
  state.player.keySeekTimer = setTimeout(function(){
    if (state.player.keySeekDirection !== direction) return;
    if (direction > 0) {
      setPlayerSpeed(3);
    } else {
      state.player.keySeekInterval = setInterval(function(){
        seekPlayer(-3);
      }, 180);
    }
  }, 260);
}

function stopPlayerKeySeek() {
  if (state.player.keySeekTimer) {
    clearTimeout(state.player.keySeekTimer);
    state.player.keySeekTimer = null;
  }
  if (state.player.keySeekInterval) {
    clearInterval(state.player.keySeekInterval);
    state.player.keySeekInterval = null;
  }
  if (state.player.keySeekDirection > 0 && state.player.libmpvReady) {
    setPlayerSpeed(1);
  }
  state.player.keySeekDirection = 0;
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
  var volume = Math.max(0, Math.min(100, Number(value) || 0));
  var slider = document.getElementById('playerVolume');
  if (slider) slider.value = volume;
  try { await mpvSetProperty('volume', volume); } catch(e) { playerMessage('err', String(e)); }
}

function adjustPlayerVolume(delta) {
  var slider = document.getElementById('playerVolume');
  var current = slider ? Number(slider.value) : 60;
  setPlayerVolume(current + delta);
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

