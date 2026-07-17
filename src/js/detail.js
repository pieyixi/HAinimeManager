// ─── Render Grid ────────────────────────

function renderGrid(items, total, totalPages) {
  var grid = document.getElementById('coverGrid');
  var count = document.getElementById('resultCount');
  count.textContent = (total != null ? total : items.length) + ' 个作品';
  if (!items.length) {
    grid.innerHTML = '<div class="empty-state"><h2>暂无作品</h2><p>在设置中扫描目录导入作品</p></div>';
    renderPagination(0, 1);
    return;
  }
  grid.innerHTML = items.map(function(w){
    var cUrl = coverUrl(w.cover_path);
    var imgHtml = cUrl ? '<img src="' + cUrl + '" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0" onerror="this.style.display=\'none\'">' : '';
    var date = w.year + '-' + String(w.month).padStart(2,'0');
    var meta = [w.studio || '未知制作商', date, (w.episode_count || 0) + '集'].join(' / ');
    return '<div class="cover-card" onclick="showDetail(' + w.id + ')" oncontextmenu="showWorkContextMenu(event,' + w.id + ')"><div class="cover-img">' +
      imgHtml +
      '<span style="font-size:36px;color:#bbb;">&#127916;</span>' +
      '<div class="cover-hover"><div class="ch-title">' + escHtml(w.title) + '</div><div class="ch-meta">' + escHtml(meta) + '</div></div></div>' +
      '<div class="cover-title">' + escHtml(w.title) + '</div></div>';
  }).join('');
  renderPagination(total || items.length, totalPages || 1);
}

function renderPagination(total, totalPages) {
  var pag = document.getElementById('pagination');
  if (!pag) return;
  var h = '<span class="page-btn" onclick="goPage(' + (state.currentPage-1) + ')" style="' + (state.currentPage<=1?'opacity:0.3;pointer-events:none':'') + '">&#8249;</span>';
  for (var i = 1; i <= totalPages; i++) {
    if (i === state.currentPage) h += '<span class="page-num active">' + i + '</span>';
    else if (i === 1 || i === totalPages || Math.abs(i - state.currentPage) <= 2) h += '<span class="page-num" onclick="goPage(' + i + ')">' + i + '</span>';
    else if (h.indexOf('...') < 0) h += '<span class="page-dot">...</span>';
  }
  h += '<span class="page-btn" onclick="goPage(' + (state.currentPage+1) + ')" style="' + (state.currentPage>=totalPages?'opacity:0.3;pointer-events:none':'') + '">&#8250;</span>';
  h += '<input type="number" id="pageJump" value="' + state.currentPage + '" min="1" max="' + totalPages + '" onkeydown="if(event.key===\'Enter\')jumpToPage()" style="width:48px;height:28px;border:1px solid #d1d1d6;border-radius:5px;font-size:12px;text-align:center;margin:0 4px">';
  h += '<span style="font-size:12px;color:#999">共 ' + total + ' 部</span>';
  pag.innerHTML = h;
}

function goPage(p) { state.currentPage = p; applyFilter(); }
function jumpToPage() {
  var inp = document.getElementById('pageJump');
  if (!inp) return;
  var p = parseInt(inp.value);
  if (p >= 1) goPage(p);
}

// ─── Detail View ────────────────────────

var currentDetailWorkId = null;

async function showDetail(id) {
  try {
    var detail = await invoke('get_work_detail', { workId: id });
    if (!detail || !detail.work) return;
    currentDetailWorkId = id;
    state.currentDetail = detail;
    var w = detail.work;
    var episodes = detail.episodes || [];
    var tags = detail.tags || [];

    document.getElementById('detailTitle').textContent = w.title;
    document.getElementById('detailDesc').textContent = w.description || '（暂无简介）';

    var coverPaths = [];
    if (w.cover_path) coverPaths.push(w.cover_path);
    episodes.forEach(function(e){ if (e.cover_path) coverPaths.push(e.cover_path); });
    await loadCovers(coverPaths);

    var dc = document.getElementById('detailCover');
    var wCover = coverUrl(w.cover_path);
    if (wCover) {
      dc.innerHTML = '<img src="' + wCover + '" style="width:100%;height:100%;object-fit:cover" onerror="this.style.display=\'none\';this.parentNode.innerHTML=\'&#127916\'">';
    } else {
      dc.innerHTML = '&#127916;';
    }

    var chars = (detail.characters || []).map(function(name){ return { name: name }; });
    if (!chars.length) chars = tags.filter(function(t){ return t.category === '人物'; });
    var storyTags = tags.filter(function(t){ return t.category === '剧情'; });
    var attrTags = tags.filter(function(t){ return t.category === '属性'; });
    var sceneTags = tags.filter(function(t){ return t.category === '场景'; });

    var releaseDates = episodes.map(function(e){
      return e.release_date || (w.year + '-' + String(w.month).padStart(2,'0'));
    });
    var tagHtml = '<div class="detail-tag-row"><span class="detail-section-title">年份</span>';
    releaseDates.forEach(function(date){
      tagHtml += '<span class="detail-tag">' + escHtml(date) + '</span>';
    });
    tagHtml += '</div>';
    if (chars.length > 0) tagHtml += renderDetailTagRow('角色', chars, null, false);
    if (w.studio) tagHtml += renderDetailTagRow('制作商', [{ name: w.studio }], 'studio', true);
    if (storyTags.length > 0) tagHtml += renderDetailTagRow('剧情', storyTags, 'story', true);
    if (attrTags.length > 0) tagHtml += renderDetailTagRow('属性', attrTags, 'attr', true);
    if (sceneTags.length > 0) tagHtml += renderDetailTagRow('场景', sceneTags, 'scene', true);
    document.getElementById('detailTags').innerHTML = tagHtml;

    document.getElementById('episodeList').innerHTML = episodes.map(function(e, index){
      var eCover = coverUrl(e.cover_path);
      var eImgHtml = eCover ? '<img src="' + eCover + '" style="width:100%;height:100%;object-fit:cover;position:absolute;top:0;left:0" onerror="this.style.display=\'none\'">' : '';
      var episodeNumber = Number(e.number) || (index + 1);
      var episodeLabel = String(episodeNumber).padStart(2, '0');
      return '<div class="episode-item" onclick="openPlayer(' + e.id + ')"><div class="episode-cover">' +
        eImgHtml + '&#127916;</div>' +
        '<div class="episode-info"><div class="episode-num">第 ' + episodeLabel + ' 集</div><div class="episode-sub">' + escHtml(e.title) + '</div></div>' +
        '<div class="episode-play">&#9654; 播放</div></div>';
    }).join('');

    document.getElementById('btnOpenFolder').onclick = function(){ openWorkFolder(w.folder_path); };
    showPage('page-detail');
  } catch(e) {
    console.error('showDetail failed:', e);
  }
}

function escAttr(s) {
  return String(s).replace(/&/g,'&amp;').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/</g,'&lt;').replace(/"/g,'&quot;');
}

function formatTime(seconds) {
  seconds = Math.max(0, Number(seconds) || 0);
  var h = Math.floor(seconds / 3600);
  var m = Math.floor((seconds % 3600) / 60);
  var s = Math.floor(seconds % 60);
  if (h > 0) return h + ':' + String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
  return String(m).padStart(2,'0') + ':' + String(s).padStart(2,'0');
}

function playerMessage(kind, text) {
  var msg = document.getElementById('playerMsg');
  if (!msg) return;
  msg.className = 'player-msg ' + (kind || '');
  msg.textContent = text || '';
}

