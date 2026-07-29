<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { useArchiveStore } from '../stores/archive';
import { type FilterKey, useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';
import { useSettingsStore } from '../stores/settings';

const library = useLibraryStore();
const navigation = useNavigationStore();
const archive = useArchiveStore();
const settings = useSettingsStore();
const gridElement = ref<HTMLElement | null>(null);
const searchElement = ref<HTMLInputElement | null>(null);
const pageJump = ref(1);
let resizeObserver: ResizeObserver | null = null;

const dropdownStyle = computed(() => ({
  top: `${library.dropdownPosition.top}px`,
  left: `${library.dropdownPosition.left}px`,
  width: `${library.dropdownPosition.width}px`,
  transform: 'translateX(-50%)',
}));

const genericOptions = computed(() => library.openDropdown && library.openDropdown !== 'year'
  ? library.filterOptions(library.openDropdown)
  : []);

function measureGrid(preservePosition = true): void {
  const grid = gridElement.value;
  if (!grid) return;
  const style = window.getComputedStyle(grid);
  const paddingX = Number.parseFloat(style.paddingLeft) + Number.parseFloat(style.paddingRight);
  const paddingY = Number.parseFloat(style.paddingTop) + Number.parseFloat(style.paddingBottom);
  library.updatePageSize(grid.clientWidth, grid.clientHeight, paddingX, paddingY, preservePosition);
}

function openFilter(key: FilterKey, event: MouseEvent): void {
  event.stopPropagation();
  library.toggleDropdown(key, event.currentTarget as HTMLElement);
}

function clearSearch(): void {
  library.clearSearchAndFilters();
  void nextTick(() => searchElement.value?.focus());
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

function jumpToPage(): void {
  library.goPage(pageJump.value);
}

function handleDocumentClick(): void {
  library.closeDropdown();
}

watch(() => library.currentPage, (page) => { pageJump.value = page; }, { immediate: true });
watch(() => navigation.activePage, async (page) => {
  if (page !== 'page-home') return;
  await nextTick();
  measureGrid(true);
});

onMounted(() => {
  document.addEventListener('click', handleDocumentClick);
  if (gridElement.value) {
    resizeObserver = new ResizeObserver(() => measureGrid(true));
    resizeObserver.observe(gridElement.value);
  }
  measureGrid(false);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  resizeObserver?.disconnect();
});
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-home' }" id="page-home">
    <div class="home">
      <div class="search-row">
        <div class="toolbar-spacer"></div>
        <div class="search-box">
          <span class="search-icon">&#128269;</span>
          <input ref="searchElement" v-model="library.search" type="text" placeholder="搜索标题、简介、制作商、Tag" id="searchInput" autocomplete="off" autocapitalize="off" spellcheck="false" @input="library.currentPage = 1">
          <span class="search-result-count" id="resultCount">{{ library.filteredWorks.length }} 个作品</span>
          <button class="search-clear" :class="{ visible: library.showClearButton }" id="searchClear" @click="clearSearch">清除</button>
        </div>
        <div class="header-actions">
          <button class="btn-icon" @click="archive.openUnarchivedPage" title="未建档">未建档</button>
          <button class="btn-icon" @click="settings.openSettingsPage" title="设置">设置</button>
        </div>
      </div>
      <div class="filter-row" id="filterRow">
        <button class="filter-btn" :class="{ active: library.isFilterActive('year') }" data-filter="year" @click="openFilter('year', $event)">年份 <span class="arrow">&#9660;</span></button>
        <button class="filter-btn" :class="{ active: library.isFilterActive('studio') }" data-filter="studio" @click="openFilter('studio', $event)">制作商 <span class="arrow">&#9660;</span></button>
        <span class="filter-sep"></span>
        <button class="filter-btn" :class="{ active: library.isFilterActive('story') }" data-filter="story" @click="openFilter('story', $event)">剧情 <span class="arrow">&#9660;</span></button>
        <button class="filter-btn" :class="{ active: library.isFilterActive('attr') }" data-filter="attr" @click="openFilter('attr', $event)">属性 <span class="arrow">&#9660;</span></button>
        <button class="filter-btn" :class="{ active: library.isFilterActive('scene') }" data-filter="scene" @click="openFilter('scene', $event)">场景 <span class="arrow">&#9660;</span></button>
        <span class="filter-sep"></span>
        <button class="filter-btn" id="sortTimeBtn" data-sort="time-desc" @click="library.toggleTimeSort">时间 {{ library.currentSort === 'time-desc' ? '⬇' : '⬆' }}</button>
        <button class="filter-btn" id="sortNameBtn" data-sort="name-asc" @click="library.toggleNameSort">名称 {{ library.currentSort === 'name-desc' ? '⬇' : '⬆' }}</button>
      </div>
      <div ref="gridElement" class="cover-grid" id="coverGrid" @contextmenu="showHomeMenu">
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

    <Teleport to="body">
      <div v-if="library.openDropdown" id="filterDropdown" class="filter-dd" :class="{ 'year-dd': library.openDropdown === 'year' }" :data-key="library.openDropdown" :style="dropdownStyle" @click.stop>
        <template v-if="library.openDropdown === 'year'">
          <div class="year-list">
            <button v-for="year in library.years" :key="year" class="year-option" :class="{ selected: library.isSelected('year', String(year)) }" @click="library.toggleWholeYear(year)">{{ year }}年</button>
          </div>
          <div class="month-panel">
            <div class="dd-header">{{ library.dropdownYear }}年</div>
            <div class="month-grid">
              <button v-for="month in 12" :key="month" class="month-cell" :class="{ selected: library.isSelected('year', `${library.dropdownYear}-${String(month).padStart(2, '0')}`) }" @click="library.toggleYearMonth(`${library.dropdownYear}-${String(month).padStart(2, '0')}`)">{{ month }}月</button>
            </div>
            <div class="dd-actions"><span @click="library.clearFilter('year')">清除</span><span @click="library.dropdownYear = library.dropdownYear">只看月份</span><span class="primary" @click="library.closeDropdown">确定</span></div>
          </div>
        </template>
        <template v-else>
          <div class="dd-header">{{ { studio: '制作商', story: '剧情', attr: '属性', scene: '场景' }[library.openDropdown] }}</div>
          <div class="dd-body" :class="library.openDropdown === 'studio' ? 'col' : 'row'">
            <button v-for="option in genericOptions" :key="option.value" class="dd-tag" :class="{ selected: library.isSelected(library.openDropdown!, option.value) }" @click="library.toggleFilter(library.openDropdown!, option.value)">{{ option.label }}</button>
          </div>
          <div class="dd-actions"><span @click="library.clearFilter(library.openDropdown!)">清除</span><span class="primary" @click="library.closeDropdown">确定</span></div>
        </template>
      </div>
    </Teleport>
  </div>
</template>
