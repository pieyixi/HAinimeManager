<script setup lang="ts">
import { computed } from 'vue';
import { playerCommands } from '../features/player/commands';
import type { TagSummary } from '../stores/app';
import { type FilterKey, useLibraryStore } from '../stores/library';
import { useNavigationStore } from '../stores/navigation';

const library = useLibraryStore();
const navigation = useNavigationStore();
const detail = computed(() => library.currentDetail);
const work = computed(() => detail.value?.work);
const episodes = computed(() => detail.value?.episodes || []);

interface DetailRow {
  label: string;
  tags: TagSummary[];
  filter?: FilterKey;
}

const detailRows = computed<DetailRow[]>(() => {
  if (!detail.value || !work.value) return [];
  const tags = detail.value.tags || [];
  let characters = (detail.value.characters || []).map((name) => ({ name, category: '人物' }));
  if (!characters.length) characters = tags.filter((tag) => tag.category === '人物');
  const fallbackDate = `${work.value.year}-${String(work.value.month).padStart(2, '0')}`;
  const sourceDates = work.value.release_dates?.length
    ? work.value.release_dates
    : episodes.value.map((episode) => episode.release_date || fallbackDate);
  const dates = [...new Set(sourceDates.filter(Boolean))];
  const rows: DetailRow[] = [{ label: '年份', tags: dates.map((name) => ({ name, category: '年份' })) }];
  if (characters.length) rows.push({ label: '角色', tags: characters });
  if (work.value.studio) rows.push({ label: '制作商', tags: [{ name: work.value.studio, category: '制作' }], filter: 'studio' });
  const categories: Array<[string, string, FilterKey]> = [['剧情', '剧情', 'story'], ['属性', '属性', 'attr'], ['场景', '场景', 'scene']];
  categories.forEach(([label, category, filter]) => {
    const matches = tags.filter((tag) => tag.category === category);
    if (matches.length) rows.push({ label, tags: matches, filter });
  });
  return rows;
});

const synopsis = computed(() => String(work.value?.description || '（暂无简介）')
  .replace(/\\n/g, '\n')
  .replace(/\r\n?/g, '\n')
  .split('\n')
  .map((line) => {
    const chunks: Array<{ text: string; strong: boolean }> = [];
    let cursor = 0;
    const pattern = /\*\*(.+?)\*\*/g;
    for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
      if (match.index > cursor) chunks.push({ text: line.slice(cursor, match.index), strong: false });
      chunks.push({ text: match[1], strong: true });
      cursor = pattern.lastIndex;
    }
    if (cursor < line.length) chunks.push({ text: line.slice(cursor), strong: false });
    return chunks;
  }));

function imageError(event: Event): void {
  (event.currentTarget as HTMLImageElement).style.display = 'none';
}
</script>

<template>
  <div class="page" :class="{ active: navigation.activePage === 'page-detail' }" id="page-detail">
    <div class="detail">
      <button type="button" class="page-back" @click="navigation.showPage('page-home')">返回</button>
      <div v-if="work" class="detail-layout">
        <div class="detail-left">
          <div class="detail-cover" id="detailCover">
            <img v-if="library.coverUrl(work.cover_path)" :src="library.coverUrl(work.cover_path)" style="width:100%;height:100%;object-fit:cover" @error="imageError">
            <template v-else>&#127916;</template>
          </div>
          <div class="detail-actions">
            <button class="btn-secondary" id="btnOpenFolder" @click="library.openWorkFolder(work.folder_path)">&#128451; 打开文件夹</button>
          </div>
        </div>
        <div class="detail-right">
          <div class="detail-main">
            <div class="detail-title" id="detailTitle">{{ work.title }}</div>
            <div class="detail-tags" id="detailTags">
              <div v-for="row in detailRows" :key="row.label" class="detail-tag-row" :class="{ jumpable: Boolean(row.filter) }">
                <span class="detail-section-title">{{ row.label }}</span>
                <button v-for="tag in row.tags" :key="`${row.label}-${tag.name}`" class="detail-tag" :class="{ clickable: Boolean(row.filter) }" @click="row.filter && library.jumpToSingleFilter(row.filter, tag.name)">{{ tag.name }}</button>
              </div>
            </div>
            <div class="detail-desc" id="detailDesc">
              <p v-for="(paragraph, index) in synopsis" :key="index" class="detail-desc-paragraph">
                <template v-if="paragraph.length"><template v-for="(chunk, chunkIndex) in paragraph" :key="chunkIndex"><strong v-if="chunk.strong">{{ chunk.text }}</strong><template v-else>{{ chunk.text }}</template></template></template>
                <br v-else>
              </p>
            </div>
          </div>
          <div class="detail-episodes">
            <div class="episodes-title">集数列表</div>
            <div class="episode-list" id="episodeList">
              <button v-for="(episode, index) in episodes" :key="episode.id" class="episode-item" :data-episode-id="episode.id" @click="playerCommands.openPlayer(episode.id)">
                <span class="episode-cover">
                  <img v-if="library.coverUrl(episode.cover_path)" :src="library.coverUrl(episode.cover_path)" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0" @error="imageError">
                  &#127916;
                </span>
                <span class="episode-info"><span class="episode-num">第 {{ String(Number(episode.number) || index + 1).padStart(2, '0') }} 集</span><span v-if="episode.subtitle" class="episode-sub">{{ episode.subtitle }}</span></span>
                <span class="episode-play">&#9654; 播放</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
