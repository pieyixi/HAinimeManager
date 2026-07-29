<script setup lang="ts">
import { useNavigationStore } from '../stores/navigation';
import { useAppStore } from '../stores/app';

const navigation = useNavigationStore();
const app = useAppStore();

function call(name: string, ...args: unknown[]): void {
  const handler = (window as typeof window & Record<string, unknown>)[name];
  if (typeof handler === 'function') void (handler as (...values: unknown[]) => unknown)(...args);
}

function selectCurrentTarget(event: FocusEvent): void {
  (event.currentTarget as HTMLInputElement).select();
}
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-player' }" id="page-player">
    <div class="player-mask" id="playerMaskTop"></div>
    <div class="player-mask" id="playerMaskRight"></div>
    <div class="player-mask" id="playerMaskBottom"></div>
    <div class="player-mask" id="playerMaskLeft"></div>
    <div class="player-fullscreen-trigger" @mouseenter="call('showPlayerFullscreenControls')"></div>
    <div class="player-page">
      <div class="player-shell">
        <div class="player-head">
          <button type="button" class="page-back" @click="call('returnFromPlayer')">返回</button>
          <div class="player-title" id="playerTitle">播放器</div>
          <div class="player-head-actions">
            <button class="player-head-btn secondary" @click="call('openPlayerExternal')" title="使用系统播放器打开">外部打开</button>
          </div>
        </div>
        <div class="player-workspace">
          <div class="player-stage">
            <div class="player-video" id="mpvStage" @click="call('togglePlayerPlay')">
              <div class="mpv-host-hint" id="mpvHint">mpv 播放区域</div>
            </div>
            <div class="player-controls" @mouseenter="call('showPlayerFullscreenControls')" @mouseleave="call('hidePlayerFullscreenControls')">
              <div class="player-timeline-row">
                <div class="player-seek-wrap">
                  <input class="player-range" id="playerSeek" type="range" min="0" max="0" step="0.01" value="0"
                    @pointerdown="call('beginPlayerPointerSeek', $event)"
                    @pointermove="call('movePlayerPointerSeek', $event)"
                    @pointerup="call('endPlayerPointerSeek', $event)"
                    @pointercancel="call('endPlayerPointerSeek', $event)"
                    @pointerleave="call('hidePlayerSeekPreview')">
                  <span class="player-seek-preview" id="playerSeekPreview">
                    <span class="player-seek-preview-frame" id="playerSeekPreviewFrame"></span>
                    <span class="player-seek-preview-time" id="playerSeekPreviewTime">00:00</span>
                  </span>
                </div>
              </div>
              <div class="player-command-row">
                <div class="player-command-group transport-group">
                  <button class="player-control-icon primary fluent-icon" id="playerPlayBtn" @click="call('togglePlayerPlay')" title="播放/暂停 (空格)" aria-label="播放/暂停">&#xE768;</button>
                  <button class="player-control-icon fluent-icon" id="playerNextBtn" @click="call('playNextEpisode')" title="下一集" aria-label="下一集">&#xE893;</button>
                  <div class="player-time-editor">
                    <input id="playerTimeInput" value="00:00" aria-label="当前播放时间" @focus="selectCurrentTarget" @keydown="call('handlePlayerTimeKey', $event)" @blur="call('resetPlayerTimeInput')">
                    <span>/</span>
                    <span id="playerDuration">00:00</span>
                  </div>
                </div>
                <span class="player-msg" :class="app.player.messageKind" id="playerMsg">{{ app.player.messageText }}</span>
                <div class="player-command-group right">
                  <div class="player-popover-wrap">
                    <button class="player-text-tool" id="playerSpeedBtn" aria-haspopup="true">倍速</button>
                    <div class="player-popover speed-popover">
                      <button data-speed="3" @click="call('setPlayerSpeed', 3)">3.0×</button>
                      <button data-speed="2" @click="call('setPlayerSpeed', 2)">2.0×</button>
                      <button data-speed="1.5" @click="call('setPlayerSpeed', 1.5)">1.5×</button>
                      <button data-speed="1.25" @click="call('setPlayerSpeed', 1.25)">1.25×</button>
                      <button data-speed="1" @click="call('setPlayerSpeed', 1)">1.0×</button>
                      <button data-speed=".75" @click="call('setPlayerSpeed', .75)">0.75×</button>
                      <button data-speed=".5" @click="call('setPlayerSpeed', .5)">0.5×</button>
                    </div>
                  </div>
                  <div class="player-popover-wrap">
                    <button class="player-control-icon fluent-icon" title="播放设置" aria-label="播放设置">&#xE713;</button>
                    <div class="player-popover settings-popover">
                      <button data-loop-mode="off" @click="call('setPlayerLoopMode', 'off')">关闭循环</button>
                      <button data-loop-mode="one" @click="call('setPlayerLoopMode', 'one')">单集循环</button>
                      <button data-loop-mode="all" @click="call('setPlayerLoopMode', 'all')">列表循环</button>
                      <div class="player-popover-separator"></div>
                      <button id="fitModeBtn" @click="call('cyclePlayerFitMode')">画面：完整显示</button>
                    </div>
                  </div>
                  <div class="player-popover-wrap volume-wrap">
                    <button class="player-control-icon fluent-icon" id="muteBtn" @click="call('toggleMute')" title="静音 (M)" aria-label="静音">&#xE767;</button>
                    <div class="player-popover volume-popover">
                      <span id="playerVolumeValue">80</span>
                      <input class="volume-range" id="playerVolume" type="range" min="0" max="100" step="1" value="80" @input="call('setPlayerVolume', ($event.currentTarget as HTMLInputElement).value)">
                    </div>
                  </div>
                  <button class="player-control-icon fluent-icon" id="fullscreenBtn" @click="call('togglePlayerFullscreen')" title="全屏 (F)" aria-label="全屏">&#xE740;</button>
                  <button class="player-capture-btn" id="captureEpisodeBtn" @click="call('captureCurrentFrame')">使用当前画面</button>
                </div>
              </div>
            </div>
          </div>
          <div class="player-sidebar-rail">
            <button id="playerSidebarToggle" @click="call('togglePlayerSidebar')" title="收起信息栏" aria-label="收起信息栏" aria-expanded="true">›</button>
          </div>
          <aside class="player-sidebar" id="playerSidebar">
            <section class="player-work-info">
              <h2 id="playerWorkTitle">作品标题</h2>
              <div class="player-work-studio" id="playerWorkStudio"></div>
              <div class="player-work-description" id="playerDescriptionBlock">
                <p id="playerWorkDescription"></p>
                <button id="playerDescriptionToggle" @click="call('togglePlayerDescription')" hidden>展开</button>
              </div>
              <div class="player-character-tags" id="playerWorkCharacters"></div>
            </section>
            <section class="player-other-episodes">
              <div class="player-other-head">
                <strong>播放列表</strong>
                <span id="playerOtherCount"></span>
              </div>
              <div class="player-other-list" id="playerOtherEpisodes"></div>
            </section>
          </aside>
        </div>
      </div>
    </div>
  </div>
</template>
