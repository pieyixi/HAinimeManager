// ==UserScript==
// @name         hanime1 建档信息队列
// @namespace    local.hanime-manager
// @version      0.1.8
// @description  从 hanime1 详情页提取建档有用行，并按集数加入队列一键复制。
// @match        *://hanime1.me/*
// @match        *://www.hanime1.me/*
// @grant        GM_setClipboard
// @noframes
// @run-at       document-end
// ==/UserScript==

(function () {
  'use strict';

  if (!/^(www\.)?hanime1\.me$/i.test(location.hostname)) return;

  const STORAGE_KEY = 'hanime1_archive_line_queue_v1';

  function cnEpisodeNumber(num) {
    const digits = ['', '一', '二', '三', '四', '五', '六', '七', '八', '九'];
    if (num <= 10) return num === 10 ? '十' : digits[num];
    if (num < 20) return `十${digits[num - 10]}`;
    const tens = Math.floor(num / 10);
    const ones = num % 10;
    return `${digits[tens]}十${digits[ones] || ''}`;
  }

  function cleanLine(html) {
    return String(html || '')
      .replace(/\s+/g, ' ')
      .replace(/>\s+</g, '><')
      .trim();
  }

  function findDateNode() {
    const isDateText = (text) => /观看次数：|觀看次數：/.test(text || '') && /\d{4}-\d{2}-\d{2}/.test(text || '');
    const wrappers = Array.from(document.querySelectorAll('.video-details-wrapper'));

    const exactWrapper = wrappers.find((node) => {
      const ownText = Array.from(node.childNodes)
        .filter((child) => child.nodeType === Node.TEXT_NODE)
        .map((child) => child.textContent)
        .join(' ')
        .trim();
      return node.children.length === 0 && isDateText(ownText);
    });
    if (exactWrapper) return exactWrapper;

    const compactWrapper = wrappers.find((node) => {
      const text = (node.textContent || '').replace(/\s+/g, ' ').trim();
      return node.children.length <= 1 && text.length < 80 && isDateText(text);
    });
    if (compactWrapper) return compactWrapper;

    return null;
  }

  function getCurrentLines() {
    const lines = [];
    const title = document.querySelector('#shareBtn-title');
    const date = findDateNode();
    const artist = document.querySelector('#video-artist-name');
    const keywords = document.querySelector('meta[name="keywords"]');

    if (title) lines.push(cleanLine(title.outerHTML));
    if (date) lines.push(cleanLine(date.outerHTML));
    if (artist) lines.push(cleanLine(artist.outerHTML));
    if (keywords) lines.push(cleanLine(keywords.outerHTML));

    return lines;
  }

  function loadQueue() {
    try {
      const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
      return Array.isArray(value) ? value : [];
    } catch (_) {
      return [];
    }
  }

  function saveQueue(items) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
  }

  function queueText(items) {
    return items.join('\n\n');
  }

  function copyText(text) {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(text, 'text');
      return Promise.resolve();
    }
    return navigator.clipboard.writeText(text);
  }

  function makePanel() {
    if (document.getElementById('hm-queue-panel')) {
      return document.getElementById('hm-queue-panel');
    }

    const style = document.createElement('style');
    style.textContent = `
      #hm-queue-panel {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 390px;
        max-width: calc(100vw - 36px);
        z-index: 2147483647 !important;
        background: #ffffff;
        color: #111827;
        border: 1px solid #d9e0ea;
        border-radius: 10px;
        box-shadow: 0 16px 40px rgba(0,0,0,.24);
        font-family: "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
        font-size: 13px;
        overflow: hidden;
        display: none;
      }
      #hm-queue-toggle {
        position: fixed;
        right: 18px;
        bottom: 18px;
        width: 54px;
        height: 38px;
        z-index: 2147483647 !important;
        border: 1px solid #2563eb;
        border-radius: 9px;
        background: #2563eb;
        color: #fff;
        font: 13px "Microsoft YaHei", "Segoe UI", Arial, sans-serif;
        cursor: pointer;
        box-shadow: 0 12px 30px rgba(0,0,0,.24);
        display: block;
      }
      #hm-queue-panel * { box-sizing: border-box; }
      #hm-queue-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        padding: 10px 12px;
        border-bottom: 1px solid #d9e0ea;
        font-weight: 700;
      }
      #hm-queue-close {
        width: 26px;
        height: 26px;
        border: 1px solid #d9e0ea;
        border-radius: 7px;
        background: #fff;
        color: #111827;
        cursor: pointer;
      }
      #hm-queue-body {
        padding: 12px;
        display: grid;
        gap: 8px;
      }
      #hm-current-lines,
      #hm-queue-lines {
        width: 100%;
        min-height: 112px;
        max-height: 210px;
        resize: vertical;
        border: 1px solid #d9e0ea;
        border-radius: 8px;
        padding: 8px;
        font: 12px/1.45 Consolas, "Cascadia Mono", monospace;
        color: #0f172a;
        background: #f8fafc;
      }
      #hm-queue-lines { min-height: 170px; }
      #hm-queue-lines {
        background: #e5e7eb;
        color: #4b5563;
        cursor: default;
      }
      .hm-label {
        display: flex;
        justify-content: space-between;
        color: #6b7280;
        font-size: 12px;
      }
      .hm-actions {
        display: flex;
        gap: 8px;
        flex-wrap: wrap;
      }
      .hm-btn {
        height: 32px;
        border-radius: 8px;
        border: 1px solid #d9e0ea;
        background: #fff;
        color: #111827;
        padding: 0 10px;
        cursor: pointer;
      }
      .hm-btn:hover { border-color: #b9c6d8; }
      .hm-primary {
        border-color: #2563eb;
        background: #2563eb;
        color: #fff;
      }
      .hm-primary:hover {
        border-color: #1d4ed8;
        background: #1d4ed8;
      }
      #hm-msg {
        min-height: 18px;
        color: #2563eb;
        font-size: 12px;
      }
    `;
    document.documentElement.appendChild(style);

    const toggle = document.createElement('button');
    toggle.id = 'hm-queue-toggle';
    toggle.textContent = '建档';

    const panel = document.createElement('div');
    panel.id = 'hm-queue-panel';
    panel.innerHTML = `
      <div id="hm-queue-head">
        <span>建档信息队列</span>
        <button id="hm-queue-close" title="隐藏">×</button>
      </div>
      <div id="hm-queue-body">
        <div class="hm-label"><span>当前页提取</span><span id="hm-current-count">0 行</span></div>
        <textarea id="hm-current-lines" spellcheck="false"></textarea>
        <div class="hm-actions">
          <button class="hm-btn" id="hm-refresh">重新提取</button>
          <button class="hm-btn" id="hm-clear-current">清除文本</button>
          <button class="hm-btn hm-primary" id="hm-add">加入队列</button>
        </div>
        <div class="hm-label"><span>集数队列</span><span id="hm-queue-count">0 话</span></div>
        <textarea id="hm-queue-lines" spellcheck="false" readonly></textarea>
        <div class="hm-actions">
          <button class="hm-btn hm-primary" id="hm-copy">一键复制队列</button>
          <button class="hm-btn" id="hm-clear">清空队列</button>
        </div>
        <div id="hm-msg"></div>
      </div>
    `;
    const mount = document.body || document.documentElement;
    mount.appendChild(toggle);
    mount.appendChild(panel);

    toggle.addEventListener('click', () => {
      panel.style.display = 'block';
      toggle.style.display = 'none';
    });

    return panel;
  }

  function init() {
    const panel = makePanel();
    const currentEl = panel.querySelector('#hm-current-lines');
    const queueEl = panel.querySelector('#hm-queue-lines');
    const currentCountEl = panel.querySelector('#hm-current-count');
    const queueCountEl = panel.querySelector('#hm-queue-count');
    const msgEl = panel.querySelector('#hm-msg');
    let queue = loadQueue();

    function showMessage(text) {
      msgEl.textContent = text;
      window.setTimeout(() => {
        if (msgEl.textContent === text) msgEl.textContent = '';
      }, 1600);
    }

    function refreshCurrent() {
      const lines = getCurrentLines();
      currentEl.value = lines.join('\n');
      currentCountEl.textContent = `${lines.length} 行`;
      if (!lines.length) showMessage('没有提取到信息，确认当前是详情页');
    }

    function refreshQueue() {
      queueEl.value = queueText(queue);
      const episodeCount = queue.filter((item) => /^第.+话：/.test(item)).length;
      queueCountEl.textContent = `${episodeCount} 话 / ${queue.length} 条`;
    }

    function classifyCurrentText(text) {
      const value = text.trim();
      if (!value) return { ok: false, kind: 'empty', message: '当前页没有内容' };

      if (/^角色：/.test(value)) {
        if (!value.replace(/^角色：/, '').trim()) return { ok: false, kind: 'characters', message: '角色内容不能为空' };
        return { ok: true, kind: 'characters' };
      }

      if (/^简介：/.test(value)) {
        if (!value.replace(/^简介：/, '').trim()) return { ok: false, kind: 'synopsis', message: '简介内容不能为空' };
        return { ok: true, kind: 'synopsis' };
      }

      const lines = value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
      const allowedLine = (line) => {
        return /<h3\b[^>]*id="shareBtn-title"[\s\S]*<\/h3>$/i.test(line)
          || /<div\b[^>]*class="[^"]*video-details-wrapper[^"]*"[\s\S]*(观看次数：|觀看次數：)[\s\S]*\d{4}-\d{2}-\d{2}[\s\S]*<\/div>$/i.test(line)
          || /<a\b[^>]*id="video-artist-name"[\s\S]*<\/a>$/i.test(line)
          || /<meta\b[^>]*name="keywords"[\s\S]*>$/i.test(line);
      };
      const hasTitle = lines.some((line) => /id="shareBtn-title"/i.test(line));
      const hasDate = lines.some((line) => /(观看次数：|觀看次數：)[\s\S]*\d{4}-\d{2}-\d{2}/.test(line));
      const hasStudio = lines.some((line) => /id="video-artist-name"/i.test(line));
      const hasTags = lines.some((line) => /name="keywords"/i.test(line));

      if (lines.length && lines.every(allowedLine) && hasTitle && hasDate && hasStudio && hasTags) {
        return { ok: true, kind: 'episode' };
      }

      return {
        ok: false,
        kind: 'invalid',
        message: '只能加入正常提取的标题/日期/制作商/tag，或以 角色： / 简介： 开头的内容',
      };
    }

    function formatCharacters(text) {
      const body = text.replace(/^角色：/, '').trim();
      const quoted = Array.from(body.matchAll(/\d+\s*:\s*["“]([^"”]+)["”]/g)).map((match) => match[1].trim());
      const names = quoted.length ? quoted : body
        .split(/[\r\n,，、;；]+/)
        .map((name) => name.trim().replace(/^["“]|["”]$/g, ''))
        .filter(Boolean);
      return `角色：${names.map((name, index) => `${index + 1}:"${name}"`).join(',')}`;
    }

    function formatSynopsis(text) {
      const body = text
        .replace(/^简介：/, '')
        .trim()
        .replace(/^["“]|["”]$/g, '')
        .trim();
      return `简介：“${body}”`;
    }

    function formatQueueItem(text, kind) {
      if (kind === 'characters') return formatCharacters(text);
      if (kind === 'synopsis') return formatSynopsis(text);
      return text;
    }

    panel.querySelector('#hm-refresh').addEventListener('click', refreshCurrent);

    panel.querySelector('#hm-clear-current').addEventListener('click', () => {
      currentEl.value = '';
      currentCountEl.textContent = '0 行';
      showMessage('当前文本已清除');
    });

    panel.querySelector('#hm-add').addEventListener('click', () => {
      const text = currentEl.value.trim();
      const result = classifyCurrentText(text);
      if (!result.ok) {
        showMessage(result.message);
        return;
      }
      if (result.kind === 'episode') {
        const episodeCount = queue.filter((item) => /^第.+话：/.test(item)).length;
        const label = `第${cnEpisodeNumber(episodeCount + 1)}话：`;
        queue.push(`${label}\n${text}`);
      } else {
        queue.push(formatQueueItem(text, result.kind));
      }
      saveQueue(queue);
      refreshQueue();
      currentEl.value = '';
      currentCountEl.textContent = '0 行';
      showMessage('已加入队列');
    });

    panel.querySelector('#hm-copy').addEventListener('click', async () => {
      const text = queueEl.value.trim();
      if (!text) {
        showMessage('队列为空');
        return;
      }
      await copyText(text);
      showMessage('队列已复制');
    });

    panel.querySelector('#hm-clear').addEventListener('click', () => {
      queue = [];
      saveQueue(queue);
      refreshQueue();
      showMessage('队列已清空');
    });

    panel.querySelector('#hm-queue-close').addEventListener('click', () => {
      panel.style.display = 'none';
      const toggle = document.getElementById('hm-queue-toggle');
      if (toggle) toggle.style.display = 'block';
    });

    refreshCurrent();
    refreshQueue();
  }

  function boot(retry) {
    if (document.getElementById('hm-queue-panel')) return;
    if (document.body || retry <= 0) {
      init();
      return;
    }
    window.setTimeout(() => boot(retry - 1), 300);
  }

  window.addEventListener('keydown', (event) => {
    if (!event.altKey || event.key.toLowerCase() !== 'h') return;
    const panel = document.getElementById('hm-queue-panel');
    const toggle = document.getElementById('hm-queue-toggle');
    if (!panel) {
      boot(1);
      return;
    }
    const hidden = panel.style.display === 'none';
    panel.style.display = hidden ? 'block' : 'none';
    if (toggle) toggle.style.display = hidden ? 'none' : 'block';
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => boot(20));
  } else {
    boot(20);
  }
})();
