<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { calculateCoverGridLayout, useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';

const library = useLibraryStore();
const navigation = useNavigationStore();
const gridElement = ref<HTMLElement | null>(null);
const pageJump = ref(1);
const gridColumns = ref(1);
const gridCardWidth = ref(158);
let resizeObserver: ResizeObserver | null = null;
const gridStyle = computed(() => ({
  '--grid-columns': String(gridColumns.value),
  '--grid-card-width': `${gridCardWidth.value}px`,
}));

function measureGrid(preservePosition = true): void {
  const grid = gridElement.value;
  if (!grid) return;
  const style = window.getComputedStyle(grid);
  const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  const layout = calculateCoverGridLayout(grid.clientWidth, grid.clientHeight, paddingX, paddingY);
  gridColumns.value = layout.columns;
  gridCardWidth.value = layout.cardWidth;
  library.updatePageSize(layout.columns * layout.rows, preservePosition);
}

function imageError(event: Event): void {
  (event.currentTarget as HTMLImageElement).style.display = 'none';
}

function showWorkMenu(event: MouseEvent, workId?: number): void {
  if (!workId) return;
  library.closeDropdown();
  navigation.showContextMenu(event, 'work', workId);
}

function showHomeMenu(event: MouseEvent): void {
  if ((event.target as Element | null)?.closest('.cover-card')) return;
  library.closeDropdown();
  navigation.showContextMenu(event, 'home');
}

async function jumpToPage(): Promise<void> {
  await library.goPage(pageJump.value);
}

watch(() => library.currentPage, (page) => { pageJump.value = page; }, { immediate: true });
watch(
  () => [navigation.activePage, ...library.pagedWorks.map((work) => work.cover_path || '')],
  ([page]) => {
    if (page === 'page-home') void library.loadVisibleCovers();
  },
  { immediate: true, flush: 'post' },
);
watch(() => navigation.activePage, async (page) => {
  if (page !== 'page-home') return;
  await nextTick();
  measureGrid(true);
});

onMounted(() => {
  if (gridElement.value) {
    resizeObserver = new ResizeObserver(() => measureGrid(true));
    resizeObserver.observe(gridElement.value);
  }
  measureGrid(false);
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-home' }" id="page-home">
    <div class="home">
      <div ref="gridElement" class="cover-grid" id="coverGrid" :style="gridStyle" @contextmenu="showHomeMenu">
        <div v-if="library.loading" class="loading">&#128269; 加载作品数据...</div>
        <div v-else-if="library.disconnected" class="empty-state"><h2>Tauri 未连接</h2><p>请在 Tauri 窗口中打开此页面</p></div>
        <div v-else-if="library.error" class="empty-state"><h2>加载失败</h2><p>{{ library.error }}</p></div>
        <div v-else-if="!library.pagedWorks.length" class="empty-state"><h2>暂无作品</h2><p>在设置中扫描目录导入作品</p></div>
        <div v-for="work in library.pagedWorks" :key="work.id" class="cover-card" :data-work-id="work.id" @click="library.showDetail(Number(work.id))" @contextmenu="showWorkMenu($event, Number(work.id))">
          <div class="cover-img">
            <img v-if="library.coverUrl(work.cover_path)" :src="library.coverUrl(work.cover_path)" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0" @error="imageError">
            <span style="font-size:36px;color:#bbb">&#127916;</span>
            <div class="cover-hover">
              <div class="ch-title">{{ work.title }}</div>
              <div class="ch-meta">{{ work.studio || '未知制作商' }} / {{ work.year }}-{{ String(work.month).padStart(2, '0') }} / {{ Number(work.episode_count) || 0 }}集</div>
            </div>
          </div>
          <div class="cover-title">{{ work.title }}</div>
        </div>
      </div>
      <div class="pagination" id="pagination">
        <button class="page-btn" :disabled="library.currentPage <= 1" @click="library.goPage(library.currentPage - 1)">&#8249;</button>
        <template v-for="(item, index) in library.pageItems" :key="`${item}-${index}`">
          <span v-if="item === 'ellipsis'" class="page-dot">...</span>
          <button v-else class="page-num" :class="{ active: item === library.currentPage }" @click="library.goPage(item)">{{ item }}</button>
        </template>
        <button class="page-btn" :disabled="library.currentPage >= library.totalPages" @click="library.goPage(library.currentPage + 1)">&#8250;</button>
        <input v-model.number="pageJump" type="number" id="pageJump" min="1" :max="library.totalPages" style="width:48px;height:28px;border:1px solid #d1d1d6;border-radius:5px;font-size:12px;text-align:center;margin:0 4px" @keydown.enter="jumpToPage">
        <span style="font-size:12px;color:#999">共 {{ library.filteredWorks.length }} 部</span>
      </div>
    </div>

  </div>
</template>
