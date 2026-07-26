#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const ROOT = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const OUTPUT = process.argv[3] ? path.resolve(process.argv[3]) : path.join(ROOT, 'parse-result.json');

const TRAD_TO_SIMPLE = new Map([
  ['內射', '内射'],
  ['純愛', '纯爱'],
  ['腳交', '脚交'],
  ['著衣', '着衣'],
  ['處女', '处女'],
  ['近親', '近亲'],
  ['陰毛', '阴毛'],
  ['顏射', '颜射'],
  ['癡漢', '痴汉'],
]);

const DROP_TAGS = new Set([
  '中文字幕',
  '繁體中文',
  '繁体中文',
  '英文字幕',
  '1080p',
  '720p',
  '480p',
  'HD',
  '高清',
]);

const TAG_CATEGORY = {
  theme: new Set([
    '纯爱', '近亲', '恋爱喜剧', '凌辱', '催眠', '逆强制', 'NTR',
  ]),
  attribute: new Set([
    '姐', '巨乳', '御姐', '着衣', '处女', '阴毛', 'JK', '水手服', '比基尼',
    '马尾', '丝袜', '泳装', '和服', '女王样',
  ]),
  scene: new Set([
    '内射', '脚交', '颜射', '浴室', '放尿', '沙滩', '背后位', '公众场合', '精神崩溃',
  ]),
};

function htmlDecode(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&#x27;/g, "'");
}

function stripHtml(text) {
  return htmlDecode(text)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function attr(block, name) {
  const m = block.match(new RegExp(`${name}="([^"]*)"`, 'i'));
  return m ? htmlDecode(m[1]) : '';
}

function firstMatch(text, regex) {
  const m = text.match(regex);
  return m ? htmlDecode(m[1]).trim() : '';
}

function normalizeTitle(text) {
  return stripHtml(text).replace(/\s+/g, ' ').trim();
}

function normalizeTag(tag) {
  let value = stripHtml(tag)
    .replace(/\(\d+\)$/g, '')
    .replace(/（\d+）$/g, '')
    .trim();
  value = TRAD_TO_SIMPLE.get(value) || value;
  return value;
}

function categorizeTags(rawTags) {
  const out = { theme: [], attribute: [], scene: [], dropped: [], unknown: [] };
  const seen = new Set();

  for (const raw of rawTags) {
    const tag = normalizeTag(raw);
    if (!tag || seen.has(tag)) continue;
    seen.add(tag);

    if (DROP_TAGS.has(tag)) {
      out.dropped.push(tag);
      continue;
    }

    let placed = false;
    for (const key of ['theme', 'attribute', 'scene']) {
      if (TAG_CATEGORY[key].has(tag)) {
        out[key].push(tag);
        placed = true;
        break;
      }
    }
    if (!placed) out.unknown.push(tag);
  }

  return out;
}

function parseSearch(html, fileName) {
  const candidates = [];
  const cardRe = /<a\b[^>]*href="(https:\/\/hanime1\.me\/watch\?v=\d+)"[^>]*>\s*<div class="home-rows-videos-div search-videos hover-lighter">([\s\S]*?)<\/a>/gi;
  let m;

  while ((m = cardRe.exec(html))) {
    const block = m[2];
    const title = normalizeTitle(firstMatch(block, /<div class="home-rows-videos-title">([\s\S]*?)<\/div>/i));
    const image = firstMatch(block, /<img\b[^>]*src="([^"]+)"/i);
    if (!title || !m[1].includes('hanime1.me/watch')) continue;
    candidates.push({
      source: 'hanime1',
      url: m[1],
      title,
      image,
      inferred_episode: inferEpisodeNumber(title),
    });
  }

  return {
    file: fileName,
    type: 'search',
    query_title: firstMatch(html, /<input id="query"[\s\S]*?value="([^"]*)"/i) || firstMatch(html, /<meta name="title" content="([^"]*)"/i),
    candidates,
  };
}

function inferEpisodeNumber(title) {
  const normalized = normalizeTitle(title);
  const hash = normalized.match(/[＃#]\s*(\d+)/);
  if (hash) return Number(hash[1]);
  const tail = normalized.match(/(?:^|\s)(\d{1,2})$/);
  if (tail) return Number(tail[1]);
  const jp = normalized.match(/第\s*(\d{1,2})\s*[話话集]/);
  if (jp) return Number(jp[1]);
  return null;
}

function removeNoisyTitleSuffix(title) {
  return normalizeTitle(title)
    .replace(/\s*[-－]\s*Hanime1\.me$/i, '')
    .replace(/\s*\[[^\]]*(中文字幕|字幕|繁體中文|繁体中文|英文)[^\]]*\]\s*$/i, '')
    .trim();
}

function deriveSubtitle(fullTitle, seriesTitle) {
  let rest = removeNoisyTitleSuffix(fullTitle);
  const series = normalizeTitle(seriesTitle);
  if (series && rest.startsWith(series)) {
    rest = rest.slice(series.length).trim();
  }
  rest = rest.replace(/^(上巻|下巻|中巻|前編|後編|第\s*\d+\s*[話话集]|[＃#]\s*\d+)\s*/u, '').trim();
  return rest;
}

function parseTags(html) {
  const tags = [];
  const tagRe = /<div class="single-video-tag"[\s\S]*?<a\b[^>]*href="\/search\?tags[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;
  let m;
  while ((m = tagRe.exec(html))) {
    const tag = normalizeTag(m[1]);
    if (tag) tags.push(tag);
  }
  return tags;
}

function parsePlaylist(html) {
  const items = [];
  const itemRe = /<div class="playlist-hover-wrap clickable-row[^"]*"[^>]*data-href="(https:\/\/hanime1\.me\/watch\?v=\d+)"([\s\S]*?)(?=<div class="playlist-hover-wrap clickable-row|<a id="playlist-footer"|<\/div>\s*<a id="playlist-footer")/gi;
  let m;

  while ((m = itemRe.exec(html))) {
    const block = m[2];
    const title = normalizeTitle(firstMatch(block, /<h4 class="video-title">[\s\S]*?<a\b[^>]*>([\s\S]*?)<\/a>/i));
    if (!title) continue;
    const image = firstMatch(block, /<img class="main-thumb"[^>]*src="([^"]+)"/i);
    const duration = normalizeTitle(firstMatch(block, /<div class="duration">([\s\S]*?)<\/div>/i));
    const key = `${m[1]}|${title}`;
    if (items.some((item) => `${item.url}|${item.title}` === key)) continue;
    items.push({
      url: m[1],
      title,
      image,
      duration,
      inferred_episode: inferEpisodeNumber(title),
    });
  }

  return items;
}

function parseDetail(html, fileName) {
  const canonical = firstMatch(html, /<link rel="canonical" href="([^"]+)"/i);
  const fullTitle = firstMatch(html, /<h3 id="shareBtn-title"[^>]*>([\s\S]*?)<\/h3>/i)
    || firstMatch(html, /<meta property="og:title" content="([^"]+)"/i)
    || firstMatch(html, /<title>([\s\S]*?)<\/title>/i);
  const seriesTitle = normalizeTitle(firstMatch(html, /<a href="https:\/\/hanime1\.me\/playlist\?list=[^"]*"[^>]*>\s*([\s\S]*?)\s*<\/a>/i));
  const dateFull = firstMatch(html, /观看次数：[\s\S]*?(\d{4}-\d{2}-\d{2})/i);
  const rawTags = parseTags(html);
  const cleanedTags = categorizeTags(rawTags);

  return {
    file: fileName,
    type: 'detail',
    source: {
      hanime1: canonical,
    },
    title: seriesTitle || removeNoisyTitleSuffix(fullTitle),
    full_title: removeNoisyTitleSuffix(fullTitle),
    subtitle: deriveSubtitle(fullTitle, seriesTitle),
    release_date_full: dateFull,
    release_date: dateFull ? dateFull.slice(0, 7) : '',
    studio: normalizeTitle(firstMatch(html, /<a id="video-artist-name"[^>]*>([\s\S]*?)<\/a>/i)),
    cover_url: firstMatch(html, /<meta property="og:image" content="([^"]+)"/i)
      || firstMatch(html, /<video[^>]*poster="([^"]+)"/i),
    duration_seconds: Number(firstMatch(html, /<meta property="og:video:duration" content="([^"]+)"/i)) || null,
    caption: normalizeTitle(firstMatch(html, /<div class="video-caption-text[^"]*"[^>]*>([\s\S]*?)<\/div>/i)),
    raw_tags: rawTags,
    tags: {
      theme: cleanedTags.theme,
      attribute: cleanedTags.attribute,
      scene: cleanedTags.scene,
    },
    dropped_tags: cleanedTags.dropped,
    unknown_tags: cleanedTags.unknown,
    playlist: parsePlaylist(html),
  };
}

function detectType(html, fileName) {
  if (/home-rows-videos-div search-videos/.test(html) || /\/search\?/.test(fileName)) return 'search';
  if (/#shareBtn-title|video-tags-wrapper|hanime1\.me\/watch\?v=/.test(html) || /watch_v=/.test(fileName)) return 'detail';
  return 'unknown';
}

function readInputFiles(root) {
  return fs.readdirSync(root)
    .filter((name) => /\.(html?|txt)$/i.test(name))
    .map((name) => path.join(root, name));
}

function main() {
  if (!fs.existsSync(ROOT) || !fs.statSync(ROOT).isDirectory()) {
    throw new Error(`目录不存在: ${ROOT}`);
  }

  const files = readInputFiles(ROOT);
  const pages = files.map((file) => {
    const html = fs.readFileSync(file, 'utf8');
    const type = detectType(html, path.basename(file));
    if (type === 'search') return parseSearch(html, path.basename(file));
    if (type === 'detail') return parseDetail(html, path.basename(file));
    return { file: path.basename(file), type: 'unknown' };
  });

  const details = pages.filter((page) => page.type === 'detail');
  const searches = pages.filter((page) => page.type === 'search');
  const firstDetail = details[0];
  const draft = firstDetail ? {
    title: firstDetail.title,
    studio: firstDetail.studio,
    source: firstDetail.source,
    episode_list: details.map((detail, index) => ({
      id: detail.playlist.find((item) => item.url === detail.source.hanime1)?.inferred_episode || detail.playlist.find((item) => item.url === detail.source.hanime1)?.inferred_episode || index + 1,
      subtitle: detail.subtitle,
      release_date: detail.release_date,
      cover_url: detail.cover_url,
      tags: detail.tags,
      unknown_tags: detail.unknown_tags,
      dropped_tags: detail.dropped_tags,
    })).sort((a, b) => a.id - b.id),
  } : null;

  const result = {
    generated_at: new Date().toISOString(),
    root: ROOT,
    pages,
    summary: {
      search_pages: searches.length,
      detail_pages: details.length,
      candidates: searches.reduce((sum, page) => sum + page.candidates.length, 0),
      detail_playlist_items: details.reduce((sum, page) => sum + page.playlist.length, 0),
    },
    draft,
  };

  fs.writeFileSync(OUTPUT, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
  console.log(`解析完成: ${OUTPUT}`);
  console.log(`搜索页: ${result.summary.search_pages}, 详情页: ${result.summary.detail_pages}, 候选: ${result.summary.candidates}`);
  if (draft) {
    console.log(`草稿: ${draft.title} / ${draft.studio} / ${draft.episode_list.length} 集详情`);
  }
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
