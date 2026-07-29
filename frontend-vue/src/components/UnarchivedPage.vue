<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { summarizeUnarchivedReasons, unarchivedIndexLetters, useArchiveStore } from '../stores/archive';
import { useAppStore } from '../stores/app';

const app = useAppStore();
const archive = useArchiveStore();
const listElement = ref<HTMLElement | null>(null);
let scrollFrame: number | null = null;

function showPage(id: string): void {
  (window as typeof window & { showPage?: (page: string) => void }).showPage?.(id);
}

function scrollToIndex(letter: string): void {
  const list = listElement.value;
  const anchor = list?.querySelector<HTMLElement>(`[data-index-anchor="${letter}"]`);
  if (!list || !anchor) return;
  archive.setActiveIndex(letter);
  list.scrollTo({ top: Math.max(0, anchor.offsetTop - 6), behavior: 'smooth' });
}

function updateIndexFromScroll(): void {
  const list = listElement.value;
  if (!list) return;
  app.unarchivedScrollTop = list.scrollTop;
  const anchors = [...list.querySelectorAll<HTMLElement>('[data-index-anchor]')];
  if (!anchors.length) return;
  let current = anchors[0].dataset.indexAnchor || '';
  const threshold = list.scrollTop + 18;
  anchors.forEach((anchor) => { if (anchor.offsetTop <= threshold) current = anchor.dataset.indexAnchor || current; });
  archive.setActiveIndex(current);
}

function handleScroll(): void {
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(updateIndexFromScroll);
}

watch(() => archive.folders, async () => {
  await nextTick();
  const list = listElement.value;
  if (!list) return;
  list.scrollTop = Math.min(app.unarchivedScrollTop || 0, Math.max(0, list.scrollHeight - list.clientHeight));
  updateIndexFromScroll();
});
</script>

<template>
  <div class="page" id="page-unarchived">
    <div class="workspace">
      <div class="workspace-top">
        <div>
          <button type="button" class="page-back" @click="showPage('page-home')">返回</button>
          <div class="workspace-title">未建档</div>
          <div class="workspace-subtitle">有视频但 data、meta 或封面不完整的文件夹会留在这里，补齐后再进入主页面。</div>
        </div>
      </div>
      <div class="workspace-panel unarchived-panel">
        <div class="settings-label">扫描目录<span class="unarchived-count" id="unarchivedCount">（{{ archive.unarchivedLoading ? '扫描中' : `共${archive.folders.length}部` }}）</span></div>
        <div class="unarchived-toolbar">
          <input v-model="archive.unarchivedPath" class="s-input" type="text" id="unarchivedPath">
          <button class="btn-secondary" @click="archive.loadUnarchivedFolders">刷新</button>
        </div>
        <div class="unarchived-content">
          <nav class="unarchived-index" id="unarchivedIndex" aria-label="名称索引">
            <button v-for="letter in unarchivedIndexLetters" :key="letter" class="unarchived-index-btn" :class="{ active: archive.activeIndex === letter }" :disabled="!archive.availableIndexes.has(letter)" @click="scrollToIndex(letter)">{{ letter }}</button>
          </nav>
          <div id="unarchivedList" ref="listElement" @scroll="handleScroll">
            <div v-if="archive.unarchivedLoading" class="settings-msg info">扫描未建档作品中...</div>
            <div v-else-if="archive.unarchivedError" class="settings-msg err">{{ archive.unarchivedError }}</div>
            <div v-else-if="!archive.folders.length" class="settings-msg info">没有未建档作品</div>
            <div v-else class="unarchived-list">
              <template v-for="group in archive.groupedFolders" :key="group.letter">
                <div class="unarchived-anchor" :data-index-anchor="group.letter">{{ group.letter }}</div>
                <div v-for="item in group.items" :key="item.folder_path" class="unarchived-card">
                  <div>
                    <div class="unarchived-name">{{ item.title }}</div>
                    <div class="unarchived-path">{{ item.folder_path }}</div>
                  </div>
                  <div class="unarchived-meta">
                    <span class="status-pill">{{ item.video_count }} 个视频</span>
                    <span class="status-pill warn">{{ item.has_meta_json ? '待补齐' : '未建档' }}</span>
                  </div>
                  <div class="reason-list"><span v-for="reason in summarizeUnarchivedReasons(item)" :key="reason" class="reason-pill">{{ reason }}</span></div>
                  <div class="unarchived-actions"><button class="btn-secondary" @click="archive.openArchiveAssistant(item.folder_path)">建档</button></div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
