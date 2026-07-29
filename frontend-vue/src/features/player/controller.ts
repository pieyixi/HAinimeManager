import { invokeTauri } from '../../api/tauri';
import type { AppStore, ArchiveEpisode, PlayerEpisode } from '../../stores/app';
import { useLibraryStore } from '../../stores/library';
import { useNavigationStore } from '../../stores/navigation';
import { registerPlayerCommands } from './commands';
import { createPlayerLayout } from './layout';
import { delay, initLibMpv, mpvCommand, mpvPlugin, mpvSetProperty, safeMpvGetProperty } from './mpv';
import { createPlayerThumbnails } from './thumbnails';

type PlayerMode = 'detail' | 'archive';
type LoopMode = 'off' | 'one' | 'all';
type FitMode = 'contain' | 'fill' | 'original';

const fitModes: Record<FitMode, { label: string; panscan: number; unscaled: boolean }> = {
  contain: { label: '完整显示', panscan: 0, unscaled: false },
  fill: { label: '填满画面', panscan: 1, unscaled: false },
  original: { label: '原始尺寸', panscan: 0, unscaled: true },
};

function formatTime(seconds: number): string {
  const total = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remaining = Math.floor(total % 60);
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`
    : `${String(minutes).padStart(2, '0')}:${String(remaining).padStart(2, '0')}`;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function installPlayerController(state: AppStore): void {
  function message(kind = '', text = ''): void {
    state.player.messageKind = kind;
    state.player.messageText = text;
  }

  const layout = createPlayerLayout(state);
  const thumbnails = createPlayerThumbnails(state, formatTime);
  const library = useLibraryStore();
  const navigation = useNavigationStore();
  let pointerSeekWasPaused = false;

  function currentEpisode(): PlayerEpisode | null {
    if (state.player.mode === 'archive') return state.player.episode;
    if (!library.currentDetail || !state.player.episode) return null;
    return (library.currentDetail.episodes.find((episode) => episode.id === state.player.episode?.id) as PlayerEpisode | undefined) || state.player.episode;
  }

  function episodeList(): PlayerEpisode[] {
    if (state.player.mode === 'detail') return (library.currentDetail?.episodes || []) as PlayerEpisode[];
    return (state.archive.draft?.episode_list || []) as PlayerEpisode[];
  }

  function updateNextButton(): void {
    const button = document.getElementById('playerNextBtn') as HTMLButtonElement | null;
    if (!button) return;
    const episodes = episodeList();
    const index = episodes.findIndex((episode) => episode.id === state.player.episode?.id);
    button.disabled = index < 0 || (index >= episodes.length - 1 && state.player.loopMode !== 'all');
  }

  function updateCaptureButton(): void {
    const button = document.getElementById('captureEpisodeBtn') as HTMLButtonElement | null;
    if (!button) return;
    const disabled = state.player.mode !== 'archive';
    button.disabled = disabled;
    button.style.display = disabled ? 'none' : '';
    button.title = disabled ? '主库播放不提供设置封面，请到建档助手取帧' : '';
  }

  function formatSpeed(value: number): string {
    return (Number(value) || 1).toFixed(2).replace(/\.00$/, '').replace(/0$/, '') + '×';
  }

  function updateControls(): void {
    const seek = document.getElementById('playerSeek') as HTMLInputElement | null;
    const currentTime = document.getElementById('playerTimeInput') as HTMLInputElement | null;
    const durationTime = document.getElementById('playerDuration');
    if (!seek || !currentTime || !durationTime) return;
    const duration = Number(state.player.duration) || 0;
    const current = Number(state.player.currentTime) || 0;
    seek.max = String(duration || 0);
    if (!state.player.isSeeking) seek.value = String(current || 0);
    seek.style.setProperty('--seek-progress', `${duration > 0 ? Math.max(0, Math.min(100, current / duration * 100)) : 0}%`);
    if (document.activeElement !== currentTime) currentTime.value = formatTime(current);
    durationTime.textContent = formatTime(duration);
    const play = document.getElementById('playerPlayBtn');
    if (play) {
      play.textContent = state.player.paused ? '\uE768' : '\uE769';
      play.title = state.player.paused ? '播放' : '暂停';
    }
    const speed = document.getElementById('playerSpeedBtn');
    if (speed) speed.textContent = Math.abs(state.player.speed - 1) < 0.01 ? '倍速' : formatSpeed(state.player.speed);
    document.querySelectorAll<HTMLButtonElement>('.speed-popover button[data-speed]').forEach((button) => {
      button.classList.toggle('active', Math.abs(Number(button.dataset.speed) - state.player.speed) < 0.01);
    });
    updateNextButton();
    updateCaptureButton();
  }

  function updateMuteControls(): void {
    const button = document.getElementById('muteBtn');
    const volume = document.getElementById('playerVolume') as HTMLInputElement | null;
    if (button) {
      button.textContent = state.player.muted ? '\uE74F' : '\uE767';
      button.title = state.player.muted ? '取消静音' : '静音';
    }
    if (volume) volume.disabled = state.player.muted;
  }

  function stopTimer(): void {
    if (state.player.timer !== null) window.clearInterval(state.player.timer);
    state.player.timer = null;
  }

  async function pollStatus(): Promise<void> {
    if (!state.player.libmpvReady) return;
    const [current, duration, muted, paused, speed, ended] = await Promise.all([
      safeMpvGetProperty<number>('time-pos', 'double'),
      safeMpvGetProperty<number>('duration', 'double'),
      safeMpvGetProperty<boolean>('mute', 'flag'),
      safeMpvGetProperty<boolean>('pause', 'flag'),
      safeMpvGetProperty<number>('speed', 'double'),
      safeMpvGetProperty<boolean>('eof-reached', 'flag'),
    ]);
    if (!state.player.isSeeking && Number.isFinite(Number(current))) state.player.currentTime = Number(current);
    if (Number.isFinite(Number(duration)) && Number(duration) > 0) state.player.duration = Number(duration);
    if (muted !== null) state.player.muted = Boolean(muted);
    if (paused !== null) state.player.paused = Boolean(paused);
    if (Number.isFinite(Number(speed))) state.player.speed = Number(speed);
    updateControls();
    updateMuteControls();
    if (ended && state.player.loopMode === 'all' && !state.player.handlingEnd) {
      state.player.handlingEnd = true;
      void playNextEpisode(true).finally(() => { state.player.handlingEnd = false; });
    }
  }

  async function waitForFirstFrame(): Promise<void> {
    const deadline = Date.now() + 4000;
    while (Date.now() < deadline) {
      const [duration, time] = await Promise.all([
        safeMpvGetProperty<number>('duration', 'double'),
        safeMpvGetProperty<number>('time-pos', 'double'),
      ]);
      if (Number(duration) > 0 && Number.isFinite(Number(time))) { await delay(160); break; }
      await delay(80);
    }
    document.body.classList.remove('player-video-loading');
  }

  function episodeTitle(episode: PlayerEpisode): string {
    return String(episode.title || episode.subtitle || `第${episode.number || episode.id || ''}集`);
  }

  function episodeSubtitle(episode: PlayerEpisode, workTitle: string): string {
    const title = String(episode.title || episode.subtitle || '').trim();
    if (!title || /^第?\s*0*\d+\s*[集话話]$/i.test(title) || /^#\s*0*\d+$/i.test(title)) return '';
    const normalizedTitle = title.replace(/\s+/g, '');
    const normalizedWork = String(workTitle).replace(/\s+/g, '');
    if (normalizedWork && (normalizedTitle === normalizedWork || normalizedTitle.startsWith(`${normalizedWork}#`))) return '';
    return title;
  }

  function coverUrl(path?: string): string {
    return library.coverUrl(path);
  }

  function renderSidebar(): void {
    const episode = currentEpisode() || state.player.episode;
    const detail = library.currentDetail;
    const draft = state.archive.draft;
    const workTitle = state.player.mode === 'detail' ? detail?.work.title || '' : draft?.title || '未命名作品';
    const description = state.player.mode === 'detail' ? detail?.work.description || '' : draft?.synopsis || '';
    const studio = state.player.mode === 'detail' ? detail?.work.studio || '' : draft?.studio || '';
    const characters = state.player.mode === 'detail'
      ? (detail?.characters || []).filter(Boolean)
      : Object.keys(draft?.characters || {}).sort((left, right) => Number(left) - Number(right)).map((key) => draft?.characters[key] || '').filter(Boolean);

    const titleElement = document.getElementById('playerWorkTitle');
    const studioElement = document.getElementById('playerWorkStudio');
    const characterElement = document.getElementById('playerWorkCharacters');
    const descriptionElement = document.getElementById('playerWorkDescription');
    const descriptionBlock = document.getElementById('playerDescriptionBlock');
    const descriptionToggle = document.getElementById('playerDescriptionToggle') as HTMLButtonElement | null;
    if (titleElement) titleElement.textContent = workTitle || '播放器';
    if (studioElement) { studioElement.textContent = studio; studioElement.hidden = !studio; }
    if (characterElement) {
      characterElement.replaceChildren(...characters.map((character) => {
        const tag = document.createElement('span');
        tag.textContent = character;
        return tag;
      }));
      characterElement.hidden = !characters.length;
    }
    if (descriptionElement) descriptionElement.textContent = description;
    if (descriptionBlock) { descriptionBlock.hidden = !description; descriptionBlock.classList.remove('expanded'); }
    if (descriptionToggle) { descriptionToggle.textContent = '展开'; descriptionToggle.hidden = true; }
    if (description && descriptionElement && descriptionToggle) {
      window.requestAnimationFrame(() => { descriptionToggle.hidden = descriptionElement.scrollHeight <= descriptionElement.clientHeight + 1; });
    }

    const playlist = episodeList();
    const count = document.getElementById('playerOtherCount');
    const list = document.getElementById('playerOtherEpisodes');
    if (count) count.textContent = playlist.length ? `${playlist.length} 集` : '';
    if (!list) return;
    list.replaceChildren();
    if (!playlist.length) {
      const empty = document.createElement('div');
      empty.className = 'player-other-empty';
      empty.textContent = '暂无播放内容';
      list.appendChild(empty);
      return;
    }
    playlist.forEach((item) => {
      const number = Number(item.number || item.id) || 1;
      const current = Number(item.id) === Number(episode?.id);
      const button = document.createElement('button');
      button.className = `player-other-item${current ? ' current' : ''}`;
      if (current) button.setAttribute('aria-current', 'true');
      else button.addEventListener('click', () => { void playEpisodeById(item.id); });
      const cover = document.createElement('span');
      cover.className = 'player-other-cover';
      const imageUrl = coverUrl(item.cover_path) || (state.player.mode === 'archive' ? state.archive.episodeCoverData[number] || '' : '');
      if (imageUrl) {
        const image = document.createElement('img');
        image.src = imageUrl;
        image.alt = `第${number}集封面`;
        cover.appendChild(image);
      } else cover.textContent = '暂无封面';
      const copy = document.createElement('span');
      copy.className = 'player-other-copy';
      const numberLine = document.createElement('span');
      numberLine.textContent = `第 ${String(number).padStart(2, '0')} 集${current ? ' · 播放中' : ''}`;
      copy.appendChild(numberLine);
      const subtitle = episodeSubtitle(item, workTitle);
      if (subtitle) { const strong = document.createElement('strong'); strong.textContent = subtitle; copy.appendChild(strong); }
      if (item.release_date) { const small = document.createElement('small'); small.textContent = item.release_date; copy.appendChild(small); }
      button.append(cover, copy);
      list.appendChild(button);
    });
  }

  async function applyFitMode(): Promise<void> {
    const mode = fitModes[state.player.fitMode as FitMode] || fitModes.contain;
    const button = document.getElementById('fitModeBtn');
    if (button) button.textContent = `画面：${mode.label}`;
    if (!state.player.libmpvReady) return;
    await Promise.all([
      mpvSetProperty('panscan', mode.panscan).catch(() => undefined),
      mpvSetProperty('video-unscaled', mode.unscaled).catch(() => undefined),
    ]);
  }

  async function setLoopMode(mode: string): Promise<void> {
    state.player.loopMode = (['one', 'all'].includes(mode) ? mode : 'off') as LoopMode;
    document.querySelectorAll<HTMLElement>('[data-loop-mode]').forEach((button) => button.classList.toggle('active', button.dataset.loopMode === state.player.loopMode));
    updateNextButton();
    if (!state.player.libmpvReady) return;
    try { await mpvSetProperty('loop-file', state.player.loopMode === 'one' ? 'inf' : 'no'); }
    catch (error) { message('err', `循环设置失败: ${errorText(error)}`); }
  }

  async function setVolume(value: string | number): Promise<void> {
    if (state.player.muted) return;
    const volume = Math.max(0, Math.min(100, Number(value) || 0));
    const slider = document.getElementById('playerVolume') as HTMLInputElement | null;
    const label = document.getElementById('playerVolumeValue');
    if (slider) slider.value = String(volume);
    if (label) label.textContent = String(Math.round(volume));
    try { await mpvSetProperty('volume', volume); }
    catch (error) { message('err', errorText(error)); }
  }

  async function openPlayerWithEpisode(episode: PlayerEpisode, title: string, mode: PlayerMode = 'detail'): Promise<void> {
    if (!episode) return;
    state.player.episode = episode;
    thumbnails.reset(episode.video_path);
    Object.assign(state.player, {
      mode,
      isSeeking: false,
      pendingSeek: null,
      seekCommandRunning: false,
      paused: false,
      speed: 1,
      fitMode: 'contain',
      loopMode: 'off',
      handlingEnd: false,
      sidebarCollapsed: false,
    });
    document.body.classList.toggle('player-archive-mode', mode === 'archive');
    document.querySelector('.player-workspace')?.classList.remove('sidebar-collapsed');
    const sidebarButton = document.getElementById('playerSidebarToggle');
    if (sidebarButton) {
      sidebarButton.textContent = '›';
      sidebarButton.title = '收起信息栏';
      sidebarButton.setAttribute('aria-expanded', 'true');
    }
    const titleElement = document.getElementById('playerTitle');
    const hint = document.getElementById('mpvHint');
    if (titleElement) titleElement.textContent = title;
    if (hint) hint.textContent = '正在启动 mpv 播放窗口...';
    renderSidebar();
    message('info', '正在启动 mpv 播放内核...');
    updateCaptureButton();
    document.body.classList.add('player-video-loading');
    navigation.showPage('page-player');
    void layout.syncBounds();
    stopTimer();
    try {
      if (!state.player.libmpvReady) { await initLibMpv(); state.player.libmpvReady = true; }
      await layout.syncBounds();
      await mpvCommand('loadfile', [episode.video_path]);
      state.player.currentTime = 0;
      state.player.duration = 0;
      updateControls();
      await delay(140);
      document.body.classList.add('player-mode');
      await layout.syncBounds();
      layout.scheduleSync();
      await applyFitMode();
      await setLoopMode('off');
      const volume = (document.getElementById('playerVolume') as HTMLInputElement | null)?.value || 80;
      await setVolume(volume);
      await updateMuteFromMpv();
      await pollStatus();
      void thumbnails.prefetch(episode.video_path, state.player.duration);
      await waitForFirstFrame();
      if (hint) hint.textContent = '';
      message();
      let tick = 0;
      state.player.timer = window.setInterval(() => {
        void layout.syncBounds();
        tick += 1;
        if (tick % 2 === 0) void pollStatus();
      }, 250);
    } catch (error) {
      if (hint) hint.textContent = 'mpv 未启动';
      message('err', errorText(error));
    }
  }

  async function openPlayer(episodeId: number): Promise<void> {
    const detail = library.currentDetail;
    if (!detail) return;
    const episode = detail.episodes.find((item) => item.id === episodeId) as PlayerEpisode | undefined;
    if (episode?.video_path) await openPlayerWithEpisode(episode, `${detail.work.title} / 第${episode.number || episode.id}集`, 'detail');
  }

  function stopKeySeek(): void {
    if (state.player.keySeekTimer !== null) window.clearTimeout(state.player.keySeekTimer);
    if (state.player.keySeekInterval !== null) window.clearInterval(state.player.keySeekInterval);
    state.player.keySeekTimer = null;
    state.player.keySeekInterval = null;
    if (state.player.keySeekDirection > 0 && state.player.libmpvReady) void setSpeed(1);
    state.player.keySeekDirection = 0;
  }

  async function returnFromPlayer(): Promise<void> {
    stopTimer();
    stopKeySeek();
    thumbnails.reset('');
    const mode = state.player.mode;
    if (state.player.fullscreen) await setFullscreen(false);
    document.body.classList.add('player-video-loading');
    navigation.showPage(mode === 'archive' ? 'page-archive' : 'page-detail');
    try { await mpvPlugin('destroy', { windowLabel: 'main' }); } catch { /* Already stopped. */ }
    Object.assign(state.player, {
      libmpvReady: false,
      currentTime: 0,
      duration: 0,
      muted: false,
      paused: false,
      speed: 1,
      isSeeking: false,
      pendingSeek: null,
      mode: 'detail',
    });
    document.body.classList.remove('player-archive-mode', 'player-video-loading');
    updateControls();
    updateMuteControls();
  }

  async function togglePlay(): Promise<void> {
    try { await mpvCommand('cycle', ['pause']); await pollStatus(); }
    catch (error) { message('err', errorText(error)); }
  }

  async function seek(delta: number): Promise<void> {
    try { await mpvCommand('seek', [delta, 'relative']); await pollStatus(); }
    catch (error) { message('err', errorText(error)); }
  }

  async function setSpeed(value: number): Promise<void> {
    const speed = Math.max(0.25, Math.min(4, Number(value) || 1));
    state.player.speed = speed;
    updateControls();
    try { await mpvSetProperty('speed', speed); }
    catch (error) { message('err', errorText(error)); }
  }

  async function loadEpisode(episode: PlayerEpisode): Promise<void> {
    if (!episode || !state.player.libmpvReady) return;
    state.player.episode = episode;
    thumbnails.reset(episode.video_path);
    Object.assign(state.player, { currentTime: 0, duration: 0, paused: false, handlingEnd: true });
    const title = document.getElementById('playerTitle');
    if (title && library.currentDetail?.work) title.textContent = `${library.currentDetail.work.title} / 第${episode.number || episode.id}集`;
    renderSidebar();
    updateControls();
    document.body.classList.add('player-video-loading');
    try {
      await mpvCommand('loadfile', [episode.video_path]);
      await mpvSetProperty('pause', false);
      await delay(120);
      await applyFitMode();
      await setLoopMode(state.player.loopMode);
      await pollStatus();
      void thumbnails.prefetch(episode.video_path, state.player.duration);
      await waitForFirstFrame();
    } finally {
      document.body.classList.remove('player-video-loading');
      state.player.handlingEnd = false;
    }
  }

  async function playEpisodeById(episodeId: number): Promise<void> {
    const episode = episodeList().find((item) => Number(item.id) === Number(episodeId));
    if (episode) await loadEpisode(episode);
  }

  async function playNextEpisode(forceWrap = false): Promise<void> {
    const episodes = episodeList();
    if (!episodes.length || !state.player.episode) return;
    const index = episodes.findIndex((episode) => episode.id === state.player.episode?.id);
    if (index < 0) return;
    let nextIndex = index + 1;
    if (nextIndex >= episodes.length) {
      if (forceWrap || state.player.loopMode === 'all') nextIndex = 0;
      else return;
    }
    await loadEpisode(episodes[nextIndex]);
  }

  function parseTime(value: string): number | null {
    const parts = String(value || '').trim().split(':');
    if (parts.length > 3 || parts.some((part) => !part || !/^\d+$/.test(part))) return null;
    const seconds = parts.reduce((total, part) => total * 60 + Number(part), 0);
    return Number.isFinite(seconds) ? seconds : null;
  }

  function handleTimeKey(event: KeyboardEvent): void {
    const input = event.currentTarget as HTMLInputElement;
    if (event.key === 'Enter') {
      event.preventDefault();
      const seconds = parseTime(input.value);
      if (seconds === null) { message('err', '时间格式应为 01:23 或 1:02:03'); input.select(); return; }
      void seekTo(seconds);
      input.blur();
    } else if (event.key === 'Escape') {
      resetTimeInput();
      input.blur();
    }
  }

  function resetTimeInput(): void {
    const input = document.getElementById('playerTimeInput') as HTMLInputElement | null;
    if (input) input.value = formatTime(state.player.currentTime);
  }

  async function stepFrame(direction: number): Promise<void> {
    if (!state.player.libmpvReady) return;
    try {
      await mpvSetProperty('pause', true);
      await mpvCommand(direction < 0 ? 'frame-back-step' : 'frame-step');
      await pollStatus();
    } catch (error) { message('err', `逐帧失败: ${errorText(error)}`); }
  }

  function toggleDescription(): void {
    const block = document.getElementById('playerDescriptionBlock');
    const button = document.getElementById('playerDescriptionToggle');
    if (!block || !button) return;
    const expanded = block.classList.toggle('expanded');
    button.textContent = expanded ? '收起' : '展开';
  }

  function toggleSidebar(): void {
    state.player.sidebarCollapsed = !state.player.sidebarCollapsed;
    document.querySelector('.player-workspace')?.classList.toggle('sidebar-collapsed', state.player.sidebarCollapsed);
    const button = document.getElementById('playerSidebarToggle');
    if (button) {
      button.textContent = state.player.sidebarCollapsed ? '‹' : '›';
      button.title = state.player.sidebarCollapsed ? '展开信息栏' : '收起信息栏';
      button.setAttribute('aria-expanded', state.player.sidebarCollapsed ? 'false' : 'true');
    }
    layout.scheduleSync();
  }

  function cycleFitMode(): void {
    const modes: FitMode[] = ['contain', 'fill', 'original'];
    state.player.fitMode = modes[(modes.indexOf(state.player.fitMode as FitMode) + 1) % modes.length];
    void applyFitMode();
  }

  async function setFullscreen(value: boolean): Promise<void> {
    try { await invokeTauri('set_player_fullscreen', { enabled: Boolean(value) }); }
    catch (error) { message('err', `切换全屏失败: ${errorText(error)}`); return; }
    state.player.fullscreen = Boolean(value);
    document.body.classList.toggle('player-fullscreen', state.player.fullscreen);
    document.body.classList.remove('player-controls-visible');
    const button = document.getElementById('fullscreenBtn');
    if (button) {
      button.textContent = state.player.fullscreen ? '\uE73F' : '\uE740';
      button.title = state.player.fullscreen ? '退出全屏 (F)' : '全屏 (F)';
    }
    layout.scheduleSync();
  }

  function beginKeySeek(direction: number): void {
    if (!document.getElementById('page-player')?.classList.contains('active') || !state.player.libmpvReady || state.player.keySeekDirection === direction) return;
    stopKeySeek();
    state.player.keySeekDirection = direction;
    void seek(direction * 3);
    state.player.keySeekTimer = window.setTimeout(() => {
      if (state.player.keySeekDirection !== direction) return;
      if (direction > 0) void setSpeed(3);
      else state.player.keySeekInterval = window.setInterval(() => { void seek(-3); }, 180);
    }, 260);
  }

  function previewSeek(value: number): void {
    state.player.currentTime = Math.max(0, Number(value) || 0);
    const input = document.getElementById('playerSeek') as HTMLInputElement | null;
    if (input) input.value = String(state.player.currentTime);
    updateControls();
  }

  function queueAbsoluteSeek(value: number, exact: boolean): void {
    const duration = Number(state.player.duration) || 0;
    let target = Math.max(0, Number(value) || 0);
    if (duration > 0) target = Math.min(duration, target);
    state.player.pendingSeek = { value: target, exact };
    void drainSeekQueue();
  }

  async function drainSeekQueue(): Promise<void> {
    if (state.player.seekCommandRunning || !state.player.libmpvReady) return;
    state.player.seekCommandRunning = true;
    try {
      while (state.player.pendingSeek) {
        const next = state.player.pendingSeek;
        state.player.pendingSeek = null;
        await mpvCommand('seek', [next.value, next.exact ? 'absolute+exact' : 'absolute+keyframes']);
      }
      if (!state.player.isSeeking) await pollStatus();
    } catch (error) { message('err', errorText(error)); }
    finally {
      state.player.seekCommandRunning = false;
      if (state.player.pendingSeek) void drainSeekQueue();
    }
  }

  async function seekTo(value: number): Promise<void> {
    state.player.currentTime = Math.max(0, Number(value) || 0);
    updateControls();
    queueAbsoluteSeek(state.player.currentTime, true);
  }

  function beginPointerSeek(event: PointerEvent): void {
    if (!state.player.libmpvReady) return;
    event.preventDefault();
    pointerSeekWasPaused = state.player.paused;
    const target = thumbnails.show(event);
    state.player.isSeeking = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    previewSeek(target);
    queueAbsoluteSeek(state.player.currentTime, false);
  }

  function movePointerSeek(event: PointerEvent): void {
    const target = thumbnails.show(event);
    if (!state.player.isSeeking) return;
    event.preventDefault();
    previewSeek(target);
    queueAbsoluteSeek(state.player.currentTime, false);
  }

  function endPointerSeek(event: PointerEvent): void {
    if (!state.player.isSeeking) return;
    event.preventDefault();
    const target = thumbnails.show(event);
    if (event.type !== 'pointercancel') previewSeek(target);
    state.player.isSeeking = false;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.blur();
    queueAbsoluteSeek(state.player.currentTime, true);
    void mpvSetProperty('pause', pointerSeekWasPaused).then(pollStatus).catch((error) => message('err', errorText(error)));
    window.setTimeout(thumbnails.hide, 450);
  }

  function adjustVolume(delta: number): void {
    const input = document.getElementById('playerVolume') as HTMLInputElement | null;
    void setVolume((input ? Number(input.value) : 60) + delta);
  }

  async function toggleMute(): Promise<void> {
    try { await mpvCommand('cycle', ['mute']); await updateMuteFromMpv(); }
    catch (error) { message('err', errorText(error)); }
  }

  async function updateMuteFromMpv(): Promise<void> {
    state.player.muted = Boolean(await safeMpvGetProperty<boolean>('mute', 'flag'));
    updateMuteControls();
  }

  async function openExternal(): Promise<void> {
    const episode = currentEpisode();
    if (!episode) return;
    try { await invokeTauri('play_video', { videoPath: episode.video_path }); }
    catch (error) { console.error('play failed:', error); }
  }

  async function captureCurrentFrame(): Promise<void> {
    const episode = currentEpisode();
    if (!episode) return;
    if (state.player.mode !== 'archive') { message('info', '主库播放不提供设置封面，请到建档助手取帧'); return; }
    await pollStatus();
    const time = Number(state.player.currentTime) || 0;
    message('info', `正在截取 ${formatTime(time)}...`);
    try {
      const temp = await invokeTauri<{ path: string }>('prepare_temp_frame_capture');
      await delay(80);
      await mpvCommand('screenshot-to-file', [temp.path, 'video']);
      const captured = await invokeTauri<{ image_data: string }>('read_image_data', { path: temp.path });
      const dirPath = (document.getElementById('archiveDir') as HTMLInputElement | null)?.value.trim() || '';
      const episodeId = Number(episode.id || episode.number);
      const savedPath = await invokeTauri<string>('save_archive_cover', { input: { dir_path: dirPath, image_data: captured.image_data, episode_id: episodeId } });
      state.archive.episodeCoverData[episodeId] = captured.image_data;
      const archiveEpisode = state.archive.draft?.episode_list.find((item: ArchiveEpisode) => Number(item.id) === episodeId);
      if (archiveEpisode) archiveEpisode.cover_path = savedPath;
      await library.reloadCoverCache(savedPath);
      message('info', '已截为本集封面');
      await delay(350);
      await returnFromPlayer();
    } catch (error) { message('err', `取帧失败: ${errorText(error)}`); }
  }

  registerPlayerCommands({ openPlayer, openPlayerWithEpisode });

  Object.assign(window, {
    updatePlayerControls: updateControls,
    pollMpvStatus: pollStatus,
    syncMpvBounds: layout.syncBounds,
    scheduleMpvBoundsSync: layout.scheduleSync,
    showPlayerFullscreenControls: layout.showFullscreenControls,
    hidePlayerFullscreenControls: () => layout.hideFullscreenControls(applyFitMode),
    openPlayerWithEpisode,
    openPlayer,
    returnFromPlayer,
    togglePlayerPlay: togglePlay,
    seekPlayer: seek,
    setPlayerSpeed: setSpeed,
    playPlayerEpisodeById: playEpisodeById,
    playNextEpisode,
    setPlayerLoopMode: setLoopMode,
    handlePlayerTimeKey: handleTimeKey,
    resetPlayerTimeInput: resetTimeInput,
    formatPlayerSpeed: formatSpeed,
    cyclePlayerSpeed: () => {
      const speeds = [0.5, 1, 1.5, 2, 3];
      const index = speeds.findIndex((speed) => Math.abs(speed - state.player.speed) < 0.05);
      void setSpeed(speeds[(index + 1 + speeds.length) % speeds.length]);
    },
    stepPlayerFrame: stepFrame,
    playerEpisodeTitle: episodeTitle,
    renderPlayerSidebar: renderSidebar,
    togglePlayerDescription: toggleDescription,
    togglePlayerSidebar: toggleSidebar,
    applyPlayerFitMode: applyFitMode,
    cyclePlayerFitMode: cycleFitMode,
    setPlayerFullscreen: setFullscreen,
    togglePlayerFullscreen: () => setFullscreen(!state.player.fullscreen),
    beginPlayerKeySeek: beginKeySeek,
    stopPlayerKeySeek: stopKeySeek,
    previewPlayerSeek: previewSeek,
    seekPlayerTo: seekTo,
    showPlayerSeekPreview: thumbnails.show,
    hidePlayerSeekPreview: thumbnails.hide,
    beginPlayerPointerSeek: beginPointerSeek,
    movePlayerPointerSeek: movePointerSeek,
    endPlayerPointerSeek: endPointerSeek,
    setPlayerVolume: setVolume,
    adjustPlayerVolume: adjustVolume,
    toggleMute,
    updateMuteFromMpv,
    updateMuteControls,
    openPlayerExternal: openExternal,
    captureCurrentFrame,
  });
}
