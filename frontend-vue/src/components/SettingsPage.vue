<script setup lang="ts">
import { computed } from 'vue';
import { useArchiveStore } from '../stores/archive';
import { useAppStore } from '../stores/app';
import { useNavigationStore } from '../stores/navigation';
import { type ConsoleItem, type LibraryScan, isMissingDirectoryItem, useSettingsStore } from '../stores/settings';

const app = useAppStore();
const settings = useSettingsStore();
const archive = useArchiveStore();
const navigation = useNavigationStore();

type ScanGroupKey = keyof Pick<LibraryScan, 'changed_works' | 'new_episode_works' | 'new_complete_works' | 'attention_works'>;

const groups: Array<{ key: ScanGroupKey; title: string; order: number }> = [
  { key: 'changed_works', title: '已建档内容有变化', order: 1 },
  { key: 'new_episode_works', title: '发现新增集数', order: 2 },
  { key: 'new_complete_works', title: '可导入的新作品', order: 3 },
  { key: 'attention_works', title: '需要检查', order: 4 },
];

const connected = computed(() => !(app.mediaLibrary as { needs_binding?: boolean } | null)?.needs_binding);
const ringStyle = computed(() => ({ '--archive-angle': `${settings.archivePercent * 3.6}deg` }));
const ratioStyle = computed(() => ({ width: `${settings.archivePercent}%` }));

function openUnarchived(): void {
  void archive.openUnarchivedPage();
}

function groupItems(key: ScanGroupKey): ConsoleItem[] {
  return settings.items(key);
}

function continueArchive(key: ScanGroupKey, index: number): void {
  const item = settings.items(key)[index];
  if (!item) return;
  void archive.openArchiveAssistant(item.folder_path, item.new_episode_numbers?.[0] ?? null);
}

function duplicateSize(bytes: number): string {
  return bytes ? `${Math.round(bytes / 1024 / 1024)} MB` : '未知大小';
}
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-settings' }" id="page-settings">
    <div class="settings">
      <div class="settings-title">设置</div>
      <div class="console-shell">
        <section class="settings-overview" aria-label="媒体库概览">
          <div class="archive-visual">
            <div class="archive-ring" id="archiveProgressRing" :style="ringStyle">
              <div class="archive-ring-inner">
                <strong id="metricProgress">{{ settings.archivePercent }}%</strong>
                <span>建档率</span>
              </div>
            </div>
            <div class="archive-visual-copy">
              <span>媒体库</span>
              <strong><b id="metricTotalWorks">{{ settings.totalWorks }}</b> 部作品</strong>
              <div class="archive-ratio-track"><span id="archiveRatioBar" :style="ratioStyle"></span></div>
            </div>
          </div>
          <div class="overview-stats">
            <div class="overview-stat"><span>已建档</span><strong id="metricArchived">{{ settings.archivedCount }}</strong></div>
            <button class="overview-stat overview-link" @click="openUnarchived"><span>未建档</span><strong id="metricUnarchived">{{ settings.unarchivedCount }}</strong></button>
            <div class="overview-stat"><span>视频总集数</span><strong id="metricEpisodes">{{ settings.summary.episode_count }}</strong></div>
            <div class="overview-stat"><span>媒体库容量</span><strong id="metricSize">{{ settings.formattedSize }}</strong></div>
          </div>
        </section>

        <div class="settings-primary-grid">
          <section class="console-section console-library">
            <div class="console-section-head">
              <h2>媒体库</h2>
              <button class="btn-primary" id="consoleScanButton" :disabled="settings.busy" @click="settings.scanLibraryChanges">扫描变化</button>
            </div>
            <div class="settings-field console-path-row">
              <input v-model="settings.mediaPath" class="s-input" type="text" id="mediaPath">
              <button class="btn-secondary" @click="settings.bindMediaLibrary">更改目录</button>
            </div>
            <div id="libraryMsg">
              <div v-if="settings.libraryMessage" class="settings-msg" :class="settings.libraryMessage.kind">{{ settings.libraryMessage.text }}</div>
              <div v-else-if="connected" class="library-binding-state">媒体库已连接</div>
            </div>
            <div class="console-progress" id="consoleProgress" :class="{ active: settings.progressActive }" :aria-hidden="settings.progressActive ? 'false' : 'true'">
              <div class="console-progress-track"><span id="consoleProgressBar" :style="{ width: `${settings.progressPercent}%` }"></span></div>
              <span id="consoleProgressText">{{ settings.progressText }}</span>
            </div>
            <div class="console-results" id="consoleResults">
              <div v-if="!settings.scan && !settings.scanning" class="console-empty compact">尚未扫描</div>
              <div v-else-if="settings.scanning && !settings.scan" class="console-empty">正在读取媒体库...</div>
              <div v-else-if="settings.scan && !settings.hasScanChanges" class="console-empty compact success"><strong>没有待处理变化</strong></div>
              <template v-else>
                <section v-for="group in groups" v-show="groupItems(group.key).length" :key="group.key" class="console-result-group" :style="{ '--result-order': group.order }">
                  <div class="console-result-head">
                    <div><h3>{{ group.title }}</h3><span>{{ groupItems(group.key).length }} 项</span></div>
                    <button v-if="group.key === 'changed_works'" class="btn-primary compact" @click="settings.applyLibraryUpdates">全部更新</button>
                    <button v-if="group.key === 'new_complete_works'" class="btn-primary compact" @click="settings.importConsoleWorks">导入新作品</button>
                  </div>
                  <div class="console-result-list">
                    <div v-for="(item, index) in groupItems(group.key)" :key="item.folder_path" class="console-result-row">
                      <div class="console-result-copy">
                        <strong>{{ item.title }}</strong><span>{{ item.status }}</span>
                        <div v-if="item.new_episode_numbers?.length" class="console-episode-numbers">{{ item.new_episode_numbers.map(number => `#${number}`).join('、') }}</div>
                      </div>
                      <div class="console-row-actions">
                        <button v-if="group.key === 'new_episode_works'" class="btn-primary compact" @click="continueArchive(group.key, index)">继续建档</button>
                        <button v-if="group.key === 'attention_works' && isMissingDirectoryItem(item)" class="btn-secondary btn-danger" @click="settings.deleteMissingDatabaseRecord(index)">删除记录</button>
                        <button v-else class="btn-secondary" @click="settings.openConsoleFolder(group.key, index)">打开文件夹</button>
                      </div>
                    </div>
                  </div>
                </section>
              </template>
            </div>
          </section>

          <section class="console-section data-management">
            <div class="console-section-head"><h2>数据管理</h2></div>
            <div class="backup-actions">
              <button class="btn-secondary" :disabled="settings.busy" @click="settings.backupDatabase">备份数据库</button>
              <button class="btn-secondary" :disabled="settings.busy" @click="settings.backupDataPackage">备份资料包</button>
              <button class="btn-secondary" :disabled="settings.busy" @click="settings.restoreDatabase">恢复数据库</button>
            </div>
            <input v-model="settings.backupPath" class="s-input console-backup-path" type="text" id="dbFilePath" placeholder="备份或恢复路径，例如 D:\Ark\hanime-data-backup.zip">
            <div id="dbMsg"><div v-if="settings.databaseMessage" class="settings-msg" :class="settings.databaseMessage.kind">{{ settings.databaseMessage.text }}</div></div>
            <div class="settings-inline-tool">
              <span>重复作品检查</span>
              <button class="btn-secondary" @click="settings.duplicateCheck">开始查重</button>
            </div>
            <div id="duplicateMsg">
              <div v-if="settings.duplicateMessage" class="settings-msg" :class="settings.duplicateMessage.kind">{{ settings.duplicateMessage.text }}</div>
              <div v-if="settings.duplicates.length" style="margin-top:10px;display:flex;flex-direction:column;gap:10px">
                <div v-for="(group, groupIndex) in settings.duplicates" :key="groupIndex" class="duplicate-group">
                  <div class="duplicate-group-title">重复组 {{ groupIndex + 1 }}</div>
                  <div v-for="item in group.items" :key="item.folder_path" class="duplicate-item">
                    <div><strong>{{ item.title }}</strong> <span>({{ item.source }} / {{ item.video_count }}集 / {{ duplicateSize(item.total_size) }})</span></div>
                    <div class="duplicate-path">{{ item.folder_path }}</div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </div>
      </div>
    </div>
  </div>
</template>
