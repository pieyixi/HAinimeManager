<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import { restoredUnarchivedScrollTop, summarizeUnarchivedReasons, unarchivedIndexLetters, useArchiveStore, type UnarchivedItem } from '../stores/archive';
import { useAppStore } from '../stores/app';
import { useNavigationStore } from '../stores/navigation';

const app = useAppStore();
const archive = useArchiveStore();
const navigation = useNavigationStore();
const listElement = ref<HTMLElement | null>(null);
const anchorElements = new Map<string, HTMLElement>();
const cardElements = new Map<string, HTMLElement>();
let scrollFrame: number | null = null;

function setAnchorElement(letter: string, element: unknown): void {
  if (element instanceof HTMLElement) anchorElements.set(letter, element);
  else anchorElements.delete(letter);
}

function setCardElement(folderPath: string, element: unknown): void {
  if (element instanceof HTMLElement) cardElements.set(folderPath, element);
  else cardElements.delete(folderPath);
}

function scrollToIndex(letter: string): void {
  const list = listElement.value;
  const anchor = anchorElements.get(letter);
  if (!list || !anchor) return;
  archive.setActiveIndex(letter);
  list.scrollTo({ top: Math.max(0, anchor.offsetTop - 6), behavior: 'smooth' });
}

function updateIndexFromScroll(): void {
  const list = listElement.value;
  if (!list || archive.unarchivedLoading) return;
  app.unarchivedScrollTop = list.scrollTop;
  const anchors = archive.groupedFolders.map((group) => anchorElements.get(group.letter)).filter((anchor): anchor is HTMLElement => Boolean(anchor));
  if (!anchors.length) return;
  let current = anchors[0].dataset.indexAnchor || '';
  const threshold = list.scrollTop + 18;
  anchors.forEach((anchor) => { if (anchor.offsetTop <= threshold) current = anchor.dataset.indexAnchor || current; });
  archive.setActiveIndex(current);
}

function openArchive(item: UnarchivedItem): void {
  const list = listElement.value;
  const card = cardElements.get(item.folder_path);
  if (list) app.unarchivedScrollTop = list.scrollTop;
  app.unarchivedFocusPath = item.folder_path;
  app.unarchivedFocusOffset = list && card ? Math.max(0, card.offsetTop - list.scrollTop) : 0;
  void archive.openArchiveAssistant(item.folder_path);
}

function handleScroll(): void {
  if (scrollFrame !== null) cancelAnimationFrame(scrollFrame);
  scrollFrame = requestAnimationFrame(updateIndexFromScroll);
}

watch(() => archive.unarchivedLoading, async (loading) => {
  if (loading) return;
  await nextTick();
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  const list = listElement.value;
  if (!list) return;
  const focusedCard = cardElements.get(app.unarchivedFocusPath);
  list.scrollTop = restoredUnarchivedScrollTop(
    app.unarchivedScrollTop,
    list.scrollHeight - list.clientHeight,
    focusedCard?.offsetTop,
    app.unarchivedFocusOffset,
  );
  updateIndexFromScroll();
});
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-unarchived' }" id="page-unarchived">
    <div class="workspace">
      <div class="workspace-top">
        <div>
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
                <div :ref="(element) => setAnchorElement(group.letter, element)" class="unarchived-anchor" :data-index-anchor="group.letter">{{ group.letter }}</div>
                <div v-for="item in group.items" :key="item.folder_path" :ref="(element) => setCardElement(item.folder_path, element)" class="unarchived-card">
                  <div>
                    <div class="unarchived-name">{{ item.title }}</div>
                    <div class="unarchived-path">{{ item.folder_path }}</div>
                  </div>
                  <div class="unarchived-meta">
                    <span class="status-pill">{{ item.video_count }} 个视频</span>
                    <span class="status-pill warn">{{ item.has_meta_json ? '待补齐' : '未建档' }}</span>
                  </div>
                  <div class="reason-list"><span v-for="reason in summarizeUnarchivedReasons(item)" :key="reason" class="reason-pill">{{ reason }}</span></div>
                  <div class="unarchived-actions"><button class="btn-secondary" @click="openArchive(item)">建档</button></div>
                </div>
              </template>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
