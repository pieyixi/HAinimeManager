<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { currentTauriWindow, type TauriWindowHandle } from '../api/tauri';
import { useArchiveStore } from '../stores/archive';
import { type FilterKey, useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';
import { useSettingsStore } from '../stores/settings';
import { useUiStore } from '../stores/ui';
import ShellBackButton from './ShellBackButton.vue';

const navigation = useNavigationStore();
const library = useLibraryStore();
const archive = useArchiveStore();
const settings = useSettingsStore();
const ui = useUiStore();
const searchElement = ref<HTMLInputElement | null>(null);
const searchContainer = ref<HTMLElement | null>(null);
const searchExpanded = ref(false);
const maximized = ref(false);
let appWindow: TauriWindowHandle | null = null;
let stopResize: (() => void) | null = null;

const isHome = computed(() => navigation.activePage === 'page-home');
const isPlayer = computed(() => navigation.activePage === 'page-player');
const pageTitle = computed(() => ({
  'page-detail': '作品详情',
  'page-settings': '设置',
  'page-unarchived': '未建档',
  'page-archive': '建档助手',
} as Record<string, string>)[navigation.activePage] || '首页');
const unarchivedCount = computed(() => Math.max(archive.folders.length, settings.unarchivedCount));
const dropdownStyle = computed(() => ({
  top: `${library.dropdownPosition.top}px`,
  left: `${library.dropdownPosition.left}px`,
  width: `${library.dropdownPosition.width}px`,
  transform: 'translateX(-50%)',
}));
const genericOptions = computed(() => library.openDropdown && library.openDropdown !== 'year'
  ? library.filterOptions(library.openDropdown)
  : []);
const filterLabels: Record<FilterKey, string> = {
  year: '发行时间',
  studio: '制作商',
  story: '剧情',
  attr: '属性',
  scene: '场景',
};
const activeFilterCount = computed(() => library.openDropdown
  ? Object.keys(library.activeFilters[library.openDropdown] || {}).length
  : 0);

function openFilter(key: FilterKey, event: MouseEvent): void {
  event.stopPropagation();
  collapseSearch();
  library.toggleDropdown(key, event.currentTarget as HTMLElement);
}

function clearSearch(): void {
  library.clearSearchAndFilters();
  void nextTick(() => searchElement.value?.focus());
}

function expandSearch(): void {
  if (searchExpanded.value) return;
  searchExpanded.value = true;
  library.closeDropdown();
}

function collapseSearch(): void {
  if (!searchExpanded.value) return;
  searchExpanded.value = false;
  if (document.activeElement === searchElement.value) searchElement.value?.blur();
}

function goHome(): void {
  library.closeDropdown();
  navigation.showPage('page-home');
}

function goBack(): void {
  if (navigation.activePage === 'page-archive') void archive.openUnarchivedPage();
  else goHome();
}

function toggleTheme(event: MouseEvent): void {
  ui.toggleTheme({ x: event.clientX, y: event.clientY });
}

async function syncMaximized(): Promise<void> {
  if (appWindow) maximized.value = await appWindow.isMaximized().catch(() => false);
}

async function minimizeWindow(): Promise<void> {
  await appWindow?.minimize();
}

async function toggleMaximize(): Promise<void> {
  await appWindow?.toggleMaximize();
  await syncMaximized();
}

async function closeWindow(): Promise<void> {
  await appWindow?.close();
}

function handleDocumentClick(event: MouseEvent): void {
  library.closeDropdown();
}

function handleDocumentPointerDown(event: PointerEvent): void {
  if (searchExpanded.value && !searchContainer.value?.contains(event.target as Node)) collapseSearch();
}

watch(() => navigation.activePage, (page) => {
  if (page !== 'page-home') collapseSearch();
});

onMounted(async () => {
  ui.initialize();
  document.addEventListener('click', handleDocumentClick);
  document.addEventListener('pointerdown', handleDocumentPointerDown, true);
  appWindow = currentTauriWindow();
  await syncMaximized();
  if (appWindow) stopResize = await appWindow.onResized(() => { void syncMaximized(); }).catch(() => null);
});

onBeforeUnmount(() => {
  document.removeEventListener('click', handleDocumentClick);
  document.removeEventListener('pointerdown', handleDocumentPointerDown, true);
  stopResize?.();
});
</script>

<template>
  <aside v-if="!isPlayer" class="app-sidebar">
    <div class="sidebar-primary">
      <ShellBackButton :disabled="isHome" @click="goBack" />
      <button class="sidebar-item" :class="{ active: isHome }" aria-label="首页" @click="goHome">
        <span class="fluent-icon sidebar-icon">&#xE80F;</span><span class="sidebar-label">首页</span>
      </button>
    </div>
    <div class="sidebar-secondary">
      <button class="sidebar-item" :class="{ active: navigation.activePage === 'page-unarchived' || navigation.activePage === 'page-archive' }" aria-label="未建档" @click="archive.openUnarchivedPage">
        <span class="fluent-icon sidebar-icon">&#xE8B7;</span><span class="sidebar-label">未建档</span><b v-if="unarchivedCount" class="sidebar-badge">{{ unarchivedCount > 99 ? '99+' : unarchivedCount }}</b>
      </button>
      <button class="sidebar-item" :aria-label="ui.theme === 'light' ? '切换到深色模式' : '切换到浅色模式'" @click="toggleTheme">
        <span class="fluent-icon sidebar-icon">{{ ui.theme === 'light' ? '\uE708' : '\uE706' }}</span><span class="sidebar-label">{{ ui.theme === 'light' ? '夜间' : '白天' }}</span>
      </button>
      <button class="sidebar-item" :class="{ active: navigation.activePage === 'page-settings' }" aria-label="设置" @click="settings.openSettingsPage">
        <span class="fluent-icon sidebar-icon">&#xE713;</span><span class="sidebar-label">设置</span>
      </button>
    </div>
  </aside>

  <header v-if="!isPlayer" class="app-titlebar" :class="{ 'search-active': isHome && searchExpanded }">
    <div class="titlebar-drag-region" data-tauri-drag-region @pointerdown="library.closeDropdown" @dblclick="toggleMaximize"></div>
    <div class="titlebar-navigation" id="filterRow">
      <template v-if="isHome">
        <button class="top-filter-tab" :class="{ active: library.isFilterActive('year') }" @click="openFilter('year', $event)">年份<span class="top-filter-arrow">⌄</span></button>
        <button class="top-filter-tab" :class="{ active: library.isFilterActive('studio') }" @click="openFilter('studio', $event)">制作商<span class="top-filter-arrow">⌄</span></button>
        <button class="top-filter-tab" :class="{ active: library.isFilterActive('story') }" @click="openFilter('story', $event)">剧情<span class="top-filter-arrow">⌄</span></button>
        <button class="top-filter-tab" :class="{ active: library.isFilterActive('attr') }" @click="openFilter('attr', $event)">属性<span class="top-filter-arrow">⌄</span></button>
        <button class="top-filter-tab" :class="{ active: library.isFilterActive('scene') }" @click="openFilter('scene', $event)">场景<span class="top-filter-arrow">⌄</span></button>
        <button class="top-sort-btn" id="sortTimeBtn" :class="{ active: library.currentSort.startsWith('time') }" title="切换时间顺序" @click="library.toggleTimeSort">时间<span class="fluent-icon">{{ library.currentSort === 'time-desc' ? '\uE74A' : '\uE74B' }}</span></button>
        <button class="top-sort-btn" id="sortNameBtn" :class="{ active: library.currentSort.startsWith('name') }" title="切换名称顺序" @click="library.toggleNameSort">名称<span class="fluent-icon">{{ library.currentSort === 'name-desc' ? '\uE74A' : '\uE74B' }}</span></button>
      </template>
      <template v-else>
        <span class="titlebar-page-name">{{ pageTitle }}</span>
      </template>
    </div>

    <span v-if="isHome" class="titlebar-result-count" id="resultCount">{{ library.filteredWorks.length }} 部</span>
    <button v-if="isHome && searchExpanded" class="titlebar-search-dismiss" type="button" tabindex="-1" aria-hidden="true" @pointerdown.stop.prevent="collapseSearch"></button>
    <div v-if="isHome" ref="searchContainer" class="titlebar-search" @pointerdown.stop>
      <input id="searchInput" ref="searchElement" v-model="library.search" type="text" placeholder="搜索标题、别名、简介、制作商、Tag" autocomplete="off" spellcheck="false" @focus="expandSearch" @input="library.currentPage = 1" @keydown.esc="collapseSearch">
      <button v-if="library.showClearButton" class="titlebar-search-clear" id="searchClear" @click="clearSearch">清除</button>
      <button class="titlebar-favorite fluent-icon" :class="{ active: library.favoriteCharacterMode }" :disabled="!library.favoriteCharacters.length" :title="library.favoriteCharacters.length ? '只看收藏角色作品' : '尚未收藏角色'" @click="library.toggleFavoriteCharacterMode">{{ library.favoriteCharacterMode ? '\uE735' : '\uE734' }}</button>
      <span class="titlebar-search-icon fluent-icon">&#xE721;</span>
    </div>
    <div class="window-control-divider"></div>
    <div class="window-controls">
      <button class="window-control minimize" title="最小化" aria-label="最小化" @click="minimizeWindow"></button>
      <button class="window-control maximize" :class="{ restore: maximized }" :title="maximized ? '还原' : '最大化'" :aria-label="maximized ? '还原' : '最大化'" @click="toggleMaximize"></button>
      <button class="window-control close" title="关闭" aria-label="关闭" @click="closeWindow"></button>
    </div>
  </header>

  <div v-else class="immersive-window-chrome" data-tauri-drag-region @dblclick.self="toggleMaximize">
    <div class="window-control-divider"></div>
    <div class="window-controls">
      <button class="window-control minimize" title="最小化" aria-label="最小化" @click="minimizeWindow"></button>
      <button class="window-control maximize" :class="{ restore: maximized }" :title="maximized ? '还原' : '最大化'" :aria-label="maximized ? '还原' : '最大化'" @click="toggleMaximize"></button>
      <button class="window-control close" title="关闭" aria-label="关闭" @click="closeWindow"></button>
    </div>
  </div>

  <Teleport to="body">
    <div v-if="library.openDropdown" id="filterDropdown" class="filter-dd" :class="{ 'year-dd': library.openDropdown === 'year' }" :data-key="library.openDropdown" :style="dropdownStyle" @click.stop>
      <div class="filter-dd-head">
        <div>
          <strong>{{ filterLabels[library.openDropdown] }}</strong>
        </div>
        <span v-if="activeFilterCount" class="filter-dd-count">已选 {{ activeFilterCount }}</span>
      </div>
      <template v-if="library.openDropdown === 'year'">
        <div class="year-picker">
          <div class="year-list">
            <button v-for="year in library.years" :key="year" class="year-option" :class="{ current: library.dropdownYear === year, selected: library.isSelected('year', String(year)) }" @click="library.toggleWholeYear(year)">
              <span>{{ year }}</span><span class="year-check fluent-icon">{{ library.isSelected('year', String(year)) ? '\uE73E' : '\uE76C' }}</span>
            </button>
          </div>
          <div class="month-panel">
            <div class="month-panel-title"><strong>{{ library.dropdownYear }}</strong><span>按月份细分</span></div>
            <div class="month-grid">
              <button v-for="month in 12" :key="month" class="month-cell" :class="{ selected: library.isSelected('year', `${library.dropdownYear}-${String(month).padStart(2, '0')}`) }" @click="library.toggleYearMonth(`${library.dropdownYear}-${String(month).padStart(2, '0')}`)">{{ String(month).padStart(2, '0') }}月</button>
            </div>
          </div>
        </div>
        <div class="dd-actions"><button class="dd-reset" :disabled="!activeFilterCount" @click="library.clearFilter('year')">重置</button><button class="dd-confirm" @click="library.closeDropdown">完成</button></div>
      </template>
      <template v-else>
        <div class="dd-body" :class="library.openDropdown === 'studio' ? 'col' : 'row'">
          <button v-for="option in genericOptions" :key="option.value" class="dd-tag" :class="{ selected: library.isSelected(library.openDropdown!, option.value) }" @click="library.toggleFilter(library.openDropdown!, option.value)"><span>{{ option.label }}</span><span v-if="library.isSelected(library.openDropdown!, option.value)" class="dd-tag-check fluent-icon">&#xE73E;</span></button>
        </div>
        <div class="dd-actions"><button class="dd-reset" :disabled="!activeFilterCount" @click="library.clearFilter(library.openDropdown!)">重置</button><button class="dd-confirm" @click="library.closeDropdown">完成</button></div>
      </template>
    </div>
  </Teleport>
</template>
