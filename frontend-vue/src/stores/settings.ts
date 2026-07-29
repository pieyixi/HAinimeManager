import { defineStore } from 'pinia';
import { invokeTauri } from '../api/tauri';
import { useAppStore } from './app';

export interface MediaLibraryStatus {
  root_path: string | null;
  source: string;
  rebound_paths: number;
  needs_binding: boolean;
}

interface LibrarySummary {
  archived_count: number;
  unarchived_count: number;
  episode_count: number;
  total_bytes: number;
}

export interface ConsoleItem {
  title: string;
  status: string;
  folder_path: string;
  can_update?: boolean;
  new_episode_numbers?: number[];
}

export interface LibraryScan {
  summary: LibrarySummary;
  changed_works: ConsoleItem[];
  new_episode_works: ConsoleItem[];
  new_complete_works: ConsoleItem[];
  attention_works: ConsoleItem[];
}

interface DuplicateItem {
  title: string;
  source: string;
  video_count: number;
  total_size: number;
  folder_path: string;
}

interface DuplicateGroup {
  items: DuplicateItem[];
}

type MessageKind = 'info' | 'err' | 'success';

interface UiMessage {
  kind: MessageKind;
  text: string;
}

function globalFunction(name: string): ((...args: unknown[]) => unknown) | undefined {
  const value = (window as typeof window & Record<string, unknown>)[name];
  return typeof value === 'function' ? value as (...args: unknown[]) => unknown : undefined;
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function formatLibrarySize(bytes: number): string {
  let value = Number(bytes || 0);
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${index < 3 ? Math.round(value) : value.toFixed(value >= 100 ? 0 : 1)} ${units[index]}`;
}

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    mediaPath: 'D:\\HAnime',
    backupPath: '',
    libraryMessage: null as UiMessage | null,
    databaseMessage: null as UiMessage | null,
    duplicateMessage: null as UiMessage | null,
    summary: { archived_count: 0, unarchived_count: 0, episode_count: 0, total_bytes: 0 } as LibrarySummary,
    scan: null as LibraryScan | null,
    scanning: false,
    progressActive: false,
    progressPercent: 0,
    progressText: '',
    duplicates: [] as DuplicateGroup[],
  }),

  getters: {
    archivedCount: (state) => Number(state.summary.archived_count || 0),
    unarchivedCount: (state) => Number(state.summary.unarchived_count || 0),
    totalWorks(): number { return this.archivedCount + this.unarchivedCount; },
    archivePercent(): number { return this.totalWorks ? Math.round(this.archivedCount / this.totalWorks * 100) : 0; },
    formattedSize: (state) => formatLibrarySize(state.summary.total_bytes),
    hasScanChanges: (state) => Boolean(state.scan && ['changed_works', 'new_episode_works', 'new_complete_works', 'attention_works']
      .some((key) => (state.scan?.[key as keyof LibraryScan] as ConsoleItem[] | undefined)?.length)),
  },

  actions: {
    sourceText(source: string): string {
      const labels: Record<string, string> = {
        database: '已从现有数据库建立便携媒体库',
        relative: '已按程序相对位置自动找到媒体库',
        previous: '已使用上次的媒体目录',
        'repaired-marker': '已修复媒体库标记',
        'drive-scan': '检测到盘符变化并自动找到媒体库',
        manual: '媒体库绑定成功',
        missing: '原媒体目录不可用，请填写移动后的媒体目录',
        unconfigured: '尚未设置媒体目录',
      };
      return labels[source] || '媒体库状态已更新';
    },

    applyMediaLibraryStatus(status: MediaLibraryStatus | null): void {
      const app = useAppStore();
      app.mediaLibrary = status;
      if (!status) return;
      if (status.root_path) this.mediaPath = status.root_path;
      let detail = this.sourceText(status.source);
      if (status.rebound_paths > 0) detail += `，已重绑定 ${status.rebound_paths} 条路径`;
      this.libraryMessage = status.needs_binding ? { kind: 'err', text: detail } : null;
    },

    async initializeMediaLibrary(): Promise<MediaLibraryStatus> {
      try {
        const status = await invokeTauri<MediaLibraryStatus>('initialize_media_library');
        this.applyMediaLibraryStatus(status);
        return status;
      } catch (error) {
        const status: MediaLibraryStatus = { root_path: null, source: 'unconfigured', rebound_paths: 0, needs_binding: true };
        this.applyMediaLibraryStatus(status);
        this.libraryMessage = { kind: 'err', text: `媒体库初始化失败: ${errorText(error)}` };
        return status;
      }
    },

    async openSettingsPage(): Promise<void> {
      globalFunction('showPage')?.('page-settings');
      await this.loadSummary();
    },

    async bindMediaLibraryPath(path: string, showMessage: boolean): Promise<MediaLibraryStatus> {
      const status = await invokeTauri<MediaLibraryStatus>('bind_media_library', { rootPath: path });
      this.applyMediaLibraryStatus(status);
      if (showMessage && status.rebound_paths > 0) {
        this.libraryMessage = { kind: 'success', text: `媒体库已连接，已更新 ${status.rebound_paths} 条路径` };
      }
      return status;
    },

    async ensureMediaLibraryPath(path: string): Promise<MediaLibraryStatus | unknown> {
      const app = useAppStore();
      const current = (app.mediaLibrary as MediaLibraryStatus | null)?.root_path;
      if (!current || current.toLowerCase() !== path.toLowerCase()) return this.bindMediaLibraryPath(path, false);
      return app.mediaLibrary;
    },

    async bindMediaLibrary(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path) return;
      this.libraryMessage = { kind: 'info', text: '正在验证媒体库...' };
      try {
        await this.bindMediaLibraryPath(path, true);
        await globalFunction('reloadLibraryData')?.({ resetFilters: false, clearCoverCache: true });
        this.scan = null;
        await this.loadSummary();
      } catch (error) {
        this.libraryMessage = { kind: 'err', text: `绑定失败: ${errorText(error)}` };
      }
    },

    async loadSummary(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path) return;
      try {
        this.summary = await invokeTauri<LibrarySummary>('get_library_console_summary', { rootPath: path });
      } catch (error) {
        this.libraryMessage = { kind: 'err', text: `统计失败：${errorText(error)}` };
      }
    },

    setProgress(active: boolean, percent: number, text: string): void {
      this.progressActive = active;
      this.progressPercent = Math.max(0, Math.min(100, percent));
      this.progressText = text;
    },

    items(group: keyof Pick<LibraryScan, 'changed_works' | 'new_episode_works' | 'new_complete_works' | 'attention_works'>): ConsoleItem[] {
      return this.scan?.[group] || [];
    },

    async openConsoleFolder(group: keyof LibraryScan, index: number): Promise<void> {
      const item = (this.scan?.[group] as ConsoleItem[] | undefined)?.[index];
      if (item) await invokeTauri('open_folder', { path: item.folder_path });
    },

    continueArchive(group: keyof LibraryScan, index: number): void {
      const item = (this.scan?.[group] as ConsoleItem[] | undefined)?.[index];
      if (!item) return;
      const focus = item.new_episode_numbers?.[0] ?? null;
      globalFunction('openArchiveAssistant')?.(item.folder_path, focus);
    },

    async scanLibraryChanges(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path || this.scanning) return;
      this.scanning = true;
      this.scan = null;
      let percent = 8;
      this.setProgress(true, percent, '正在检查目录和视频');
      const timer = window.setInterval(() => {
        percent = Math.min(88, percent + Math.max(1, Math.round((88 - percent) * 0.08)));
        const text = percent < 42 ? '正在检查目录和视频' : percent < 72 ? '正在比对元数据和封面' : '正在计算媒体库容量';
        this.setProgress(true, percent, text);
      }, 220);
      try {
        await this.ensureMediaLibraryPath(path);
        this.scan = await invokeTauri<LibraryScan>('scan_library_changes', { rootPath: path });
        this.summary = this.scan.summary;
        window.clearInterval(timer);
        this.setProgress(true, 100, '扫描完成');
        window.setTimeout(() => this.setProgress(false, 0, ''), 650);
      } catch (error) {
        window.clearInterval(timer);
        this.setProgress(false, 0, '');
        this.libraryMessage = { kind: 'err', text: `扫描失败：${errorText(error)}` };
      } finally {
        this.scanning = false;
      }
    },

    async applyLibraryUpdates(): Promise<void> {
      const items = this.items('changed_works').filter((item) => item.can_update);
      if (!items.length) return;
      const confirmed = await globalFunction('askConfirm')?.('全部更新', `将按当前文件重新导入 ${items.length} 个已建档作品，数据库中的对应信息会完整更新。`, '确认更新');
      if (!confirmed) return;
      try {
        this.setProgress(true, 35, '正在更新已建档作品');
        await invokeTauri('apply_library_updates', { folders: items.map((item) => item.folder_path) });
        this.setProgress(true, 100, '更新完成');
        await globalFunction('reloadLibraryData')?.({ resetFilters: false, clearCoverCache: true });
        await this.scanLibraryChanges();
      } catch (error) {
        this.setProgress(false, 0, '');
        this.libraryMessage = { kind: 'err', text: `更新失败：${errorText(error)}` };
      }
    },

    async importConsoleWorks(): Promise<void> {
      const items = this.items('new_complete_works');
      if (!items.length) return;
      const confirmed = await globalFunction('askConfirm')?.('导入新作品', `将把 ${items.length} 个建档完整的新作品导入主库。`, '确认导入');
      if (!confirmed) return;
      try {
        this.setProgress(true, 35, '正在导入新作品');
        await invokeTauri('batch_import_folders', { folders: items.map((item) => item.folder_path) });
        this.setProgress(true, 100, '导入完成');
        await globalFunction('reloadLibraryData')?.({ resetFilters: false, clearCoverCache: true });
        await this.scanLibraryChanges();
      } catch (error) {
        this.setProgress(false, 0, '');
        this.libraryMessage = { kind: 'err', text: `导入失败：${errorText(error)}` };
      }
    },

    async duplicateCheck(): Promise<void> {
      const path = this.mediaPath.trim();
      if (!path) return;
      this.duplicateMessage = { kind: 'info', text: '查重中...' };
      this.duplicates = [];
      try {
        await this.ensureMediaLibraryPath(path);
        this.duplicates = await invokeTauri<DuplicateGroup[]>('detect_duplicates', { rootPath: path });
        this.duplicateMessage = { kind: this.duplicates.length ? 'err' : 'info', text: this.duplicates.length ? `发现 ${this.duplicates.length} 组疑似重复` : '未发现重复作品' };
      } catch (error) {
        this.duplicateMessage = { kind: 'err', text: `查重失败: ${errorText(error)}` };
      }
    },

    async backupDatabase(): Promise<void> {
      const path = this.backupPath.trim() || 'D:\\HAnime\\backup.db';
      try {
        await invokeTauri('backup_database', { backupPath: path });
        this.databaseMessage = { kind: 'info', text: `备份成功: ${path}` };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `备份失败: ${errorText(error)}` };
      }
    },

    async backupDataPackage(): Promise<void> {
      const path = this.backupPath.trim() || 'D:\\Ark\\hanime-data-backup.zip';
      try {
        const result = await invokeTauri<string>('backup_data_package', { backupPath: path });
        this.databaseMessage = { kind: 'info', text: `资料包备份成功: ${result}` };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `资料包备份失败: ${errorText(error)}` };
      }
    },

    async restoreDatabase(): Promise<void> {
      const path = this.backupPath.trim();
      if (!path) return;
      try {
        await invokeTauri('restore_database', { restorePath: path });
        this.databaseMessage = { kind: 'info', text: '恢复成功，请重启应用' };
      } catch (error) {
        this.databaseMessage = { kind: 'err', text: `恢复失败: ${errorText(error)}` };
      }
    },
  },
});

export function installSettingsGlobals(): void {
  const settings = useSettingsStore();
  Object.assign(window, {
    initializeMediaLibrary: () => settings.initializeMediaLibrary(),
    openSettingsPage: () => settings.openSettingsPage(),
    doBindMediaLibrary: () => settings.bindMediaLibrary(),
    loadLibraryConsoleSummary: () => settings.loadSummary(),
    doScanLibraryChanges: () => settings.scanLibraryChanges(),
    doApplyLibraryUpdates: () => settings.applyLibraryUpdates(),
    doImportConsoleWorks: () => settings.importConsoleWorks(),
    doDuplicateCheck: () => settings.duplicateCheck(),
    doBackup: () => settings.backupDatabase(),
    doDataBackup: () => settings.backupDataPackage(),
    doRestore: () => settings.restoreDatabase(),
  });
}
