// ─── Filter Dropdowns ───────────────────

function getFilterOptions(key) {
  if (key === 'year') {
    return state.years.map(function(y){ return { val: String(y), label: y + '年' }; });
  }
  if (key === 'studio') {
    return state.studios.map(function(s){ return { val: s, label: s }; });
  }
  if (key === 'story' || key === 'attr' || key === 'scene') {
    var cat = CAT_MAP[key];
    var names = [];
    var seen = {};
    state.tags.forEach(function(t){
      if (t.category === cat && !seen[t.name]) { seen[t.name] = true; names.push(t.name); }
    });
    names.sort(function(a,b){ return a.localeCompare(b); });
    return names.map(function(n){ return { val: n, label: n }; });
  }
  return [];
}

function openDropdown(key, btn) {
  var existing = document.getElementById('filterDropdown');
  if (existing && existing.getAttribute('data-key') === key) { existing.remove(); return; }
  closeDropdown();

  var dd = document.createElement('div');
  dd.id = 'filterDropdown';
  dd.className = 'filter-dd';
  dd.setAttribute('data-key', key);
  // Re-rendering a month button detaches the click target before it reaches document.
  // Keep every click in the menu from being mistaken for an outside click.
  dd.addEventListener('click', function(e){ e.stopPropagation(); });

  var isVertical = key === 'studio';
  dd.style.width = isVertical ? '180px' : 'min(480px, calc(100vw - 20px))';

  var btnRect = btn.getBoundingClientRect();
  dd.style.left = Math.round(btnRect.left + btnRect.width/2) + 'px';
  dd.style.transform = 'translateX(-50%)';
  dd.style.top = (btnRect.bottom + 2) + 'px';

  if (key === 'year') {
    renderYearDropdown(dd);
    document.body.appendChild(dd);
    placeDropdown(dd);
    return;
  }

  var options = getFilterOptions(key);
  var catLabel = { year:'年份', story:'剧情', attr:'属性', scene:'场景', studio:'制作商' }[key] || key;

  var html = '<div class="dd-header">' + catLabel + '</div>';
  html += '<div class="dd-body ' + (isVertical ? 'col' : 'row') + '">';
  options.forEach(function(o){
    var sel = state.activeFilters[key] && state.activeFilters[key][o.val];
    html += '<span class="dd-tag' + (sel ? ' selected' : '') + '" data-val="' + escHtml(o.val) + '" onclick="toggleFilter(\'' + key + '\',this)">' + o.label + '</span>';
  });
  html += '</div>';
  html += '<div class="dd-actions"><span onclick="clearFilter(\'' + key + '\')">清除</span><span class="primary" onclick="closeDropdown()">确定</span></div>';
  dd.innerHTML = html;
  document.body.appendChild(dd);
  placeDropdown(dd);
}

function placeDropdown(dd) {
  setTimeout(function(){
    if (!dd.parentNode) return;
    var dr = dd.getBoundingClientRect();
    if (dr.left < 4) { dd.style.transform = 'none'; dd.style.left = '4px'; }
    if (dr.right > window.innerWidth - 4) { dd.style.transform = 'none'; dd.style.left = 'auto'; dd.style.right = '4px'; }
  }, 0);
}

function renderYearDropdown(dd) {
  dd.classList.add('year-dd');
  var years = state.years.slice().sort(function(a,b){ return b - a; });
  var selectedYear = dd.getAttribute('data-year') || String(years[0] || new Date().getFullYear());
  dd.setAttribute('data-year', selectedYear);
  var html = '<div class="year-list">';
  years.forEach(function(y){
    var yearSelected = state.activeFilters.year && state.activeFilters.year[String(y)];
    var classes = 'year-option' + (String(y) === selectedYear ? ' active' : '') + (yearSelected ? ' selected' : '');
    html += '<button class="' + classes + '" onclick="toggleWholeYear(' + y + ')">' + y + '年</button>';
  });
  html += '</div><div class="month-panel"><div class="dd-header">' + selectedYear + '年</div>';
  html += '<div class="month-grid">';
  for (var m = 1; m <= 12; m++) {
    var val = selectedYear + '-' + String(m).padStart(2, '0');
    var sel = state.activeFilters.year && state.activeFilters.year[val];
    html += '<button class="month-cell' + (sel ? ' selected' : '') + '" onclick="toggleYearMonth(\'' + val + '\')">' + m + '月</button>';
  }
  html += '</div><div class="dd-actions"><span onclick="clearFilter(\'year\')">清除</span><span onclick="selectYearInDropdown(' + selectedYear + ')">只看月份</span><span class="primary" onclick="closeDropdown()">确定</span></div></div>';
  dd.innerHTML = html;
}

function selectYearInDropdown(year) {
  var dd = document.getElementById('filterDropdown');
  if (!dd) return;
  dd.setAttribute('data-year', String(year));
  renderYearDropdown(dd);
}

function toggleYearMonth(value) {
  if (!state.activeFilters.year) state.activeFilters.year = {};
  var yearKey = String(value).slice(0, 4);
  delete state.activeFilters.year[yearKey];
  if (state.activeFilters.year[value]) delete state.activeFilters.year[value];
  else state.activeFilters.year[value] = true;
  state.currentPage = 1;
  var dd = document.getElementById('filterDropdown');
  if (dd) renderYearDropdown(dd);
  applyFilter();
}

function toggleWholeYear(year) {
  if (!state.activeFilters.year) state.activeFilters.year = {};
  var key = String(year);
  if (state.activeFilters.year[key]) {
    delete state.activeFilters.year[key];
  } else {
    state.activeFilters.year[key] = true;
  }
  state.currentPage = 1;
  var dd = document.getElementById('filterDropdown');
  if (dd) dd.setAttribute('data-year', key);
  if (dd) renderYearDropdown(dd);
  applyFilter();
}

function closeDropdown() {
  var dd = document.getElementById('filterDropdown');
  if (dd) { dd.remove(); }
}

function toggleFilter(key, el) {
  el.classList.toggle('selected');
  var val = el.getAttribute('data-val');
  if (!state.activeFilters[key]) state.activeFilters[key] = {};
  if (el.classList.contains('selected')) {
    state.activeFilters[key][val] = true;
    el.style.borderColor = '#005fb8'; el.style.background = '#005fb8'; el.style.color = '#fff';
  } else {
    delete state.activeFilters[key][val];
    el.style.borderColor = '#d1d1d6'; el.style.background = '#fff'; el.style.color = '#444';
  }
  applyFilter();
}

function clearFilter(key) {
  delete state.activeFilters[key];
  closeDropdown();
  state.currentPage = 1;
  applyFilter();
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// ─── Sort ──────────────────────────────

function setSort(sortKey) {
  state.currentSort = sortKey;
  state.currentPage = 1;
  document.getElementById('sortTimeBtn').innerHTML = '时间 ' + (sortKey === 'time-desc' ? '&#11015;' : '&#11014;');
  document.getElementById('sortNameBtn').innerHTML = '名称 ' + ((sortKey === 'name-asc' || sortKey === 'name-desc') ? (sortKey === 'name-asc' ? '&#11014;' : '&#11015;') : '&#11014;');
  applyFilter();
}

// ─── Apply Filter + Sort + Paginate ────

function applyFilter() {
  updatePageSize(true);
  var results = state.works.slice();
  var searchInput = document.getElementById('searchInput');
  var clearBtn = document.getElementById('searchClear');

  for (var key in state.activeFilters) {
    var vals = Object.keys(state.activeFilters[key]);
    if (!vals.length) continue;
    results = results.filter(function(w){
      if (key === 'year') {
        var monthValue = w.year + '-' + String(w.month).padStart(2, '0');
        return vals.some(function(v){ return String(w.year) === v || monthValue === v; });
      }
      if (key === 'studio') return vals.indexOf(w.studio) >= 0;
      var cat = CAT_MAP[key];
      if (!cat) return true;
      return (w.tags || []).some(function(t){ return t.category === cat && vals.indexOf(t.name) >= 0; });
    });
  }

  var kw = (searchInput?.value || '').trim().toLowerCase();
  if (clearBtn) clearBtn.classList.toggle('visible', !!kw);
  if (kw) {
    results = results.filter(function(w){
      if (w.title.toLowerCase().indexOf(kw) >= 0) return true;
      if ((w.description || '').toLowerCase().indexOf(kw) >= 0) return true;
      if (w.studio.toLowerCase().indexOf(kw) >= 0) return true;
      if ((w.tags || []).some(function(t){ return t.name.toLowerCase().indexOf(kw) >= 0; })) return true;
      return false;
    });
  }

  if (state.currentSort === 'time-desc') {
    results.sort(function(a,b){ return b.year - a.year || b.month - a.month; });
  } else if (state.currentSort === 'time-asc') {
    results.sort(function(a,b){ return a.year - b.year || a.month - b.month; });
  } else if (state.currentSort === 'name-asc') {
    results.sort(function(a,b){ return a.title.localeCompare(b.title); });
  } else if (state.currentSort === 'name-desc') {
    results.sort(function(a,b){ return b.title.localeCompare(a.title); });
  }

  var total = results.length;
  var totalPages = Math.max(1, Math.ceil(total / state.pageSize));
  if (state.currentPage > totalPages) state.currentPage = totalPages;
  var start = (state.currentPage - 1) * state.pageSize;
  var pageItems = results.slice(start, start + state.pageSize);

  renderGrid(pageItems, total, totalPages);

  document.querySelectorAll('.filter-btn[data-filter]').forEach(function(b){
    var k = b.getAttribute('data-filter');
    b.classList.toggle('active', !!(state.activeFilters[k] && Object.keys(state.activeFilters[k]).length));
  });
}

function clearSearch() {
  var input = document.getElementById('searchInput');
  if (!input) return;
  input.value = '';
  state.currentPage = 1;
  applyFilter();
  input.focus();
}

function renderDetailTagRow(label, tags, filterKey, jumpable) {
  var cls = 'detail-tag-row' + (jumpable ? ' jumpable' : '');
  var html = '<div class="' + cls + '"><span class="detail-section-title">' + escHtml(label) + '</span>';
  tags.forEach(function(t){
    if (jumpable && filterKey) {
      html += '<span class="detail-tag clickable" onclick="jumpToSingleFilter(\'' + filterKey + '\',\'' + escAttr(t.name) + '\')">' + escHtml(t.name) + '</span>';
    } else {
      html += '<span class="detail-tag">' + escHtml(t.name) + '</span>';
    }
  });
  return html + '</div>';
}

function jumpToSingleFilter(key, value) {
  resetHomeFilters();
  state.activeFilters[key] = {};
  state.activeFilters[key][value] = true;
  showPage('page-home');
  updatePageSize(false);
  applyFilter();
}

