import { nextTick } from 'vue';
import { invokeTauri } from '../../api/tauri';
import type { ArchiveEpisode, PlayerEpisode } from '../../stores/app';
import { useAppStore } from '../../stores/app';
import { useArchiveStore } from '../../stores/archive';
import { useLibraryStore } from '../../stores/library';
import { useNavigationStore } from '../../stores/navigation';
import { usePlayerStore, type PlayerFitMode, type PlayerLoopMode, type PlayerMode } from '../../stores/player';
import { registerPlayerCommands, type PlayerCommandApi } from './commands';
import { createPlayerLayout } from './layout';
import { formatPlayerTime, nextPlayerEpisodeIndex, parsePlayerTime, playerFitModes, playerEpisodeNumber } from './model';
import { delay, initLibMpv, mpvCommand, mpvPlugin, mpvSetProperty, safeMpvGetProperty } from './mpv';
import { createPlayerThumbnails } from './thumbnails';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function installPlayerController(): () => void {
  const app = useAppStore();
  const archive = useArchiveStore();
  const library = useLibraryStore();
  const navigation = useNavigationStore();
  const player = usePlayerStore();
  const layout = createPlayerLayout(player);
  const thumbnails = createPlayerThumbnails(player, formatPlayerTime);
  let pollTimer: number | null = null;
  let keySeekTimer: number | null = null;
  let keySeekInterval: number | null = null;
  let pointerSeekWasPaused = false;

  function message(kind = '', text = ''): void {
    player.messageKind = kind;
    player.messageText = text;
  }

  function currentEpisode(): PlayerEpisode | null {
    if (player.mode === 'archive') return player.episode;
    if (!library.currentDetail || !player.episode) return null;
    return (library.currentDetail.episodes.find((episode) => Number(episode.id) === Number(player.episode?.id)) as PlayerEpisode | undefined) || player.episode;
  }

  function episodeList(): PlayerEpisode[] {
    if (player.mode === 'detail') return (library.currentDetail?.episodes || []).filter((episode) => episode.video_path) as PlayerEpisode[];
    return (app.archive.draft?.episode_list || []).filter((episode) => episode.video_path) as PlayerEpisode[];
  }

  function workTitle(): string {
    return player.mode === 'detail' ? library.currentDetail?.work.title || '' : app.archive.draft?.title || '未命名作品';
  }

  function stopPolling(): void {
    if (pollTimer !== null) window.clearInterval(pollTimer);
    pollTimer = null;
  }

  function stopKeySeek(): void {
    if (keySeekTimer !== null) window.clearTimeout(keySeekTimer);
    if (keySeekInterval !== null) window.clearInterval(keySeekInterval);
    keySeekTimer = null;
    keySeekInterval = null;
    if (player.keySeekDirection > 0 && player.libmpvReady) void setSpeed(1);
    player.keySeekDirection = 0;
  }

  async function pollStatus(): Promise<void> {
    if (!player.libmpvReady) return;
    const [current, duration, muted, paused, speed, ended] = await Promise.all([
      safeMpvGetProperty<number>('time-pos', 'double'),
      safeMpvGetProperty<number>('duration', 'double'),
      safeMpvGetProperty<boolean>('mute', 'flag'),
      safeMpvGetProperty<boolean>('pause', 'flag'),
      safeMpvGetProperty<number>('speed', 'double'),
      safeMpvGetProperty<boolean>('eof-reached', 'flag'),
    ]);
    if (!player.isSeeking && Number.isFinite(Number(current))) player.currentTime = Number(current);
    if (Number.isFinite(Number(duration)) && Number(duration) > 0) player.duration = Number(duration);
    if (!player.editingTime) player.timeInput = formatPlayerTime(player.currentTime);
    if (muted !== null) player.muted = Boolean(muted);
    if (paused !== null) player.paused = Boolean(paused);
    if (Number.isFinite(Number(speed))) player.speed = Number(speed);
    if (ended && player.loopMode === 'all' && !player.handlingEnd) {
      player.handlingEnd = true;
      void playNextEpisode(true).finally(() => { player.handlingEnd = false; });
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
    player.videoLoading = false;
  }

  async function applyFitMode(): Promise<void> {
    const mode = playerFitModes[player.fitMode] || playerFitModes.contain;
    if (!player.libmpvReady) return;
    await Promise.all([
      mpvSetProperty('panscan', mode.panscan).catch(() => undefined),
      mpvSetProperty('video-unscaled', mode.unscaled).catch(() => undefined),
    ]);
  }

  async function setLoopMode(mode: string): Promise<void> {
    player.loopMode = (['one', 'all'].includes(mode) ? mode : 'off') as PlayerLoopMode;
    if (!player.libmpvReady) return;
    try { await mpvSetProperty('loop-file', player.loopMode === 'one' ? 'inf' : 'no'); }
    catch (error) { message('err', `循环设置失败: ${errorText(error)}`); }
  }

  async function setVolume(value: string | number): Promise<void> {
    if (player.muted) return;
    player.volume = Math.max(0, Math.min(100, Number(value) || 0));
    try { await mpvSetProperty('volume', player.volume); }
    catch (error) { message('err', errorText(error)); }
  }

  function resetPlaybackState(mode: PlayerMode): void {
    Object.assign(player, {
      mode,
      currentTime: 0,
      duration: 0,
      timeInput: '00:00',
      editingTime: false,
      isSeeking: false,
      pendingSeek: null,
      seekCommandRunning: false,
      paused: false,
      speed: 1,
      fitMode: 'contain',
      loopMode: 'off',
      handlingEnd: false,
      sidebarCollapsed: false,
      descriptionExpanded: false,
      descriptionOverflow: false,
      controlsVisible: false,
    });
  }

  async function openPlayerWithEpisode(episode: PlayerEpisode, title: string, mode: PlayerMode = 'detail'): Promise<void> {
    if (!episode?.video_path) return;
    player.episode = episode;
    player.title = title;
    player.hint = '正在启动 mpv 播放窗口...';
    player.videoLoading = true;
    player.nativeVisible = false;
    resetPlaybackState(mode);
    thumbnails.reset(episode.video_path);
    message('info', '正在启动 mpv 播放内核...');
    navigation.showPage('page-player');
    await nextTick();
    void layout.syncBounds();
    stopPolling();
    try {
      if (!player.libmpvReady) { await initLibMpv(); player.libmpvReady = true; }
      await layout.syncBounds();
      await mpvCommand('loadfile', [episode.video_path]);
      await delay(140);
      player.nativeVisible = true;
      await layout.syncBounds();
      layout.scheduleSync();
      await applyFitMode();
      await setLoopMode('off');
      await setVolume(player.volume);
      player.muted = Boolean(await safeMpvGetProperty<boolean>('mute', 'flag'));
      await pollStatus();
      void thumbnails.prefetch(episode.video_path, player.duration);
      await waitForFirstFrame();
      player.hint = '';
      message();
      let tick = 0;
      pollTimer = window.setInterval(() => {
        void layout.syncBounds();
        tick += 1;
        if (tick % 2 === 0) void pollStatus();
      }, 250);
    } catch (error) {
      player.nativeVisible = false;
      player.videoLoading = false;
      player.hint = 'mpv 未启动';
      message('err', errorText(error));
    }
  }

  async function openPlayer(episodeId: number): Promise<void> {
    const detail = library.currentDetail;
    if (!detail) return;
    const episode = detail.episodes.find((item) => Number(item.id) === Number(episodeId)) as PlayerEpisode | undefined;
    if (episode?.video_path) await openPlayerWithEpisode(episode, `${detail.work.title} / 第${playerEpisodeNumber(episode)}集`, 'detail');
  }

  async function returnFromPlayer(): Promise<void> {
    stopPolling();
    stopKeySeek();
    thumbnails.reset('');
    const mode = player.mode;
    if (player.fullscreen) await setFullscreen(false);
    player.videoLoading = true;
    navigation.showPage(mode === 'archive' ? 'page-archive' : 'page-detail');
    try { await mpvPlugin('destroy', { windowLabel: 'main' }); } catch { /* Already stopped. */ }
    Object.assign(player, {
      libmpvReady: false,
      nativeVisible: false,
      videoLoading: false,
      episode: null,
      currentTime: 0,
      duration: 0,
      timeInput: '00:00',
      muted: false,
      paused: false,
      speed: 1,
      isSeeking: false,
      pendingSeek: null,
      mode: 'detail',
      hint: 'mpv 播放区域',
    });
  }

  async function togglePlay(): Promise<void> {
    if (!player.libmpvReady) return;
    try { await mpvCommand('cycle', ['pause']); await pollStatus(); }
    catch (error) { message('err', errorText(error)); }
  }

  async function seek(delta: number): Promise<void> {
    if (!player.libmpvReady) return;
    try { await mpvCommand('seek', [delta, 'relative']); await pollStatus(); }
    catch (error) { message('err', errorText(error)); }
  }

  async function setSpeed(value: number): Promise<void> {
    player.speed = Math.max(0.25, Math.min(4, Number(value) || 1));
    try { await mpvSetProperty('speed', player.speed); }
    catch (error) { message('err', errorText(error)); }
  }

  async function loadEpisode(episode: PlayerEpisode): Promise<void> {
    if (!episode?.video_path || !player.libmpvReady) return;
    player.episode = episode;
    player.title = `${workTitle()} / 第${playerEpisodeNumber(episode)}集`;
    thumbnails.reset(episode.video_path);
    Object.assign(player, { currentTime: 0, duration: 0, timeInput: '00:00', paused: false, handlingEnd: true, videoLoading: true });
    try {
      await mpvCommand('loadfile', [episode.video_path]);
      await mpvSetProperty('pause', false);
      await delay(120);
      await applyFitMode();
      await setLoopMode(player.loopMode);
      await pollStatus();
      void thumbnails.prefetch(episode.video_path, player.duration);
      await waitForFirstFrame();
    } finally {
      player.videoLoading = false;
      player.handlingEnd = false;
    }
  }

  async function playEpisodeById(episodeId: number): Promise<void> {
    const episode = episodeList().find((item) => Number(item.id) === Number(episodeId));
    if (episode) await loadEpisode(episode);
  }

  async function playNextEpisode(forceWrap = false): Promise<void> {
    const episodes = episodeList();
    if (!episodes.length || !player.episode) return;
    const index = episodes.findIndex((episode) => Number(episode.id) === Number(player.episode?.id));
    if (index < 0) return;
    const nextIndex = nextPlayerEpisodeIndex(index, episodes.length, forceWrap || player.loopMode === 'all');
    if (nextIndex === null) return;
    await loadEpisode(episodes[nextIndex]);
  }

  function resetTimeInput(): void {
    player.timeInput = formatPlayerTime(player.currentTime);
  }

  async function commitTime(value: string): Promise<boolean> {
    const seconds = parsePlayerTime(value);
    if (seconds === null) {
      message('err', '时间格式应为 01:23 或 1:02:03');
      return false;
    }
    await seekTo(seconds);
    return true;
  }

  async function stepFrame(direction: number): Promise<void> {
    if (!player.libmpvReady) return;
    try {
      await mpvSetProperty('pause', true);
      await mpvCommand(direction < 0 ? 'frame-back-step' : 'frame-step');
      await pollStatus();
    } catch (error) { message('err', `逐帧失败: ${errorText(error)}`); }
  }

  function toggleSidebar(): void {
    player.sidebarCollapsed = !player.sidebarCollapsed;
    layout.scheduleSync();
  }

  function cycleFitMode(): void {
    const modes: PlayerFitMode[] = ['contain', 'fill', 'original'];
    player.fitMode = modes[(modes.indexOf(player.fitMode) + 1) % modes.length];
    void applyFitMode();
  }

  async function setFullscreen(value: boolean): Promise<void> {
    try { await invokeTauri('set_player_fullscreen', { enabled: Boolean(value) }); }
    catch (error) { message('err', `切换全屏失败: ${errorText(error)}`); return; }
    player.fullscreen = Boolean(value);
    player.controlsVisible = false;
    layout.scheduleSync();
  }

  function beginKeySeek(direction: number): void {
    if (navigation.activePage !== 'page-player' || !player.libmpvReady || player.keySeekDirection === direction) return;
    stopKeySeek();
    player.keySeekDirection = direction;
    void seek(direction * 3);
    keySeekTimer = window.setTimeout(() => {
      keySeekTimer = null;
      if (player.keySeekDirection !== direction) return;
      if (direction > 0) void setSpeed(3);
      else keySeekInterval = window.setInterval(() => { void seek(-3); }, 180);
    }, 260);
  }

  function previewSeek(value: number): void {
    player.currentTime = Math.max(0, Number(value) || 0);
    if (!player.editingTime) player.timeInput = formatPlayerTime(player.currentTime);
  }

  function queueAbsoluteSeek(value: number, exact: boolean): void {
    const duration = Number(player.duration) || 0;
    let target = Math.max(0, Number(value) || 0);
    if (duration > 0) target = Math.min(duration, target);
    player.pendingSeek = { value: target, exact };
    void drainSeekQueue();
  }

  async function drainSeekQueue(): Promise<void> {
    if (player.seekCommandRunning || !player.libmpvReady) return;
    player.seekCommandRunning = true;
    try {
      while (player.pendingSeek) {
        const next = player.pendingSeek;
        player.pendingSeek = null;
        await mpvCommand('seek', [next.value, next.exact ? 'absolute+exact' : 'absolute+keyframes']);
      }
      if (!player.isSeeking) await pollStatus();
    } catch (error) { message('err', errorText(error)); }
    finally {
      player.seekCommandRunning = false;
      if (player.pendingSeek) void drainSeekQueue();
    }
  }

  async function seekTo(value: number): Promise<void> {
    previewSeek(value);
    queueAbsoluteSeek(player.currentTime, true);
  }

  function beginPointerSeek(event: PointerEvent): void {
    if (!player.libmpvReady) return;
    event.preventDefault();
    pointerSeekWasPaused = player.paused;
    const target = thumbnails.show(event);
    player.isSeeking = true;
    (event.currentTarget as HTMLElement).setPointerCapture?.(event.pointerId);
    previewSeek(target);
    queueAbsoluteSeek(player.currentTime, false);
  }

  function movePointerSeek(event: PointerEvent): void {
    const target = thumbnails.show(event);
    if (!player.isSeeking) return;
    event.preventDefault();
    previewSeek(target);
    queueAbsoluteSeek(player.currentTime, false);
  }

  function endPointerSeek(event: PointerEvent): void {
    if (!player.isSeeking) return;
    event.preventDefault();
    const target = thumbnails.show(event);
    if (event.type !== 'pointercancel') previewSeek(target);
    player.isSeeking = false;
    const element = event.currentTarget as HTMLElement;
    if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    element.blur();
    queueAbsoluteSeek(player.currentTime, true);
    void mpvSetProperty('pause', pointerSeekWasPaused).then(pollStatus).catch((error) => message('err', errorText(error)));
    window.setTimeout(thumbnails.hide, 450);
  }

  function adjustVolume(delta: number): void {
    void setVolume(player.volume + delta);
  }

  async function toggleMute(): Promise<void> {
    try {
      await mpvCommand('cycle', ['mute']);
      player.muted = Boolean(await safeMpvGetProperty<boolean>('mute', 'flag'));
    } catch (error) { message('err', errorText(error)); }
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
    if (player.mode !== 'archive') { message('info', '主库播放不提供设置封面，请到建档助手取帧'); return; }
    await pollStatus();
    const time = Number(player.currentTime) || 0;
    message('info', `正在截取 ${formatPlayerTime(time)}...`);
    try {
      const temp = await invokeTauri<{ path: string }>('prepare_temp_frame_capture');
      await delay(80);
      await mpvCommand('screenshot-to-file', [temp.path, 'video']);
      const captured = await invokeTauri<{ image_data: string }>('read_image_data', { path: temp.path });
      const dirPath = archive.dirPath.trim();
      const episodeId = Number(episode.id || episode.number);
      const savedPath = await invokeTauri<string>('save_archive_cover', { input: { dir_path: dirPath, image_data: captured.image_data, episode_id: episodeId } });
      app.archive.episodeCoverData[episodeId] = captured.image_data;
      const archiveEpisode = app.archive.draft?.episode_list.find((item: ArchiveEpisode) => Number(item.id) === episodeId);
      if (archiveEpisode) archiveEpisode.cover_path = savedPath;
      await library.reloadCoverCache(savedPath);
      message('info', '已截为本集封面');
      await delay(350);
      await returnFromPlayer();
    } catch (error) { message('err', `取帧失败: ${errorText(error)}`); }
  }

  const commands: PlayerCommandApi = {
    bindLayout: layout.bind,
    openPlayer,
    openPlayerWithEpisode,
    returnFromPlayer,
    togglePlay,
    setSpeed,
    playEpisodeById,
    playNextEpisode,
    setLoopMode,
    commitTime,
    resetTimeInput,
    stepFrame,
    toggleSidebar,
    cycleFitMode,
    setFullscreen,
    toggleFullscreen: () => setFullscreen(!player.fullscreen),
    beginKeySeek,
    stopKeySeek,
    beginPointerSeek,
    movePointerSeek,
    endPointerSeek,
    hideSeekPreview: thumbnails.hide,
    setVolume,
    adjustVolume,
    toggleMute,
    openExternal,
    captureCurrentFrame,
    scheduleBoundsSync: layout.scheduleSync,
    showFullscreenControls: layout.showFullscreenControls,
    hideFullscreenControls: () => layout.hideFullscreenControls(applyFitMode),
  };

  registerPlayerCommands(commands);

  return () => {
    stopPolling();
    stopKeySeek();
    thumbnails.dispose();
    layout.dispose();
    if (player.libmpvReady) void mpvPlugin('destroy', { windowLabel: 'main' }).catch(() => undefined);
    player.libmpvReady = false;
    player.nativeVisible = false;
    registerPlayerCommands(null);
  };
}
