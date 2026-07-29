import { defineStore } from 'pinia';
import { nextTick } from 'vue';
import { invokeTauri } from '../api/tauri';
import { playerCommands } from '../features/player/commands';
import { type ArchiveDraft, type ArchiveEpisode, useAppStore } from './app';
import { useLibraryStore } from './library';
import { useNavigationStore } from './navigation';
import { useSettingsStore } from './settings';

export interface UnarchivedItem {
  title: string;
  folder_path: string;
  video_count: number;
  has_data_dir: boolean;
  has_meta_json: boolean;
  missing_reasons: string[];
  index_letter?: string;
}

type MessageKind = 'info' | 'err';
interface UiMessage { kind: MessageKind; text: string }

const indexLetters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ#'.split('');
const collator = new Intl.Collator('zh-CN-u-co-pinyin', { numeric: true, sensitivity: 'base' });
const pinyinBoundaries = '阿八嚓哒妸发旮哈讥咔垃妈拿哦啪期然撒塌挖昔压匝';
const pinyinBoundaryLetters = 'ABCDEFGHJKLMNOPQRSTWXYZ';

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function firstIndexableCharacter(title: string): string {
  const normalized = String(title || '').normalize('NFKC').trim();
  for (const character of normalized) {
    if (/[A-Za-z0-9\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]/.test(character)) return character;
  }
  return '';
}

function kanaIndexLetter(character: string): string {
  const groups: Record<string, string> = {
    A: 'あぁアァ', E: 'えぇエェ', I: 'いぃイィ', O: 'おぉオォ', U: 'うぅウゥ', B: 'ばびぶべぼバビブベボ', C: 'ちチ', D: 'だでどダデド',
    F: 'ふフ', G: 'がぎぐげごガギグゲゴ', H: 'はひへほハヒヘホ', J: 'じぢジヂ', K: 'かきくけこゕゖカキクケコヵヶ', M: 'まみむめもマミムメモ',
    N: 'なにぬねのんナニヌネノン', P: 'ぱぴぷぺぽパピプペポ', R: 'らりるれろラリルレロ', S: 'さしすせそサシスセソ',
    T: 'たつてとっタツテトッ', V: 'ゔヴ', W: 'わをゐゑゎワヲヰヱヮ', Y: 'やゆよゃゅょヤユヨャュョ', Z: 'ざずぜぞづザズゼゾヅ',
  };
  return Object.keys(groups).find((letter) => groups[letter].includes(character)) || '';
}

export function getUnarchivedIndexLetter(title: string): string {
  const character = firstIndexableCharacter(title);
  if (!character || /[0-9]/.test(character)) return '#';
  if (/[A-Za-z]/.test(character)) return character.toUpperCase();
  if (/[\u3040-\u30ff]/.test(character)) return kanaIndexLetter(character) || '#';
  if (/[\u3400-\u9fff\uf900-\ufaff]/.test(character)) {
    for (let index = pinyinBoundaries.length - 1; index >= 0; index -= 1) {
      if (collator.compare(character, pinyinBoundaries[index]) >= 0) return pinyinBoundaryLetters[index];
    }
  }
  return '#';
}

export function summarizeUnarchivedReasons(item: UnarchivedItem): string[] {
  const reasons = item.missing_reasons || [];
  const summary: string[] = [];
  const add = (text: string) => { if (!summary.includes(text)) summary.push(text); };
  if (!item.has_data_dir) add('缺少 data 文件夹');
  if (!item.has_meta_json) add('缺少 meta.json');
  if (reasons.some((reason) => /视频.*编号|编号.*视频/.test(reason))) add('视频编号有误');
  if (reasons.includes('缺少主封面')) add('缺少主封面');
  if (reasons.some((reason) => /^缺少第\d+集封面$/.test(reason))) add('集数封面不齐全');
  if (item.has_meta_json && reasons.some((reason) => !/视频.*编号|编号.*视频/.test(reason) && reason !== '缺少主封面' && !/^缺少第\d+集封面$/.test(reason))) add('meta.json 不完整');
  return summary;
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function splitTags(value: string): string[] {
  return String(value || '').split(/[,，、;；]/).map((tag) => tag.trim()).filter(Boolean);
}

export const useArchiveStore = defineStore('archive', {
  state: () => ({
    unarchivedPath: 'D:\\HAnime',
    folders: [] as UnarchivedItem[],
    unarchivedLoading: false,
    unarchivedError: '',
    activeIndex: '',
    dirPath: '',
    title: '',
    studio: '',
    charactersText: '',
    synopsis: '',
    jsonText: '',
    message: null as UiMessage | null,
    jsonMessage: null as UiMessage | null,
    refreshing: false,
    copied: false,
    mainCoverPreview: '',
  }),

  getters: {
    availableIndexes: (state): Set<string> => new Set(state.folders.map((item) => item.index_letter || '#')),
    groupedFolders: (state): Array<{ letter: string; items: UnarchivedItem[] }> => indexLetters
      .map((letter) => ({ letter, items: state.folders.filter((item) => item.index_letter === letter) }))
      .filter((group) => group.items.length),
    draft(): ArchiveDraft | null { return useAppStore().archive.draft; },
    episodes(): ArchiveEpisode[] { return this.draft?.episode_list || []; },
  },

  actions: {
    showMessage(kind: MessageKind, text: string): void { this.message = { kind, text }; },
    showJsonMessage(kind: MessageKind, text: string): void { this.jsonMessage = { kind, text }; },

    async openUnarchivedPage(): Promise<void> {
      const app = useAppStore();
      const navigation = useNavigationStore();
      const returning = navigation.activePage === 'page-archive';
      if (!returning) {
        app.unarchivedScrollTop = 0;
        app.unarchivedActiveIndex = '';
      }
      this.unarchivedPath = useSettingsStore().mediaPath.trim() || 'D:\\HAnime';
      navigation.showPage('page-unarchived');
      await this.loadUnarchivedFolders();
    },

    async loadUnarchivedFolders(): Promise<void> {
      const path = this.unarchivedPath.trim();
      if (!path) return;
      this.unarchivedLoading = true;
      this.unarchivedError = '';
      try {
        const folders = await invokeTauri<UnarchivedItem[]>('list_unarchived_folders', { rootPath: path });
        folders.forEach((item) => { item.index_letter = getUnarchivedIndexLetter(item.title); });
        folders.sort((left, right) => indexLetters.indexOf(left.index_letter || '#') - indexLetters.indexOf(right.index_letter || '#') || collator.compare(left.title, right.title));
        this.folders = folders;
      } catch (error) {
        this.folders = [];
        this.unarchivedError = `扫描失败: ${errorText(error)}`;
      } finally {
        this.unarchivedLoading = false;
      }
    },

    setActiveIndex(letter: string): void {
      this.activeIndex = letter;
      const app = useAppStore();
      app.unarchivedActiveIndex = letter;
    },

    async openArchiveAssistant(dirPath = '', focusEpisode?: number | null): Promise<void> {
      const app = useAppStore();
      app.archive = { draft: null, coverData: null, episodeCoverData: {}, dataPath: '', focusEpisode: focusEpisode || null };
      this.dirPath = dirPath;
      this.title = '';
      this.studio = '';
      this.charactersText = '';
      this.synopsis = '';
      this.jsonText = '';
      this.message = null;
      this.jsonMessage = null;
      this.mainCoverPreview = '';
      useNavigationStore().showPage('page-archive');
      if (!dirPath) return;
      try {
        app.archive.dataPath = await invokeTauri<string>('ensure_archive_data_dir', { dirPath });
        await this.loadArchiveDraft();
      } catch (error) {
        this.showMessage('err', `准备 data 文件夹失败: ${errorText(error)}`);
      }
    },

    async loadArchiveDraft(): Promise<void> {
      const app = useAppStore();
      const dirPath = this.dirPath.trim();
      if (!dirPath) { this.showMessage('err', '请先填写作品目录'); return; }
      try {
        const draft = await invokeTauri<ArchiveDraft>('inspect_archive_folder', { dirPath });
        app.archive.draft = draft;
        this.title = draft.title || '';
        this.studio = draft.studio || '';
        this.synopsis = draft.synopsis || '';
        this.charactersText = Object.keys(draft.characters || {}).sort((left, right) => Number(left) - Number(right)).map((key) => draft.characters[key]).filter(Boolean).join('\n');
        const coverPaths = [draft.cover_path, ...draft.episode_list.map((episode) => episode.cover_path)].filter((path): path is string => Boolean(path));
        const library = useLibraryStore();
        await library.loadCovers(coverPaths);
        this.mainCoverPreview = library.coverUrl(draft.cover_path);
        this.showMessage('info', `已读取目录，发现 ${draft.episodes} 个视频`);
        await nextTick();
      } catch (error) {
        this.showMessage('err', `读取失败: ${errorText(error)}`);
      }
    },

    episodePreview(episode: ArchiveEpisode): string {
      const app = useAppStore();
      return app.archive.episodeCoverData[episode.id] || useLibraryStore().coverUrl(episode.cover_path);
    },

    async setMainCover(file?: File): Promise<void> {
      if (!file) return;
      const dataUrl = await fileToDataUrl(file);
      useAppStore().archive.coverData = dataUrl;
      this.mainCoverPreview = dataUrl;
    },

    async setEpisodeCover(episodeId: number, file?: File): Promise<void> {
      if (!file) return;
      useAppStore().archive.episodeCoverData[episodeId] = await fileToDataUrl(file);
    },

    async playEpisodeForCover(episodeId: number): Promise<void> {
      const episode = this.episodes.find((item) => Number(item.id) === Number(episodeId));
      if (!episode) { this.showMessage('err', '请先读取目录'); return; }
      await playerCommands.openPlayerWithEpisode({ id: episode.id, number: episode.id, video_path: episode.video_path }, `${this.draft?.title || '建档'} / 第${episode.id}集取帧`, 'archive');
    },

    collectArchiveInput(): Record<string, unknown> {
      const app = useAppStore();
      if (!this.draft) throw new Error('请先读取目录');
      const characters: Record<string, string> = {};
      this.charactersText.split(/\r?\n/).map((name) => name.trim()).filter(Boolean).forEach((name, index) => { characters[String(index + 1)] = name; });
      return {
        dir_path: this.dirPath.trim(),
        title: this.title.trim(),
        studio: this.studio.trim(),
        synopsis: this.synopsis.trim(),
        characters,
        episode_list: this.episodes.map((episode) => ({ ...episode, subtitle: episode.subtitle || '', release_date: episode.release_date || '', tags: {
          theme: splitTags(Array.isArray(episode.tags.theme) ? episode.tags.theme.join(',') : String(episode.tags.theme || '')),
          attribute: splitTags(Array.isArray(episode.tags.attribute) ? episode.tags.attribute.join(',') : String(episode.tags.attribute || '')),
          scene: splitTags(Array.isArray(episode.tags.scene) ? episode.tags.scene.join(',') : String(episode.tags.scene || '')),
        } })),
        cover_data: app.archive.coverData,
      };
    },

    async saveArchive(shouldImport: boolean): Promise<void> {
      const app = useAppStore();
      try {
        const input = this.collectArchiveInput();
        if (!this.title.trim()) { this.showMessage('err', '标题不能为空'); return; }
        const coverInputs = Object.entries(app.archive.episodeCoverData).map(([id, image_data]) => ({ id: Number.parseInt(id, 10), image_data }));
        if (coverInputs.length) await invokeTauri('save_archive_episode_covers', { input: { dir_path: this.dirPath.trim(), covers: coverInputs } });
        const outPath = await invokeTauri<string>('save_archive_draft', { input });
        const library = useLibraryStore();
        library.clearArchiveCoverCaches(this.dirPath.trim(), this.episodes);
        if (shouldImport) {
          await invokeTauri('import_work_via_json', { dirPath: this.dirPath.trim() });
          await library.refreshHome({ resetFilters: true, clearCoverCache: true });
        }
        this.showMessage('info', shouldImport ? `已保存并导入: ${outPath}` : `已保存: ${outPath}`);
      } catch (error) {
        this.showMessage('err', `保存失败: ${errorText(error)}`);
      }
    },

    async savePastedJson(): Promise<void> {
      const dirPath = this.dirPath.trim();
      const jsonText = this.jsonText.trim();
      if (!dirPath) { this.showJsonMessage('err', '请先填写作品目录'); return; }
      if (!jsonText) { this.showJsonMessage('err', '请先粘贴 meta.json'); return; }
      try { JSON.parse(jsonText); } catch (error) { this.showJsonMessage('err', `JSON 格式错误: ${errorText(error)}`); return; }
      try {
        const outPath = await invokeTauri<string>('save_archive_json', { dirPath, jsonText });
        await this.loadArchiveDraft();
        try {
          await invokeTauri('import_work_via_json', { dirPath });
          await useLibraryStore().refreshHome({ resetFilters: true, clearCoverCache: true });
          this.showJsonMessage('info', `已保存并导入主库: ${outPath}`);
        } catch (importError) {
          this.showJsonMessage('info', `已保存: ${outPath}；暂未导入主库: ${errorText(importError)}`);
        }
      } catch (error) {
        this.showJsonMessage('err', `保存失败: ${errorText(error)}`);
      }
    },

    async openWorkFolder(): Promise<void> {
      if (this.dirPath.trim()) await invokeTauri('open_folder', { path: this.dirPath.trim() });
    },

    async refreshDraft(): Promise<void> {
      const app = useAppStore();
      if (!this.dirPath.trim() || this.refreshing) return;
      this.refreshing = true;
      try {
        if (app.archive.draft) {
          const library = useLibraryStore();
          if (app.archive.draft.cover_path) delete library.coverCache[app.archive.draft.cover_path];
          app.archive.draft.episode_list.forEach((episode) => { if (episode.cover_path) delete library.coverCache[episode.cover_path]; });
          library.clearArchiveCoverCaches(this.dirPath.trim(), app.archive.draft.episode_list);
        }
        app.archive.coverData = null;
        app.archive.episodeCoverData = {};
        this.jsonText = '';
        this.jsonMessage = null;
        this.mainCoverPreview = '';
        await this.loadArchiveDraft();
      } finally {
        this.refreshing = false;
      }
    },

    async copyDataPath(): Promise<void> {
      const app = useAppStore();
      if (!this.dirPath.trim()) return;
      const dataPath = app.archive.dataPath || `${this.dirPath.replace(/[\\/]+$/, '')}\\data`;
      try {
        if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(dataPath);
        else {
          const input = document.createElement('textarea');
          input.value = dataPath;
          input.style.position = 'fixed';
          input.style.opacity = '0';
          document.body.appendChild(input);
          input.select();
          if (!document.execCommand('copy')) throw new Error('系统剪贴板不可用');
          input.remove();
        }
        this.copied = true;
        window.setTimeout(() => { this.copied = false; }, 1200);
      } catch (error) {
        this.showMessage('err', `复制 data 路径失败: ${errorText(error)}`);
      }
    },
  },
});

export { indexLetters as unarchivedIndexLetters };
