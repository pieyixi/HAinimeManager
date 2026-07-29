import type { AppStore, TagSummary, WorkSummary } from '../../stores/app';

interface FilterOption {
  val: string;
  label: string;
}

const categoryMap: Record<string, string> = { story: '剧情', attr: '属性', scene: '场景' };

function escapeHtml(value: unknown): string {
  return String(value).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function globalFunction(name: string): ((...args: unknown[]) => unknown) | undefined {
  const value = (window as typeof window & Record<string, unknown>)[name];
  return typeof value === 'function' ? value as (...args: unknown[]) => unknown : undefined;
}

export function installFilterGlobals(state: AppStore): void {
  function bindDropdownEvents(dropdown: HTMLElement): void {
    dropdown.querySelectorAll<HTMLElement>('[data-filter-action]').forEach((element) => {
      element.addEventListener('click', () => {
        const action = element.dataset.filterAction;
        if (action === 'whole-year') toggleWholeYear(Number(element.dataset.year));
        else if (action === 'month') toggleYearMonth(element.dataset.value || '');
        else if (action === 'view-year') selectYearInDropdown(Number(element.dataset.year));
        else if (action === 'clear') clearFilter(element.dataset.key || '');
        else if (action === 'close') closeDropdown();
        else if (action === 'toggle') toggleFilter(element.dataset.key || '', element);
      });
    });
  }

  function getFilterOptions(key: string): FilterOption[] {
    if (key === 'year') return state.years.map((year) => ({ val: String(year), label: `${year}年` }));
    if (key === 'studio') return state.studios.map((studio) => ({ val: studio, label: studio }));
    if (key === 'story' || key === 'attr' || key === 'scene') {
      const category = categoryMap[key];
      const names = [...new Set(state.tags.filter((tag) => tag.category === category).map((tag) => tag.name))];
      names.sort((left, right) => left.localeCompare(right));
      return names.map((name) => ({ val: name, label: name }));
    }
    return [];
  }

  function placeDropdown(dropdown: HTMLElement): void {
    window.setTimeout(() => {
      if (!dropdown.parentNode) return;
      const bounds = dropdown.getBoundingClientRect();
      if (bounds.left < 4) {
        dropdown.style.transform = 'none';
        dropdown.style.left = '4px';
      }
      if (bounds.right > window.innerWidth - 4) {
        dropdown.style.transform = 'none';
        dropdown.style.left = 'auto';
        dropdown.style.right = '4px';
      }
    }, 0);
  }

  function renderYearDropdown(dropdown: HTMLElement): void {
    dropdown.classList.add('year-dd');
    const years = state.years.slice().sort((left, right) => right - left);
    const selectedYear = dropdown.getAttribute('data-year') || String(years[0] || new Date().getFullYear());
    dropdown.setAttribute('data-year', selectedYear);
    let html = '<div class="year-list">';
    years.forEach((year) => {
      const yearSelected = Boolean(state.activeFilters.year?.[String(year)]);
      const classes = `year-option${String(year) === selectedYear ? ' active' : ''}${yearSelected ? ' selected' : ''}`;
      html += `<button class="${classes}" data-filter-action="whole-year" data-year="${year}">${year}年</button>`;
    });
    html += `</div><div class="month-panel"><div class="dd-header">${selectedYear}年</div><div class="month-grid">`;
    for (let month = 1; month <= 12; month += 1) {
      const value = `${selectedYear}-${String(month).padStart(2, '0')}`;
      const selected = Boolean(state.activeFilters.year?.[value]);
      html += `<button class="month-cell${selected ? ' selected' : ''}" data-filter-action="month" data-value="${value}">${month}月</button>`;
    }
    html += `</div><div class="dd-actions"><span data-filter-action="clear" data-key="year">清除</span><span data-filter-action="view-year" data-year="${selectedYear}">只看月份</span><span class="primary" data-filter-action="close">确定</span></div></div>`;
    dropdown.innerHTML = html;
    bindDropdownEvents(dropdown);
  }

  function closeDropdown(): void {
    document.getElementById('filterDropdown')?.remove();
    state.openDropdown = null;
  }

  function openDropdown(key: string, button: HTMLElement): void {
    const existing = document.getElementById('filterDropdown');
    if (existing?.getAttribute('data-key') === key) {
      closeDropdown();
      return;
    }
    closeDropdown();

    const dropdown = document.createElement('div');
    dropdown.id = 'filterDropdown';
    dropdown.className = 'filter-dd';
    dropdown.setAttribute('data-key', key);
    dropdown.addEventListener('click', (event) => event.stopPropagation());
    state.openDropdown = key;

    const isVertical = key === 'studio';
    dropdown.style.width = isVertical ? '180px' : 'min(480px, calc(100vw - 20px))';
    const buttonBounds = button.getBoundingClientRect();
    dropdown.style.left = `${Math.round(buttonBounds.left + buttonBounds.width / 2)}px`;
    dropdown.style.transform = 'translateX(-50%)';
    dropdown.style.top = `${buttonBounds.bottom + 2}px`;

    if (key === 'year') {
      renderYearDropdown(dropdown);
      document.body.appendChild(dropdown);
      placeDropdown(dropdown);
      return;
    }

    const labels: Record<string, string> = { year: '年份', story: '剧情', attr: '属性', scene: '场景', studio: '制作商' };
    let html = `<div class="dd-header">${labels[key] || key}</div><div class="dd-body ${isVertical ? 'col' : 'row'}">`;
    getFilterOptions(key).forEach((option) => {
      const selected = Boolean(state.activeFilters[key]?.[option.val]);
      html += `<span class="dd-tag${selected ? ' selected' : ''}" data-val="${escapeHtml(option.val)}" data-filter-action="toggle" data-key="${escapeHtml(key)}">${escapeHtml(option.label)}</span>`;
    });
    html += `</div><div class="dd-actions"><span data-filter-action="clear" data-key="${escapeHtml(key)}">清除</span><span class="primary" data-filter-action="close">确定</span></div>`;
    dropdown.innerHTML = html;
    bindDropdownEvents(dropdown);
    document.body.appendChild(dropdown);
    placeDropdown(dropdown);
  }

  function selectYearInDropdown(year: number): void {
    const dropdown = document.getElementById('filterDropdown');
    if (!dropdown) return;
    dropdown.setAttribute('data-year', String(year));
    renderYearDropdown(dropdown);
  }

  function toggleYearMonth(value: string): void {
    state.activeFilters.year ||= {};
    delete state.activeFilters.year[value.slice(0, 4)];
    if (state.activeFilters.year[value]) delete state.activeFilters.year[value];
    else state.activeFilters.year[value] = true;
    state.currentPage = 1;
    const dropdown = document.getElementById('filterDropdown');
    if (dropdown) renderYearDropdown(dropdown);
    applyFilter();
  }

  function toggleWholeYear(year: number): void {
    state.activeFilters.year ||= {};
    const key = String(year);
    if (state.activeFilters.year[key]) delete state.activeFilters.year[key];
    else state.activeFilters.year[key] = true;
    state.currentPage = 1;
    const dropdown = document.getElementById('filterDropdown');
    if (dropdown) {
      dropdown.setAttribute('data-year', key);
      renderYearDropdown(dropdown);
    }
    applyFilter();
  }

  function toggleFilter(key: string, element: HTMLElement): void {
    element.classList.toggle('selected');
    const value = element.getAttribute('data-val');
    if (!value) return;
    state.activeFilters[key] ||= {};
    if (element.classList.contains('selected')) state.activeFilters[key][value] = true;
    else delete state.activeFilters[key][value];
    applyFilter();
  }

  function clearFilter(key: string): void {
    delete state.activeFilters[key];
    closeDropdown();
    state.currentPage = 1;
    applyFilter();
  }

  function setSort(sortKey: string): void {
    state.currentSort = sortKey;
    state.currentPage = 1;
    const timeButton = document.getElementById('sortTimeBtn');
    const nameButton = document.getElementById('sortNameBtn');
    if (timeButton) timeButton.innerHTML = `时间 ${sortKey === 'time-desc' ? '&#11015;' : '&#11014;'}`;
    if (nameButton) nameButton.innerHTML = `名称 ${(sortKey === 'name-asc' || sortKey === 'name-desc') ? (sortKey === 'name-asc' ? '&#11014;' : '&#11015;') : '&#11014;'}`;
    applyFilter();
  }

  function releaseDates(work: WorkSummary): string[] {
    if (Array.isArray(work.release_dates) && work.release_dates.length) return work.release_dates;
    return [`${work.year}-${String(work.month).padStart(2, '0')}`];
  }

  function matchesFilters(work: WorkSummary): boolean {
    return Object.entries(state.activeFilters).every(([key, selected]) => {
      const values = Object.keys(selected);
      if (!values.length) return true;
      if (key === 'year') {
        return values.some((value) => releaseDates(work).some((dateValue) => value.length === 4 ? String(dateValue).slice(0, 4) === value : String(dateValue) === value));
      }
      if (key === 'studio') return values.includes(work.studio || '');
      const category = categoryMap[key];
      if (!category) return true;
      return (work.tags || []).some((tag) => tag.category === category && values.includes(tag.name));
    });
  }

  function matchesSearch(work: WorkSummary, keyword: string): boolean {
    if (!keyword) return true;
    return work.title.toLowerCase().includes(keyword)
      || (work.description || '').toLowerCase().includes(keyword)
      || (work.studio || '').toLowerCase().includes(keyword)
      || (work.tags || []).some((tag) => tag.name.toLowerCase().includes(keyword));
  }

  function applyFilter(): void {
    globalFunction('updatePageSize')?.(true);
    const searchInput = document.getElementById('searchInput') as HTMLInputElement | null;
    const clearButton = document.getElementById('searchClear');
    const keyword = (searchInput?.value || '').trim().toLowerCase();
    const hasFilters = Object.values(state.activeFilters).some((selected) => Object.keys(selected).length > 0);
    clearButton?.classList.toggle('visible', Boolean(keyword) || hasFilters);

    const results = state.works.filter(matchesFilters).filter((work) => matchesSearch(work, keyword));
    results.sort((left, right) => {
      if (state.currentSort === 'time-desc') return Number(right.year) - Number(left.year) || Number(right.month) - Number(left.month);
      if (state.currentSort === 'time-asc') return Number(left.year) - Number(right.year) || Number(left.month) - Number(right.month);
      if (state.currentSort === 'name-desc') return right.title.localeCompare(left.title);
      return left.title.localeCompare(right.title);
    });

    const total = results.length;
    const totalPages = Math.max(1, Math.ceil(total / state.pageSize));
    if (state.currentPage > totalPages) state.currentPage = totalPages;
    const start = (state.currentPage - 1) * state.pageSize;
    globalFunction('renderGrid')?.(results.slice(start, start + state.pageSize), total, totalPages);

    document.querySelectorAll<HTMLElement>('.filter-btn[data-filter]').forEach((button) => {
      const key = button.getAttribute('data-filter') || '';
      button.classList.toggle('active', Boolean(state.activeFilters[key] && Object.keys(state.activeFilters[key]).length));
    });
  }

  function clearSearch(): void {
    const input = document.getElementById('searchInput') as HTMLInputElement | null;
    if (!input) return;
    input.value = '';
    state.activeFilters = {};
    state.currentPage = 1;
    closeDropdown();
    applyFilter();
    input.focus();
  }

  function renderDetailTagRow(label: string, tags: TagSummary[], filterKey?: string, jumpable = false): string {
    const classes = `detail-tag-row${jumpable ? ' jumpable' : ''}`;
    let html = `<div class="${classes}"><span class="detail-section-title">${escapeHtml(label)}</span>`;
    tags.forEach((tag) => {
      html += jumpable && filterKey
        ? `<span class="detail-tag clickable" data-detail-filter="${escapeHtml(filterKey)}" data-detail-value="${escapeHtml(tag.name)}">${escapeHtml(tag.name)}</span>`
        : `<span class="detail-tag">${escapeHtml(tag.name)}</span>`;
    });
    return `${html}</div>`;
  }

  function jumpToSingleFilter(key: string, value: string): void {
    globalFunction('resetHomeFilters')?.();
    state.activeFilters[key] = { [value]: true };
    globalFunction('showPage')?.('page-home');
    globalFunction('updatePageSize')?.(false);
    applyFilter();
  }

  Object.assign(window, {
    getFilterOptions,
    openDropdown,
    placeDropdown,
    renderYearDropdown,
    selectYearInDropdown,
    toggleYearMonth,
    toggleWholeYear,
    closeDropdown,
    toggleFilter,
    clearFilter,
    escHtml: escapeHtml,
    setSort,
    applyFilter,
    clearSearch,
    renderDetailTagRow,
    jumpToSingleFilter,
  });
}
