<script setup lang="ts">
import { nextTick, watch } from 'vue';
import type { ArchiveEpisode } from '../stores/app';
import { useAppStore } from '../stores/app';
import { useArchiveStore } from '../stores/archive';

const archive = useArchiveStore();
const app = useAppStore();

watch(() => app.archive.focusEpisode, async (episodeId) => {
  if (!episodeId || app.activePage !== 'page-archive') return;
  await nextTick();
  const editor = document.querySelector<HTMLElement>(`.episode-editor[data-ep="${episodeId}"]`);
  editor?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  editor?.classList.add('archive-focus');
  window.setTimeout(() => editor?.classList.remove('archive-focus'), 1600);
  app.archive.focusEpisode = null;
}, { immediate: true });

function dropFile(event: DragEvent): File | undefined {
  return event.dataTransfer?.files?.[0];
}

function setEpisodeTags(episode: ArchiveEpisode, category: keyof ArchiveEpisode['tags'], event: Event): void {
  episode.tags[category] = (event.target as HTMLInputElement).value.split(/[,，、;；]/).map((tag) => tag.trim()).filter(Boolean);
}
</script>

<template>
  <div class="page" id="page-archive">
    <div class="archive">
      <button type="button" class="page-back" @click="archive.openUnarchivedPage">返回</button>
      <div class="archive-title">建档助手</div>
      <div class="archive-shell">
        <div class="archive-panel archive-sidebar">
          <div class="archive-sidebar-top">
            <div class="archive-section-title">作品目录</div>
            <div class="archive-field">
              <div class="archive-label">目录路径</div>
              <input v-model="archive.dirPath" class="archive-input" id="archiveDir" placeholder="例如 D:\HAnime\作品名">
            </div>
            <div class="archive-actions archive-folder-actions">
              <button class="btn-secondary" @click="archive.openWorkFolder">打开文件夹</button>
              <button class="btn-secondary" :disabled="archive.copied" @click="archive.copyDataPath">{{ archive.copied ? '已复制' : '复制 data 路径' }}</button>
              <button class="btn-secondary" :disabled="archive.refreshing" @click="archive.refreshDraft">{{ archive.refreshing ? '刷新中' : '刷新' }}</button>
            </div>
          </div>

          <div class="archive-sidebar-section archive-cover-section">
            <div class="archive-section-title">主封面</div>
            <div class="drop-zone" id="archiveCoverDrop" @dragover.prevent @drop.prevent="archive.setMainCover(dropFile($event))">
              <img v-if="archive.mainCoverPreview" :src="archive.mainCoverPreview">
              <template v-else>拖入主封面</template>
            </div>
          </div>

          <div class="archive-sidebar-section archive-json-section">
            <div class="archive-section-title">直接粘贴 meta.json</div>
            <div class="archive-field">
              <textarea v-model="archive.jsonText" class="archive-textarea json-paste" id="archiveJsonPaste" placeholder="粘贴完整 meta.json，校验通过后会直接写入 data/meta.json"></textarea>
            </div>
            <div class="archive-actions"><button class="btn-secondary" @click="archive.savePastedJson">校验并保存 JSON</button></div>
            <div class="archive-hint">Tag 字段建议保存为数组；表单输入支持 , ， 、 ; ； 分隔。</div>
            <div id="jsonPasteMsg"><div v-if="archive.jsonMessage" class="settings-msg" :class="archive.jsonMessage.kind">{{ archive.jsonMessage.text }}</div></div>
          </div>
        </div>

        <div class="archive-panel">
          <div class="archive-section-title">操作</div>
          <div class="archive-actions">
            <button class="btn-secondary" @click="archive.saveArchive(false)">保存 meta</button>
            <button class="btn-secondary" @click="archive.saveArchive(true)">保存并导入</button>
          </div>
          <div id="archiveMsg"><div v-if="archive.message" class="settings-msg" :class="archive.message.kind">{{ archive.message.text }}</div></div>

          <div style="height:16px"></div>
          <div class="archive-section-title">元数据</div>
          <div class="archive-field"><div class="archive-label">标题</div><input v-model="archive.title" class="archive-input" id="archiveTitle"></div>
          <div class="archive-field"><div class="archive-label">制作商</div><input v-model="archive.studio" class="archive-input" id="archiveStudio"></div>
          <div class="archive-field"><div class="archive-label">女主 / 角色（每行一个）</div><textarea v-model="archive.charactersText" class="archive-textarea" id="archiveCharacters"></textarea></div>
          <div class="archive-field"><div class="archive-label">简介</div><textarea v-model="archive.synopsis" class="archive-textarea" id="archiveSynopsis"></textarea></div>
          <div style="height:16px"></div>
          <div class="archive-section-title">集数与封面</div>
          <div id="archiveEpisodes">
            <div v-if="!archive.episodes.length" class="archive-hint">未发现视频文件</div>
            <div v-for="episode in archive.episodes" :key="episode.id" class="episode-editor" :data-ep="episode.id">
              <div>
                <div class="drop-zone small" :data-episode-drop="episode.id" @dragover.prevent @drop.prevent="archive.setEpisodeCover(episode.id, dropFile($event))">
                  <img v-if="archive.episodePreview(episode)" :src="archive.episodePreview(episode)">
                  <template v-else>拖入第{{ episode.id }}集封面</template>
                </div>
                <div class="archive-inline-actions"><button class="btn-secondary" @click="archive.playEpisodeForCover(episode.id)">播放取帧</button></div>
              </div>
              <div class="episode-editor-main">
                <div><div class="archive-label">第{{ episode.id }}集官方副标题（可空）</div><input v-model="episode.subtitle" class="archive-input" data-ep-field="subtitle"></div>
                <div><div class="archive-label">发售时间</div><input v-model="episode.release_date" class="archive-input" data-ep-field="release_date" placeholder="YYYY-MM"></div>
                <div class="episode-tags">
                  <div><div class="archive-label">剧情 Tag</div><input class="archive-input" data-ep-field="theme" :value="episode.tags.theme.join(', ')" @input="setEpisodeTags(episode, 'theme', $event)"></div>
                  <div><div class="archive-label">属性 Tag</div><input class="archive-input" data-ep-field="attribute" :value="episode.tags.attribute.join(', ')" @input="setEpisodeTags(episode, 'attribute', $event)"></div>
                  <div><div class="archive-label">场景 Tag</div><input class="archive-input" data-ep-field="scene" :value="episode.tags.scene.join(', ')" @input="setEpisodeTags(episode, 'scene', $event)"></div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
