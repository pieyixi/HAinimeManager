import { invokeTauri } from '../../api/tauri';
import type { AppStore, TagSummary, WorkSummary } from '../../stores/app';

interface EpisodeDetail {
  id: number;
  number?: number;
  title?: string;
  release_date?: string;
  cover_path?: string;
  [key: string]: unknown;
}

interface WorkDetail {
  work: WorkSummary & { id: number; folder_path?: string };
  episodes: EpisodeDetail[];
  tags: TagSummary[];
  characters?: string[];
}

type RuntimeFunction = (...args: unknown[]) => unknown;

function globalFunction(name: string): RuntimeFunction | undefined {
  const value = (window as typeof window & Record<string, unknown>)[name];
  return typeof value === 'function' ? value as RuntimeFunction : undefined;
}

function escapeHtml(value: unknown): string {
  const escape = globalFunction('escHtml');
  return escape ? String(escape(value)) : String(value);
}

function coverUrl(path?: string): string {
  const getCover = globalFunction('coverUrl');
  return getCover ? String(getCover(path)) : '';
}

export function installDetailGlobals(state: AppStore): void {
  function renderPagination(total: number, totalPages: number): void {
    const pagination = document.getElementById('pagination');
    if (!pagination) return;
    let html = `<span class="page-btn" data-page="${state.currentPage - 1}" style="${state.currentPage <= 1 ? 'opacity:0.3;pointer-events:none' : ''}">&#8249;</span>`;
    let ellipsisAdded = false;
    for (let page = 1; page <= totalPages; page += 1) {
      if (page === state.currentPage) html += `<span class="page-num active">${page}</span>`;
      else if (page === 1 || page === totalPages || Math.abs(page - state.currentPage) <= 2) html += `<span class="page-num" data-page="${page}">${page}</span>`;
      else if (!ellipsisAdded) {
        html += '<span class="page-dot">...</span>';
        ellipsisAdded = true;
      }
    }
    html += `<span class="page-btn" data-page="${state.currentPage + 1}" style="${state.currentPage >= totalPages ? 'opacity:0.3;pointer-events:none' : ''}">&#8250;</span>`;
    html += `<input type="number" id="pageJump" value="${state.currentPage}" min="1" max="${totalPages}" style="width:48px;height:28px;border:1px solid #d1d1d6;border-radius:5px;font-size:12px;text-align:center;margin:0 4px">`;
    html += `<span style="font-size:12px;color:#999">共 ${total} 部</span>`;
    pagination.innerHTML = html;
    pagination.querySelectorAll<HTMLElement>('[data-page]').forEach((element) => {
      element.addEventListener('click', () => goPage(Number(element.dataset.page)));
    });
    pagination.querySelector<HTMLInputElement>('#pageJump')?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') jumpToPage();
    });
  }

  function renderGrid(items: WorkSummary[], total?: number, totalPages?: number): void {
    const grid = document.getElementById('coverGrid');
    const count = document.getElementById('resultCount');
    if (!grid || !count) return;
    const resultTotal = total ?? items.length;
    count.textContent = `${resultTotal} 个作品`;
    if (!items.length) {
      grid.innerHTML = '<div class="empty-state"><h2>暂无作品</h2><p>在设置中扫描目录导入作品</p></div>';
      renderPagination(0, 1);
      return;
    }
    grid.innerHTML = items.map((work) => {
      const cover = coverUrl(work.cover_path);
      const image = cover ? `<img src="${cover}" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0">` : '';
      const date = `${work.year}-${String(work.month).padStart(2, '0')}`;
      const meta = [work.studio || '未知制作商', date, `${Number(work.episode_count) || 0}集`].join(' / ');
      return `<div class="cover-card" data-work-id="${Number(work.id)}"><div class="cover-img">${image}<span style="font-size:36px;color:#bbb;">&#127916;</span><div class="cover-hover"><div class="ch-title">${escapeHtml(work.title)}</div><div class="ch-meta">${escapeHtml(meta)}</div></div></div><div class="cover-title">${escapeHtml(work.title)}</div></div>`;
    }).join('');
    grid.querySelectorAll<HTMLElement>('.cover-card[data-work-id]').forEach((card) => {
      const workId = Number(card.dataset.workId);
      card.addEventListener('click', () => { void showDetail(workId); });
      card.addEventListener('contextmenu', (event) => { globalFunction('showWorkContextMenu')?.(event, workId); });
    });
    grid.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
      image.addEventListener('error', () => { image.style.display = 'none'; }, { once: true });
    });
    renderPagination(resultTotal, totalPages || 1);
  }

  function goPage(page: number): void {
    state.currentPage = page;
    globalFunction('applyFilter')?.();
  }

  function jumpToPage(): void {
    const input = document.getElementById('pageJump') as HTMLInputElement | null;
    if (!input) return;
    const page = Number.parseInt(input.value, 10);
    if (page >= 1) goPage(page);
  }

  function renderDetailSynopsis(container: HTMLElement, value?: string): void {
    const text = String(value || '（暂无简介）').replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
    container.replaceChildren();
    text.split('\n').forEach((line) => {
      const paragraph = document.createElement('p');
      paragraph.className = 'detail-desc-paragraph';
      let cursor = 0;
      const pattern = /\*\*(.+?)\*\*/g;
      for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) {
        if (match.index > cursor) paragraph.appendChild(document.createTextNode(line.slice(cursor, match.index)));
        const strong = document.createElement('strong');
        strong.textContent = match[1];
        paragraph.appendChild(strong);
        cursor = pattern.lastIndex;
      }
      if (cursor < line.length) paragraph.appendChild(document.createTextNode(line.slice(cursor)));
      if (!line.length) paragraph.appendChild(document.createElement('br'));
      container.appendChild(paragraph);
    });
  }

  async function showDetail(id: number): Promise<void> {
    try {
      const detail = await invokeTauri<WorkDetail>('get_work_detail', { workId: id });
      if (!detail?.work) return;
      state.currentDetailWorkId = id;
      state.currentDetail = detail;
      const work = detail.work;
      const episodes = detail.episodes || [];
      const tags = detail.tags || [];

      const title = document.getElementById('detailTitle');
      const description = document.getElementById('detailDesc');
      if (title) title.textContent = work.title;
      if (description) renderDetailSynopsis(description, work.description);

      const coverPaths = [work.cover_path, ...episodes.map((episode) => episode.cover_path)].filter((path): path is string => Boolean(path));
      await globalFunction('loadCovers')?.(coverPaths);

      const detailCover = document.getElementById('detailCover');
      if (detailCover) {
        const cover = coverUrl(work.cover_path);
        detailCover.replaceChildren();
        if (cover) {
          const image = document.createElement('img');
          image.src = cover;
          image.style.cssText = 'width:100%;height:100%;object-fit:cover';
          image.addEventListener('error', () => { detailCover.textContent = '🎬'; }, { once: true });
          detailCover.appendChild(image);
        } else detailCover.textContent = '🎬';
      }

      let characters: TagSummary[] = (detail.characters || []).map((name) => ({ name, category: '人物' }));
      if (!characters.length) characters = tags.filter((tag) => tag.category === '人物');
      const storyTags = tags.filter((tag) => tag.category === '剧情');
      const attributeTags = tags.filter((tag) => tag.category === '属性');
      const sceneTags = tags.filter((tag) => tag.category === '场景');
      const renderTagRow = globalFunction('renderDetailTagRow');

      const releaseDates = episodes.map((episode) => episode.release_date || `${work.year}-${String(work.month).padStart(2, '0')}`);
      let tagsHtml = '<div class="detail-tag-row"><span class="detail-section-title">年份</span>';
      releaseDates.forEach((date) => { tagsHtml += `<span class="detail-tag">${escapeHtml(date)}</span>`; });
      tagsHtml += '</div>';
      if (characters.length) tagsHtml += String(renderTagRow?.('角色', characters, null, false) || '');
      if (work.studio) tagsHtml += String(renderTagRow?.('制作商', [{ name: work.studio, category: '制作' }], 'studio', true) || '');
      if (storyTags.length) tagsHtml += String(renderTagRow?.('剧情', storyTags, 'story', true) || '');
      if (attributeTags.length) tagsHtml += String(renderTagRow?.('属性', attributeTags, 'attr', true) || '');
      if (sceneTags.length) tagsHtml += String(renderTagRow?.('场景', sceneTags, 'scene', true) || '');
      const detailTags = document.getElementById('detailTags');
      if (detailTags) {
        detailTags.innerHTML = tagsHtml;
        detailTags.querySelectorAll<HTMLElement>('[data-detail-filter]').forEach((tag) => {
          tag.addEventListener('click', () => {
            globalFunction('jumpToSingleFilter')?.(tag.dataset.detailFilter || '', tag.dataset.detailValue || '');
          });
        });
      }

      const episodeList = document.getElementById('episodeList');
      if (episodeList) {
        episodeList.innerHTML = episodes.map((episode, index) => {
          const cover = coverUrl(episode.cover_path);
          const image = cover ? `<img src="${cover}" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0">` : '';
          const episodeNumber = Number(episode.number) || index + 1;
          return `<div class="episode-item" data-episode-id="${Number(episode.id)}"><div class="episode-cover">${image}&#127916;</div><div class="episode-info"><div class="episode-num">第 ${String(episodeNumber).padStart(2, '0')} 集</div><div class="episode-sub">${escapeHtml(episode.title)}</div></div><div class="episode-play">&#9654; 播放</div></div>`;
        }).join('');
        episodeList.querySelectorAll<HTMLElement>('[data-episode-id]').forEach((item) => {
          item.addEventListener('click', () => { globalFunction('openPlayer')?.(Number(item.dataset.episodeId)); });
        });
        episodeList.querySelectorAll<HTMLImageElement>('img').forEach((image) => {
          image.addEventListener('error', () => { image.style.display = 'none'; }, { once: true });
        });
      }

      const openFolder = document.getElementById('btnOpenFolder');
      if (openFolder) openFolder.onclick = () => { globalFunction('openWorkFolder')?.(work.folder_path); };
      globalFunction('showPage')?.('page-detail');
    } catch (error) {
      console.error('showDetail failed:', error);
    }
  }

  function escapeAttribute(value: unknown): string {
    return String(value).replace(/&/g, '&amp;').replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/</g, '&lt;').replace(/"/g, '&quot;');
  }

  function formatTime(seconds: unknown): string {
    const total = Math.max(0, Number(seconds) || 0);
    const hours = Math.floor(total / 3600);
    const minutes = Math.floor((total % 3600) / 60);
    const remainingSeconds = Math.floor(total % 60);
    if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
    return `${String(minutes).padStart(2, '0')}:${String(remainingSeconds).padStart(2, '0')}`;
  }

  function playerMessage(kind?: string, text?: string): void {
    const message = document.getElementById('playerMsg');
    if (!message) return;
    message.className = `player-msg ${kind || ''}`;
    message.textContent = text || '';
  }

  Object.assign(window, {
    renderGrid,
    renderPagination,
    goPage,
    jumpToPage,
    renderDetailSynopsis,
    showDetail,
    escAttr: escapeAttribute,
    formatTime,
    playerMessage,
  });
}
