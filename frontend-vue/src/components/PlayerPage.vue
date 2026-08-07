<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch, watchEffect } from 'vue';
import { playerCommands } from '../features/player/commands';
import { formatPlayerSpeed, formatPlayerTime, playerEpisodeNumber, playerEpisodeSubtitle, playerFitModes } from '../features/player/model';
import type { PlayerEpisode } from '../stores/app';
import { useAppStore } from '../stores/app';
import { useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';
import { usePlayerStore, type PlayerVideoHole } from '../stores/player';
import ShellBackButton from './ShellBackButton.vue';

const app = useAppStore();
const library = useLibraryStore();
const navigation = useNavigationStore();
const player = usePlayerStore();
const stageElement = ref<HTMLElement | null>(null);
const controlsElement = ref<HTMLElement | null>(null);
const descriptionElement = ref<HTMLElement | null>(null);
let descriptionObserver: ResizeObserver | null = null;

const playlist = computed<PlayerEpisode[]>(() => player.mode === 'detail'
  ? (library.currentDetail?.episodes || []).filter((episode) => episode.video_path) as PlayerEpisode[]
  : (app.archive.draft?.episode_list || []).filter((episode) => episode.video_path) as PlayerEpisode[]);
const workTitle = computed(() => player.mode === 'detail' ? library.currentDetail?.work.title || '' : app.archive.draft?.title || '未命名作品');
const studio = computed(() => player.mode === 'detail' ? library.currentDetail?.work.studio || '' : app.archive.draft?.studio || '');
const description = computed(() => player.mode === 'detail' ? library.currentDetail?.work.description || '' : app.archive.draft?.synopsis || '');
const characters = computed(() => player.mode === 'detail'
  ? (library.currentDetail?.characters || []).filter(Boolean)
  : Object.keys(app.archive.draft?.characters || {}).sort((left, right) => Number(left) - Number(right)).map((key) => app.archive.draft?.characters[key] || '').filter(Boolean));
const currentEpisodeId = computed(() => Number(player.episode?.id));
const currentEpisodeIndex = computed(() => playlist.value.findIndex((episode) => Number(episode.id) === currentEpisodeId.value));
const nextDisabled = computed(() => currentEpisodeIndex.value < 0 || (currentEpisodeIndex.value >= playlist.value.length - 1 && player.loopMode !== 'all'));
const seekProgress = computed(() => player.duration > 0 ? Math.max(0, Math.min(100, player.currentTime / player.duration * 100)) : 0);
const speedLabel = computed(() => Math.abs(player.speed - 1) < 0.01 ? '倍速' : formatPlayerSpeed(player.speed));
const previewStyle = computed(() => ({ left: `${player.previewLeft}px` }));
const previewFrameStyle = computed(() => ({ backgroundImage: player.previewImage ? `url("${player.previewImage}")` : '' }));
function videoHoleStyle(rect: PlayerVideoHole): Record<string, string> {
  return { left: `${rect.left}px`, top: `${rect.top}px`, width: `${rect.width}px`, height: `${rect.height}px` };
}

function episodeCover(episode: PlayerEpisode): string {
  const number = playerEpisodeNumber(episode);
  return library.coverUrl(episode.cover_path) || (player.mode === 'archive' ? app.archive.episodeCoverData[number] || '' : '');
}

function playEpisode(episode: PlayerEpisode): void {
  if (Number(episode.id) !== currentEpisodeId.value) void playerCommands.playEpisodeById(episode.id);
}

function imageError(event: Event): void {
  (event.currentTarget as HTMLImageElement).style.display = 'none';
}

function focusTime(event: FocusEvent): void {
  player.editingTime = true;
  (event.currentTarget as HTMLInputElement).select();
}

function blurTime(): void {
  player.editingTime = false;
  playerCommands.resetTimeInput();
}

async function timeKeydown(event: KeyboardEvent): Promise<void> {
  const input = event.currentTarget as HTMLInputElement;
  if (event.key === 'Enter') {
    event.preventDefault();
    if (await playerCommands.commitTime(input.value)) input.blur();
    else input.select();
  } else if (event.key === 'Escape') {
    event.preventDefault();
    playerCommands.resetTimeInput();
    input.blur();
  }
}

function measureDescription(): void {
  const element = descriptionElement.value;
  player.descriptionOverflow = Boolean(element && element.scrollHeight > element.clientHeight + 1);
}

watch(description, async () => {
  player.descriptionExpanded = false;
  await nextTick();
  measureDescription();
});

watch(descriptionElement, (element) => {
  descriptionObserver?.disconnect();
  descriptionObserver = null;
  if (!element) return;
  descriptionObserver = new ResizeObserver(measureDescription);
  descriptionObserver.observe(element);
  measureDescription();
});

watch(() => navigation.activePage, async (page) => {
  if (page !== 'page-player') return;
  await nextTick();
  playerCommands.bindLayout({ stage: stageElement.value, controls: controlsElement.value });
  measureDescription();
  playerCommands.scheduleBoundsSync();
});

watchEffect(() => {
  const active = navigation.activePage === 'page-player';
  document.body.classList.toggle('player-mode', active && player.nativeVisible);
  document.body.classList.toggle('player-fullscreen', active && player.fullscreen);
  document.body.classList.toggle('player-controls-visible', active && player.fullscreen && player.controlsVisible);
  document.body.classList.toggle('player-archive-mode', active && player.mode === 'archive');
  document.body.classList.toggle('player-video-loading', active && player.videoLoading);
});

onMounted(() => {
  playerCommands.bindLayout({ stage: stageElement.value, controls: controlsElement.value });
});

onBeforeUnmount(() => {
  descriptionObserver?.disconnect();
  playerCommands.bindLayout({ stage: null, controls: null });
  document.body.classList.remove('player-mode', 'player-fullscreen', 'player-controls-visible', 'player-archive-mode', 'player-video-loading');
});
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-player' }" id="page-player">
    <div class="player-backplate" id="playerBackplate" :style="videoHoleStyle(player.videoHole)"></div>
    <div class="player-fullscreen-trigger" @mouseenter="playerCommands.showFullscreenControls"></div>
    <div class="player-page">
      <div class="player-shell">
        <div class="player-head">
          <div class="player-head-drag-region" data-tauri-drag-region></div>
          <div class="player-back-slot">
            <ShellBackButton @click="playerCommands.returnFromPlayer" />
          </div>
          <div class="player-title" id="playerTitle">{{ player.title }}</div>
          <div class="player-head-actions">
            <button class="player-head-btn secondary" @click="playerCommands.openExternal" title="使用系统播放器打开"><span class="fluent-icon">&#xE8A7;</span><span>外部打开</span></button>
          </div>
        </div>
        <div class="player-workspace" :class="{ 'sidebar-collapsed': player.sidebarCollapsed }">
          <div class="player-stage">
            <div ref="stageElement" class="player-video" id="mpvStage" @click="playerCommands.togglePlay">
              <div class="mpv-host-hint" id="mpvHint">{{ player.hint }}</div>
            </div>
            <div ref="controlsElement" class="player-controls" @mouseenter="playerCommands.showFullscreenControls" @mouseleave="playerCommands.hideFullscreenControls">
              <div class="player-timeline-row">
                <div class="player-seek-wrap">
                  <input class="player-range" id="playerSeek" type="range" min="0" :max="player.duration" step="0.01" :value="player.currentTime" :style="{ '--seek-progress': `${seekProgress}%` }"
                    @pointerdown="playerCommands.beginPointerSeek"
                    @pointermove="playerCommands.movePointerSeek"
                    @pointerup="playerCommands.endPointerSeek"
                    @pointercancel="playerCommands.endPointerSeek"
                    @pointerleave="playerCommands.hideSeekPreview">
                  <span class="player-seek-preview" :class="{ visible: player.previewVisible }" id="playerSeekPreview" :style="previewStyle">
                    <span class="player-seek-preview-frame" :class="{ loading: player.previewLoading, 'has-frame': Boolean(player.previewImage) }" id="playerSeekPreviewFrame" :style="previewFrameStyle"></span>
                    <span class="player-seek-preview-time" id="playerSeekPreviewTime">{{ player.previewTimeText }}</span>
                  </span>
                </div>
              </div>
              <div class="player-command-row">
                <div class="player-command-group transport-group">
                  <button class="player-control-icon primary fluent-icon" id="playerPlayBtn" @click="playerCommands.togglePlay" :title="player.paused ? '播放' : '暂停'" aria-label="播放/暂停">{{ player.paused ? '\uE768' : '\uE769' }}</button>
                  <button class="player-control-icon fluent-icon" id="playerNextBtn" :disabled="nextDisabled" @click="playerCommands.playNextEpisode()" title="下一集" aria-label="下一集">&#xE893;</button>
                  <div class="player-time-editor">
                    <input id="playerTimeInput" v-model="player.timeInput" aria-label="当前播放时间" @focus="focusTime" @keydown="timeKeydown" @blur="blurTime">
                    <span>/</span>
                    <span id="playerDuration">{{ formatPlayerTime(player.duration) }}</span>
                  </div>
                </div>
                <span class="player-msg" :class="player.messageKind" id="playerMsg">{{ player.messageText }}</span>
                <div class="player-command-group right">
                  <div class="player-popover-wrap">
                    <button class="player-text-tool" id="playerSpeedBtn" aria-haspopup="true">{{ speedLabel }}</button>
                    <div class="player-popover speed-popover">
                      <button v-for="speed in [3, 2, 1.5, 1.25, 1, .75, .5]" :key="speed" :class="{ active: Math.abs(player.speed - speed) < .01 }" :data-speed="speed" @click="playerCommands.setSpeed(speed)">{{ speed === 1 ? '1.0×' : `${speed}×` }}</button>
                    </div>
                  </div>
                  <div class="player-popover-wrap">
                    <button class="player-control-icon fluent-icon" title="播放设置" aria-label="播放设置">&#xE713;</button>
                    <div class="player-popover settings-popover">
                      <button v-for="option in [{ value: 'off', label: '关闭循环' }, { value: 'one', label: '单集循环' }, { value: 'all', label: '列表循环' }]" :key="option.value" :class="{ active: player.loopMode === option.value }" :data-loop-mode="option.value" @click="playerCommands.setLoopMode(option.value)">{{ option.label }}</button>
                      <div class="player-popover-separator"></div>
                      <button id="fitModeBtn" @click="playerCommands.cycleFitMode">画面：{{ playerFitModes[player.fitMode].label }}</button>
                    </div>
                  </div>
                  <div class="player-popover-wrap volume-wrap">
                    <button class="player-control-icon fluent-icon" id="muteBtn" @click="playerCommands.toggleMute" :title="player.muted ? '取消静音' : '静音'" aria-label="静音">{{ player.muted ? '\uE74F' : '\uE767' }}</button>
                    <div class="player-popover volume-popover">
                      <span id="playerVolumeValue">{{ Math.round(player.volume) }}</span>
                      <input class="volume-range" id="playerVolume" type="range" min="0" max="100" step="1" :value="player.volume" :disabled="player.muted" @input="playerCommands.setVolume(($event.currentTarget as HTMLInputElement).value)">
                    </div>
                  </div>
                  <button class="player-control-icon fluent-icon" id="fullscreenBtn" @click="playerCommands.toggleFullscreen" :title="player.fullscreen ? '退出全屏 (F)' : '全屏 (F)'" aria-label="全屏">{{ player.fullscreen ? '\uE73F' : '\uE740' }}</button>
                  <button v-if="player.mode === 'archive'" class="player-capture-btn" id="captureEpisodeBtn" @click="playerCommands.captureCurrentFrame">使用当前画面</button>
                </div>
              </div>
            </div>
          </div>
          <div class="player-sidebar-rail">
            <button id="playerSidebarToggle" @click="playerCommands.toggleSidebar" :title="player.sidebarCollapsed ? '展开信息栏' : '收起信息栏'" aria-label="收起信息栏" :aria-expanded="!player.sidebarCollapsed">{{ player.sidebarCollapsed ? '‹' : '›' }}</button>
          </div>
          <aside class="player-sidebar" id="playerSidebar">
            <section class="player-work-info">
              <h2 id="playerWorkTitle">{{ workTitle || '播放器' }}</h2>
              <div v-if="studio" class="player-work-studio" id="playerWorkStudio">{{ studio }}</div>
              <div v-if="description" class="player-work-description" :class="{ expanded: player.descriptionExpanded }" id="playerDescriptionBlock">
                <p ref="descriptionElement" id="playerWorkDescription">{{ description }}</p>
                <button v-if="player.descriptionOverflow || player.descriptionExpanded" id="playerDescriptionToggle" @click="player.descriptionExpanded = !player.descriptionExpanded">{{ player.descriptionExpanded ? '收起' : '展开' }}</button>
              </div>
              <div v-if="characters.length" class="player-character-tags" id="playerWorkCharacters"><span v-for="character in characters" :key="character">{{ character }}</span></div>
            </section>
            <section class="player-other-episodes">
              <div class="player-other-head">
                <strong>播放列表</strong>
                <span id="playerOtherCount">{{ playlist.length ? `${playlist.length} 集` : '' }}</span>
              </div>
              <div class="player-other-list" id="playerOtherEpisodes">
                <div v-if="!playlist.length" class="player-other-empty">暂无播放内容</div>
                <button v-for="episode in playlist" :key="episode.id" class="player-other-item" :class="{ current: Number(episode.id) === currentEpisodeId }" :aria-current="Number(episode.id) === currentEpisodeId || undefined" @click="playEpisode(episode)">
                  <span class="player-other-cover">
                    <img v-if="episodeCover(episode)" :src="episodeCover(episode)" :alt="`第${playerEpisodeNumber(episode)}集封面`" @error="imageError">
                    <template v-else>暂无封面</template>
                  </span>
                  <span class="player-other-copy">
                    <span>第 {{ String(playerEpisodeNumber(episode)).padStart(2, '0') }} 集{{ Number(episode.id) === currentEpisodeId ? ' · 播放中' : '' }}</span>
                    <strong v-if="playerEpisodeSubtitle(episode, workTitle)">{{ playerEpisodeSubtitle(episode, workTitle) }}</strong>
                    <small v-if="episode.release_date">{{ episode.release_date }}</small>
                  </span>
                </button>
              </div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>
