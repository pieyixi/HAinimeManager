import { invokeTauri } from '../../api/tauri';
import type { AppStore } from '../../stores/app';

type GlobalFunction = (...args: unknown[]) => unknown;

function globalFunction(name: string): GlobalFunction | undefined {
  const value = (window as typeof window & Record<string, unknown>)[name];
  return typeof value === 'function' ? value as GlobalFunction : undefined;
}
export function installLibraryActions(state: AppStore): void {
  async function openWorkFolder(folderPath?: string): Promise<void> {
    if (!folderPath) return;
    try { await invokeTauri('open_folder', { path: folderPath }); }
    catch (error) { console.error('open folder failed:', error); }
  }

  function askConfirm(title: string, body: string, actionText = '确认', destructive = false): Promise<boolean> {
    const modal = document.getElementById('confirmModal');
    const titleElement = document.getElementById('confirmTitle');
    const bodyElement = document.getElementById('confirmBody');
    const action = document.querySelector<HTMLElement>('#confirmModal [data-confirm-action], #confirmModal .modal-actions button:last-child');
    if (titleElement) titleElement.textContent = title;
    if (bodyElement) bodyElement.textContent = body;
    if (action) {
      action.textContent = actionText;
      action.classList.toggle('btn-danger', destructive);
      action.dataset.confirmAction = '1';
    }
    modal?.classList.add('active');
    return new Promise((resolve) => { state.confirmResolver = resolve; });
  }

  function resolveConfirm(value: boolean): void {
    document.getElementById('confirmModal')?.classList.remove('active');
    state.confirmResolver?.(value);
    state.confirmResolver = null;
  }

  function closeWorkContextMenu(): void {
    document.getElementById('workContextMenu')?.classList.remove('active');
  }

  function showContextMenuAt(x: number, y: number, mode: 'home' | 'work'): void {
    const menu = document.getElementById('workContextMenu');
    const refresh = document.getElementById('ctxRefreshHome');
    const remove = document.getElementById('ctxDeleteWork');
    if (!menu) return;
    if (refresh) refresh.style.display = mode === 'home' ? 'block' : 'none';
    if (remove) remove.style.display = mode === 'work' ? 'block' : 'none';
    menu.classList.add('active');
    menu.style.left = `${x}px`;
    menu.style.top = `${y}px`;
    const rect = menu.getBoundingClientRect();
    if (rect.right > window.innerWidth - 6) menu.style.left = `${window.innerWidth - rect.width - 6}px`;
    if (rect.bottom > window.innerHeight - 6) menu.style.top = `${window.innerHeight - rect.height - 6}px`;
  }

  function showWorkContextMenu(event: MouseEvent, workId: number): void {
    event.preventDefault();
    event.stopPropagation();
    globalFunction('closeDropdown')?.();
    state.contextWorkId = workId;
    showContextMenuAt(event.clientX, event.clientY, 'work');
  }

  function showHomeContextMenu(event: MouseEvent): void {
    event.preventDefault();
    globalFunction('closeDropdown')?.();
    state.contextWorkId = null;
    showContextMenuAt(event.clientX, event.clientY, 'home');
  }

  async function deleteContextWork(): Promise<void> {
    const workId = state.contextWorkId;
    closeWorkContextMenu();
    if (!workId) return;
    const title = state.works.find((work) => work.id === workId)?.title || '';
    const confirmed = await askConfirm('删除作品', `确定删除作品“${title}”？只会删除数据库记录，不会删除视频文件。`, '删除', true);
    if (!confirmed) return;
    try {
      await invokeTauri('delete_work', { workId });
      if (state.currentDetailWorkId === workId) {
        state.currentDetailWorkId = null;
        state.currentDetail = null;
        globalFunction('showHome')?.();
      }
      await globalFunction('init')?.();
    } catch (error) {
      const message = document.getElementById('scanMsg') || document.getElementById('tagMsg');
      if (message) {
        message.replaceChildren();
        const line = document.createElement('div');
        line.className = 'settings-msg err';
        line.textContent = `删除失败: ${String(error)}`;
        message.appendChild(line);
      }
    }
  }

  async function refreshHomeFromContext(): Promise<void> {
    await globalFunction('refreshHomeLibrary')?.({ clearCoverCache: true });
  }

  Object.assign(window, {
    openWorkFolder,
    askConfirm,
    resolveConfirm,
    showWorkContextMenu,
    showHomeContextMenu,
    showContextMenuAt,
    closeWorkContextMenu,
    deleteContextWork,
    refreshHomeFromContext,
  });
}
