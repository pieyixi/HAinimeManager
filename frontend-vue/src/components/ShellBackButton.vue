<script setup lang="ts">
withDefaults(defineProps<{
  disabled?: boolean;
}>(), {
  disabled: false,
});

defineEmits<{
  click: [event: MouseEvent];
}>();
</script>

<template>
  <button
    type="button"
    class="shell-back-button fluent-icon"
    :disabled="disabled"
    title="返回"
    aria-label="返回"
    @click="$emit('click', $event)"
  >&#xE76B;</button>
</template>
