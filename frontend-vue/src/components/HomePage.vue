<script setup lang="ts">
function call(name: string, ...args: unknown[]): void {
  const handler = (window as typeof window & Record<string, unknown>)[name];
  if (typeof handler === 'function') void (handler as (...values: unknown[]) => unknown)(...args);
}
</script>

<template>
  <div class="page active" id="page-home">
    <div class="home">
      <div class="search-row">
        <div class="toolbar-spacer"></div>
        <div class="search-box">
          <span class="search-icon">&#128269;</span>
          <input type="text" placeholder="搜索标题、简介、制作商、Tag" id="searchInput" autocomplete="off" autocapitalize="off" spellcheck="false" @input="call('applyFilter')">
          <span class="search-result-count" id="resultCount"></span>
          <button class="search-clear" id="searchClear" @click="call('clearSearch')">清除</button>
        </div>
        <div class="header-actions">
          <button class="btn-icon" @click="call('openUnarchivedPage')" title="未建档">未建档</button>
          <button class="btn-icon" @click="call('openSettingsPage')" title="设置">设置</button>
        </div>
      </div>
      <div class="filter-row" id="filterRow">
        <button class="filter-btn" data-filter="year">年份 <span class="arrow">&#9660;</span></button>
        <button class="filter-btn" data-filter="studio">制作商 <span class="arrow">&#9660;</span></button>
        <span class="filter-sep"></span>
        <button class="filter-btn" data-filter="story">剧情 <span class="arrow">&#9660;</span></button>
        <button class="filter-btn" data-filter="attr">属性 <span class="arrow">&#9660;</span></button>
        <button class="filter-btn" data-filter="scene">场景 <span class="arrow">&#9660;</span></button>
        <span class="filter-sep"></span>
        <button class="filter-btn" id="sortTimeBtn" data-sort="time-desc">时间 &#11015;</button>
        <button class="filter-btn" id="sortNameBtn" data-sort="name-asc">名称 &#11014;</button>
      </div>
      <div class="cover-grid" id="coverGrid">
        <div class="loading">加载中...</div>
      </div>
      <div class="pagination" id="pagination"></div>
    </div>
  </div>
</template>
