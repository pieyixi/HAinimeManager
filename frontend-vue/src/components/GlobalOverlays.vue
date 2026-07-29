<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';

const navigation = useNavigationStore();
const library = useLibraryStore();
const menuElement = ref<HTMLElement | null>(null);

watch(() => navigation.contextMenu.visible, async (visible) => {
  if (!visible) return;
  await nextTick();
  const menu = menuElement.value;
  if (!menu) return;
  const bounds = menu.getBoundingClientRect();
  navigation.placeContextMenu(
    Math.max(6, Math.min(navigation.contextMenu.x, window.innerWidth - bounds.width - 6)),
    Math.max(6, Math.min(navigation.contextMenu.y, window.innerHeight - bounds.height - 6)),
  );
});

async function refreshLibrary(): Promise<void> {
  navigation.closeContextMenu();
  await library.refreshHome({ clearCoverCache: true });
}

async function deleteWork(): Promise<void> {
  const workId = navigation.contextMenu.workId;
  navigation.closeContextMenu();
  if (workId) await library.deleteWork(workId);
}

function handleDocumentPointer(event: MouseEvent): void {
  if (!navigation.contextMenu.visible) return;
  if (!menuElement.value?.contains(event.target as Node)) navigation.closeContextMenu();
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  library.closeDropdown();
  navigation.closeTransientUi();
}

onMounted(() => {
  document.addEventListener('click', handleDocumentPointer);
  document.addEventListener('keydown', handleEscape);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentPointer);
  document.removeEventListener('keydown', handleEscape);
});
</script>

<template>
  <div class="modal-mask" :class="{ active: navigation.confirmation.visible }" id="confirmModal" @click.self="navigation.resolveConfirm(false)">
    <div class="modal">
      <div class="modal-title" id="confirmTitle">{{ navigation.confirmation.title || '确认操作' }}</div>
      <div class="modal-copy" id="confirmBody">{{ navigation.confirmation.body }}</div>
      <div class="modal-actions">
        <button class="btn-secondary" @click="navigation.resolveConfirm(false)">取消</button>
        <button class="btn-secondary" :class="{ 'btn-danger': navigation.confirmation.destructive }" data-confirm-action @click="navigation.resolveConfirm(true)">{{ navigation.confirmation.actionText }}</button>
      </div>
    </div>
  </div>
  <div ref="menuElement" class="context-menu" :class="{ active: navigation.contextMenu.visible }" id="workContextMenu" :style="{ left: `${navigation.contextMenu.x}px`, top: `${navigation.contextMenu.y}px` }">
    <button v-if="navigation.contextMenu.mode === 'home'" class="context-item" id="ctxRefreshHome" @click="refreshLibrary">刷新主库</button>
    <button v-if="navigation.contextMenu.mode === 'work'" class="context-item danger" id="ctxDeleteWork" @click="deleteWork">删除作品</button>
  </div>
</template>
