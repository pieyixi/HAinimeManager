function currentPlayerEpisode() {
  if (state.player.mode === 'archive') return state.player.episode;
  if (!state.currentDetail || !state.player.episode) return null;
  return (state.currentDetail.episodes || []).find(function(e){ return e.id === state.player.episode.id; }) || state.player.episode;
}

function updatePlayerControls() {
  var seek = document.getElementById('playerSeek');
  var currentTime = document.getElementById('playerTimeInput');
  var durationTime = document.getElementById('playerDuration');
  if (!seek || !currentTime || !durationTime) return;
  var duration = Number(state.player.duration) || 0;
  var current = Number(state.player.currentTime) || 0;
  seek.max = duration || 0;
  if (!state.player.isSeeking) seek.value = current || 0;
  var progress = duration > 0 ? Math.max(0, Math.min(100, current / duration * 100)) : 0;
  seek.style.setProperty('--seek-progress', progress + '%');
  if (document.activeElement !== currentTime) currentTime.value = formatTime(current);
  durationTime.textContent = formatTime(duration);
  var playBtn = document.getElementById('playerPlayBtn');
  if (playBtn) {
    playBtn.textContent = state.player.paused ? '\uE768' : '\uE769';
    playBtn.title = state.player.paused ? '播放' : '暂停';
  }
  var speedBtn = document.getElementById('playerSpeedBtn');
  if (speedBtn) speedBtn.textContent = Math.abs((Number(state.player.speed) || 1) - 1) < .01 ? '倍速' : formatPlayerSpeed(state.player.speed);
  document.querySelectorAll('.speed-popover button').forEach(function(button){
    var value = Number((button.getAttribute('onclick') || '').match(/[\d.]+/)?.[0]);
    button.classList.toggle('active', Number.isFinite(value) && Math.abs(value - state.player.speed) < .01);
  });
  updatePlayerNextButton();
  updateCaptureButtons();
}

function playerEpisodeList() {
  if (state.player.mode === 'detail' && state.currentDetail) return state.currentDetail.episodes || [];
  if (state.player.mode === 'archive' && state.archive && state.archive.draft) return state.archive.draft.episode_list || [];
  return [];
}

function updatePlayerNextButton() {
  var button = document.getElementById('playerNextBtn');
  if (!button) return;
  var episodes = playerEpisodeList();
  var index = episodes.findIndex(function(ep){ return state.player.episode && ep.id === state.player.episode.id; });
  button.disabled = index < 0 || (index >= episodes.length - 1 && state.player.loopMode !== 'all');
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

function applyMpvHitTestGuard(box, width, height) {
  var controls = document.querySelector('.player-controls');
  var guarded = {
    left: box.left,
    top: box.top,
    right: box.right,
    bottom: box.bottom,
  };
  if (state.player.fullscreen && !document.body.classList.contains('player-controls-visible')) {
    return guarded;
  }
  if (controls) {
    var controlsRect = controls.getBoundingClientRect();
    var controlsTop = Math.round(controlsRect.top);
    if (Number.isFinite(controlsTop) && controlsTop <= guarded.bottom) {
      guarded.bottom = Math.max(guarded.top + 1, controlsTop - 1);
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
  var paused = await safeMpvGetProperty('pause', 'flag');
  var speed = await safeMpvGetProperty('speed', 'double');
  var ended = await safeMpvGetProperty('eof-reached', 'flag');
  if (!state.player.isSeeking && Number.isFinite(Number(current))) state.player.currentTime = Number(current);
  if (Number.isFinite(Number(duration)) && Number(duration) > 0) state.player.duration = Number(duration);
  if (muted !== null) state.player.muted = !!muted;
  if (paused !== null) state.player.paused = !!paused;
  if (Number.isFinite(Number(speed))) state.player.speed = Number(speed);
  updatePlayerControls();
  updateMuteControls();
  if (ended && state.player.loopMode === 'all' && !state.player.handlingEnd) {
    state.player.handlingEnd = true;
    playNextEpisode(true).finally(function(){ state.player.handlingEnd = false; });
  }
}

function showPlayerFullscreenControls() {
  if (!state.player.fullscreen) return;
  if (document.body.classList.contains('player-controls-visible')) return;
  document.body.classList.add('player-controls-visible');
  if (state.player.libmpvReady) mpvSetProperty('panscan', 1).catch(function(){});
  scheduleMpvBoundsSync();
}

function hidePlayerFullscreenControls() {
  if (!state.player.fullscreen) return;
  setTimeout(function(){
    var controls = document.querySelector('.player-controls');
    if (controls && controls.matches(':hover')) return;
    document.body.classList.remove('player-controls-visible');
    applyPlayerFitMode();
    scheduleMpvBoundsSync();
  }, 120);
}

async function safeMpvGetProperty(name, format) {
  try { return await mpvGetProperty(name, format); } catch(e) { return null; }
}

async function waitForPlayerFirstFrame() {
  var deadline = Date.now() + 4000;
  while (Date.now() < deadline) {
    var duration = await safeMpvGetProperty('duration', 'double');
    var time = await safeMpvGetProperty('time-pos', 'double');
    if (Number(duration) > 0 && Number.isFinite(Number(time))) {
      await delay(160);
      break;
    }
    await delay(80);
  }
  document.body.classList.remove('player-video-loading');
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
  document.body.classList.toggle('player-archive-mode', state.player.mode === 'archive');
  state.player.isSeeking = false;
  state.player.pendingSeek = null;
  state.player.seekCommandRunning = false;
  state.player.paused = false;
  state.player.speed = 1;
  state.player.fitMode = 'contain';
  state.player.loopMode = 'off';
  state.player.handlingEnd = false;
  state.player.sidebarCollapsed = false;
  var workspace = document.querySelector('.player-workspace');
  if (workspace) workspace.classList.remove('sidebar-collapsed');
  var sidebarButton = document.getElementById('playerSidebarToggle');
  if (sidebarButton) {
    sidebarButton.textContent = '›';
    sidebarButton.title = '收起信息栏';
    sidebarButton.setAttribute('aria-expanded', 'true');
  }
  document.getElementById('playerTitle').textContent = title;
  renderPlayerSidebar();
  document.getElementById('mpvHint').textContent = '正在启动 mpv 播放窗口...';
  playerMessage('info', '正在启动 mpv 播放内核...');
  updateCaptureButtons();
  document.body.classList.add('player-video-loading');
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
    await applyPlayerFitMode();
    await setPlayerLoopMode('off');
    await setPlayerVolume(document.getElementById('playerVolume').value);
    await updateMuteFromMpv();
    await pollMpvStatus();
    await waitForPlayerFirstFrame();
    document.getElementById('mpvHint').textContent = '';
    playerMessage('', '');
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
  if (state.player.fullscreen) await setPlayerFullscreen(false);
  document.body.classList.add('player-video-loading');
  showPage(mode === 'archive' ? 'page-archive' : 'page-detail');
  try { await mpvPlugin('destroy', { windowLabel: 'main' }); } catch(e) {}
  state.player.libmpvReady = false;
  state.player.currentTime = 0;
  state.player.duration = 0;
  state.player.muted = false;
  state.player.paused = false;
  state.player.speed = 1;
  state.player.isSeeking = false;
  state.player.pendingSeek = null;
  state.player.mode = 'detail';
  document.body.classList.remove('player-archive-mode');
  document.body.classList.remove('player-video-loading');
  updatePlayerControls();
  updateMuteControls();
}

async function togglePlayerPlay() {
  try { await mpvCommand('cycle', ['pause']); await pollMpvStatus(); } catch(e) { playerMessage('err', String(e)); }
}

async function seekPlayer(delta) {
  try { await mpvCommand('seek', [delta, 'relative']); await pollMpvStatus(); } catch(e) { playerMessage('err', String(e)); }
}

async function setPlayerSpeed(value) {
  var speed = Math.max(0.25, Math.min(4, Number(value) || 1));
  state.player.speed = speed;
  updatePlayerControls();
  try { await mpvSetProperty('speed', speed); } catch(e) { playerMessage('err', String(e)); }
}

async function loadPlayerEpisode(ep) {
  if (!ep || !state.player.libmpvReady) return;
  state.player.episode = ep;
  state.player.currentTime = 0;
  state.player.duration = 0;
  state.player.paused = false;
  state.player.handlingEnd = true;
  if (state.currentDetail && state.currentDetail.work) {
    document.getElementById('playerTitle').textContent = state.currentDetail.work.title + ' / 第' + ep.number + '集';
  }
  renderPlayerSidebar();
  updatePlayerControls();
  document.body.classList.add('player-video-loading');
  try {
    await mpvCommand('loadfile', [ep.video_path]);
    await delay(120);
    await applyPlayerFitMode();
    await setPlayerLoopMode(state.player.loopMode);
    await pollMpvStatus();
    await waitForPlayerFirstFrame();
  } finally {
    document.body.classList.remove('player-video-loading');
    state.player.handlingEnd = false;
  }
}

function playPlayerEpisodeById(episodeId) {
  var episode = playerEpisodeList().find(function(item){ return Number(item.id) === Number(episodeId); });
  if (episode) return loadPlayerEpisode(episode);
}

async function playNextEpisode(forceWrap) {
  var episodes = playerEpisodeList();
  if (!episodes.length || !state.player.episode) return;
  var index = episodes.findIndex(function(ep){ return ep.id === state.player.episode.id; });
  if (index < 0) return;
  var nextIndex = index + 1;
  if (nextIndex >= episodes.length) {
    if (forceWrap || state.player.loopMode === 'all') nextIndex = 0;
    else return;
  }
  await loadPlayerEpisode(episodes[nextIndex]);
}

async function setPlayerLoopMode(mode) {
  state.player.loopMode = ['one', 'all'].indexOf(mode) >= 0 ? mode : 'off';
  document.querySelectorAll('[data-loop-mode]').forEach(function(button){
    button.classList.toggle('active', button.dataset.loopMode === state.player.loopMode);
  });
  updatePlayerNextButton();
  if (!state.player.libmpvReady) return;
  try {
    await mpvSetProperty('loop-file', state.player.loopMode === 'one' ? 'inf' : 'no');
  } catch(e) {
    playerMessage('err', '循环设置失败: ' + String(e));
  }
}

function parsePlayerTime(value) {
  var text = String(value || '').trim();
  if (!text) return null;
  var parts = text.split(':');
  if (parts.length > 3 || parts.some(function(part){ return part === '' || !/^\d+$/.test(part); })) return null;
  var seconds = 0;
  parts.forEach(function(part){ seconds = seconds * 60 + Number(part); });
  return Number.isFinite(seconds) ? seconds : null;
}

function handlePlayerTimeKey(event) {
  if (event.key === 'Enter') {
    event.preventDefault();
    var seconds = parsePlayerTime(event.currentTarget.value);
    if (seconds === null) {
      playerMessage('err', '时间格式应为 01:23 或 1:02:03');
      event.currentTarget.select();
      return;
    }
    seekPlayerTo(seconds);
    event.currentTarget.blur();
  } else if (event.key === 'Escape') {
    resetPlayerTimeInput();
    event.currentTarget.blur();
  }
}

function resetPlayerTimeInput() {
  var input = document.getElementById('playerTimeInput');
  if (input) input.value = formatTime(state.player.currentTime);
}

function formatPlayerSpeed(value) {
  var speed = Number(value) || 1;
  return speed.toFixed(2).replace(/\.00$/, '').replace(/0$/, '') + '×';
}

function cyclePlayerSpeed() {
  var speeds = [0.5, 1, 1.5, 2, 3];
  var current = Number(state.player.speed) || 1;
  var index = speeds.findIndex(function(value){ return Math.abs(value - current) < 0.05; });
  setPlayerSpeed(speeds[(index + 1 + speeds.length) % speeds.length]);
}

async function stepPlayerFrame(direction) {
  if (!state.player.libmpvReady) return;
  try {
    await mpvSetProperty('pause', true);
    await mpvCommand(direction < 0 ? 'frame-back-step' : 'frame-step', []);
    await pollMpvStatus();
  } catch(e) {
    playerMessage('err', '逐帧失败: ' + String(e));
  }
}

function playerEpisodeTitle(ep) {
  if (!ep) return '';
  return ep.title || ep.subtitle || ('第' + (ep.number || ep.id || '') + '集');
}

function playerEpisodeSubtitle(ep, workTitle) {
  if (!ep) return '';
  var title = String(ep.title || ep.subtitle || '').trim();
  if (!title || /^第?\s*0*\d+\s*[集话話]$/i.test(title) || /^#\s*0*\d+$/i.test(title)) return '';
  if (workTitle) {
    var normalizedTitle = title.replace(/\s+/g, '');
    var normalizedWork = String(workTitle).replace(/\s+/g, '');
    if (normalizedTitle === normalizedWork || normalizedTitle.indexOf(normalizedWork + '#') === 0) return '';
  }
  return title;
}

function renderPlayerSidebar() {
  var ep = currentPlayerEpisode() || state.player.episode;
  var workTitle = '';
  var description = '';
  var studio = '';
  var characters = [];
  if (state.player.mode === 'detail' && state.currentDetail) {
    var detail = state.currentDetail;
    var work = detail.work || {};
    workTitle = work.title || '';
    description = work.description || '';
    studio = work.studio || '';
    characters = Array.isArray(detail.characters) ? detail.characters.filter(Boolean) : [];
  } else if (state.archive && state.archive.draft) {
    var draft = state.archive.draft;
    workTitle = draft.title || '未命名作品';
    description = draft.synopsis || '';
    studio = draft.studio || '';
    var draftCharacters = draft.characters || {};
    characters = Object.keys(draftCharacters).sort(function(a, b){
      return Number(a) - Number(b);
    }).map(function(key){ return draftCharacters[key]; }).filter(Boolean);
  }
  document.getElementById('playerWorkTitle').textContent = workTitle || '播放器';
  var studioElement = document.getElementById('playerWorkStudio');
  studioElement.textContent = studio;
  studioElement.hidden = !studio;
  var characterElement = document.getElementById('playerWorkCharacters');
  characterElement.innerHTML = characters.map(function(character){
    return '<span>' + escHtml(character) + '</span>';
  }).join('');
  characterElement.hidden = !characters.length;
  var descriptionElement = document.getElementById('playerWorkDescription');
  descriptionElement.textContent = description;
  var descriptionBlock = document.getElementById('playerDescriptionBlock');
  descriptionBlock.hidden = !description;
  descriptionBlock.classList.remove('expanded');
  var descriptionToggle = document.getElementById('playerDescriptionToggle');
  descriptionToggle.textContent = '展开';
  descriptionToggle.hidden = true;
  if (description) {
    requestAnimationFrame(function(){
      descriptionToggle.hidden = descriptionElement.scrollHeight <= descriptionElement.clientHeight + 1;
    });
  }

  var playlist = playerEpisodeList();
  document.getElementById('playerOtherCount').textContent = playlist.length ? playlist.length + ' 集' : '';
  document.getElementById('playerOtherEpisodes').innerHTML = playlist.length ? playlist.map(function(item){
    var number = Number(item.number || item.id) || 1;
    var isCurrent = !!ep && Number(item.id) === Number(ep.id);
    var imageUrl = item.cover_path ? coverUrl(item.cover_path) : '';
    if (!imageUrl && state.player.mode === 'archive' && state.archive.episodeCoverData) {
      imageUrl = state.archive.episodeCoverData[String(number)] || '';
    }
    var cover = imageUrl ? '<img src="' + escAttr(imageUrl) + '" alt="第' + number + '集封面">' : '暂无封面';
    var subtitle = playerEpisodeSubtitle(item, workTitle);
    return '<button class="player-other-item' + (isCurrent ? ' current' : '') + '"' + (isCurrent ? ' aria-current="true"' : ' onclick="playPlayerEpisodeById(' + Number(item.id) + ')"') + '>' +
      '<span class="player-other-cover">' + cover + '</span>' +
      '<span class="player-other-copy"><span>第 ' + String(number).padStart(2, '0') + ' 集' + (isCurrent ? ' · 播放中' : '') + '</span>' +
      (subtitle ? '<strong>' + escHtml(subtitle) + '</strong>' : '') +
      (item.release_date ? '<small>' + escHtml(item.release_date) + '</small>' : '') + '</span></button>';
  }).join('') : '<div class="player-other-empty">暂无播放内容</div>';
}

function togglePlayerDescription() {
  var block = document.getElementById('playerDescriptionBlock');
  var button = document.getElementById('playerDescriptionToggle');
  if (!block || !button) return;
  var expanded = block.classList.toggle('expanded');
  button.textContent = expanded ? '收起' : '展开';
}

function togglePlayerSidebar() {
  state.player.sidebarCollapsed = !state.player.sidebarCollapsed;
  var workspace = document.querySelector('.player-workspace');
  var button = document.getElementById('playerSidebarToggle');
  if (workspace) workspace.classList.toggle('sidebar-collapsed', state.player.sidebarCollapsed);
  if (button) {
    button.textContent = state.player.sidebarCollapsed ? '‹' : '›';
    button.title = state.player.sidebarCollapsed ? '展开信息栏' : '收起信息栏';
    button.setAttribute('aria-expanded', state.player.sidebarCollapsed ? 'false' : 'true');
  }
  scheduleMpvBoundsSync();
}

var PLAYER_FIT_MODES = {
  contain: { label: '完整显示', panscan: 0, unscaled: false },
  fill: { label: '填满画面', panscan: 1, unscaled: false },
  original: { label: '原始尺寸', panscan: 0, unscaled: true },
};

async function applyPlayerFitMode() {
  var mode = PLAYER_FIT_MODES[state.player.fitMode] || PLAYER_FIT_MODES.contain;
  var button = document.getElementById('fitModeBtn');
  if (button) button.textContent = '画面：' + mode.label;
  if (!state.player.libmpvReady) return;
  await mpvSetProperty('panscan', mode.panscan).catch(function(){});
  await mpvSetProperty('video-unscaled', mode.unscaled).catch(function(){});
}

function cyclePlayerFitMode() {
  var modes = ['contain', 'fill', 'original'];
  var index = modes.indexOf(state.player.fitMode);
  state.player.fitMode = modes[(index + 1) % modes.length];
  applyPlayerFitMode();
}

async function setPlayerFullscreen(value) {
  var enabled = !!value;
  try {
    await invoke('set_player_fullscreen', { enabled: enabled });
  } catch(e) {
    playerMessage('err', '切换全屏失败: ' + String(e));
    return;
  }
  state.player.fullscreen = enabled;
  document.body.classList.toggle('player-fullscreen', enabled);
  document.body.classList.remove('player-controls-visible');
  var button = document.getElementById('fullscreenBtn');
  if (button) {
    button.textContent = enabled ? '\uE73F' : '\uE740';
    button.title = enabled ? '退出全屏 (F)' : '全屏 (F)';
  }
  scheduleMpvBoundsSync();
}

function togglePlayerFullscreen() {
  return setPlayerFullscreen(!state.player.fullscreen);
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
  var seek = document.getElementById('playerSeek');
  if (seek) seek.value = state.player.currentTime;
  updatePlayerControls();
}

async function seekPlayerTo(value) {
  state.player.currentTime = Math.max(0, Number(value) || 0);
  updatePlayerControls();
  queuePlayerAbsoluteSeek(state.player.currentTime, true);
}

function playerSeekValueFromPointer(event) {
  var seek = document.getElementById('playerSeek');
  if (!seek) return 0;
  var rect = seek.getBoundingClientRect();
  var ratio = rect.width > 0 ? (event.clientX - rect.left) / rect.width : 0;
  ratio = Math.max(0, Math.min(1, ratio));
  return ratio * (Number(state.player.duration) || Number(seek.max) || 0);
}

function showPlayerSeekPreview(event) {
  var seek = document.getElementById('playerSeek');
  var preview = document.getElementById('playerSeekPreview');
  if (!seek || !preview) return;
  var rect = seek.getBoundingClientRect();
  var offset = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
  preview.style.left = offset + 'px';
  preview.textContent = formatTime(playerSeekValueFromPointer(event));
  preview.classList.add('visible');
}

function hidePlayerSeekPreview() {
  if (state.player.isSeeking) return;
  var preview = document.getElementById('playerSeekPreview');
  if (preview) preview.classList.remove('visible');
}

function beginPlayerPointerSeek(event) {
  if (!state.player.libmpvReady) return;
  event.preventDefault();
  showPlayerSeekPreview(event);
  state.player.isSeeking = true;
  if (event.currentTarget.setPointerCapture) event.currentTarget.setPointerCapture(event.pointerId);
  previewPlayerSeek(playerSeekValueFromPointer(event));
  queuePlayerAbsoluteSeek(state.player.currentTime, false);
}

function movePlayerPointerSeek(event) {
  showPlayerSeekPreview(event);
  if (!state.player.isSeeking) return;
  event.preventDefault();
  previewPlayerSeek(playerSeekValueFromPointer(event));
  queuePlayerAbsoluteSeek(state.player.currentTime, false);
}

function endPlayerPointerSeek(event) {
  if (!state.player.isSeeking) return;
  event.preventDefault();
  showPlayerSeekPreview(event);
  if (event.type !== 'pointercancel') previewPlayerSeek(playerSeekValueFromPointer(event));
  state.player.isSeeking = false;
  if (event.currentTarget.releasePointerCapture && event.currentTarget.hasPointerCapture(event.pointerId)) {
    event.currentTarget.releasePointerCapture(event.pointerId);
  }
  event.currentTarget.blur();
  queuePlayerAbsoluteSeek(state.player.currentTime, true);
  setTimeout(hidePlayerSeekPreview, 450);
}

function queuePlayerAbsoluteSeek(value, exact) {
  var duration = Number(state.player.duration) || 0;
  var target = Math.max(0, Number(value) || 0);
  if (duration > 0) target = Math.min(duration, target);
  state.player.pendingSeek = { value: target, exact: !!exact };
  drainPlayerSeekQueue();
}

async function drainPlayerSeekQueue() {
  if (state.player.seekCommandRunning || !state.player.libmpvReady) return;
  state.player.seekCommandRunning = true;
  try {
    while (state.player.pendingSeek) {
      var next = state.player.pendingSeek;
      state.player.pendingSeek = null;
      await mpvCommand('seek', [next.value, next.exact ? 'absolute+exact' : 'absolute+keyframes']);
    }
    if (!state.player.isSeeking) await pollMpvStatus();
  } catch(e) {
    playerMessage('err', String(e));
  } finally {
    state.player.seekCommandRunning = false;
    if (state.player.pendingSeek) drainPlayerSeekQueue();
  }
}

async function setPlayerVolume(value) {
  if (state.player.muted) return;
  var volume = Math.max(0, Math.min(100, Number(value) || 0));
  var slider = document.getElementById('playerVolume');
  if (slider) slider.value = volume;
  var label = document.getElementById('playerVolumeValue');
  if (label) label.textContent = Math.round(volume);
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
  if (btn) {
    btn.textContent = state.player.muted ? '\uE74F' : '\uE767';
    btn.title = state.player.muted ? '取消静音' : '静音';
  }
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
    await delay(350);
    await returnFromPlayer();
  } catch(e) {
    playerMessage('err', '取帧失败: ' + (e.message || e));
  }
}

async function openWorkFolder(folderPath) {
  try { await invoke('open_folder', { path: folderPath }); } catch(e) { console.error('open folder failed:', e); }
}

function askConfirm(title, body, actionText, destructive) {
  document.getElementById('confirmTitle').textContent = title;
  document.getElementById('confirmBody').textContent = body;
  var action = document.querySelector('#confirmModal [data-confirm-action], #confirmModal .modal-actions button:last-child');
  if (action) {
    action.textContent = actionText || '确认';
    action.classList.toggle('btn-danger', destructive === true);
    action.dataset.confirmAction = '1';
  }
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
  var ok = await askConfirm('删除作品', '确定删除作品“' + title + '”？只会删除数据库记录，不会删除视频文件。', '删除', true);
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

