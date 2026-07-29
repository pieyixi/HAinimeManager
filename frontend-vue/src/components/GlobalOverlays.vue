<script setup lang="ts">
function call(name: string, ...args: unknown[]): void {
  const handler = (window as typeof window & Record<string, unknown>)[name];
  if (typeof handler === 'function') void (handler as (...values: unknown[]) => unknown)(...args);
}
</script>

<template>
  <div class="modal-mask" id="confirmModal">
    <div class="modal">
      <div class="modal-title" id="confirmTitle">确认操作</div>
      <div class="modal-copy" id="confirmBody"></div>
      <div class="modal-actions">
        <button class="btn-secondary" @click="call('resolveConfirm', false)">取消</button>
        <button class="btn-secondary btn-danger" @click="call('resolveConfirm', true)">删除</button>
      </div>
    </div>
  </div>
  <div class="context-menu" id="workContextMenu">
    <button class="context-item" id="ctxRefreshHome" @click="call('refreshHomeFromContext')">刷新主库</button>
    <button class="context-item danger" id="ctxDeleteWork" @click="call('deleteContextWork')">删除作品</button>
  </div>
</template>
