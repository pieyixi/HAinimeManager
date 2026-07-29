<script setup lang="ts">
function showHome(): void {
  const handler = (window as typeof window & Record<string, unknown>).showHome;
  if (typeof handler === 'function') void (handler as () => unknown)();
}
</script>

<template>
  <div class="page" id="page-detail">
    <div class="detail">
      <button type="button" class="page-back" @click="showHome">返回</button>
      <div class="detail-layout">
        <div class="detail-left">
          <div class="detail-cover" id="detailCover">&#127916;</div>
          <div class="detail-actions">
            <button class="btn-secondary" id="btnOpenFolder">&#128451; 打开文件夹</button>
          </div>
        </div>
        <div class="detail-right">
          <div class="detail-main">
            <div class="detail-title" id="detailTitle"></div>
            <div class="detail-tags" id="detailTags"></div>
            <div class="detail-desc" id="detailDesc"></div>
          </div>
          <div class="detail-episodes">
            <div class="episodes-title">集数列表</div>
            <div class="episode-list" id="episodeList"></div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
