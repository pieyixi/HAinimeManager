<script setup lang="ts">
import { onBeforeUnmount, onMounted } from 'vue';
import './assets/styles.css';
import ArchivePage from './components/ArchivePage.vue';
import DetailPage from './components/DetailPage.vue';
import GlobalOverlays from './components/GlobalOverlays.vue';
import HomePage from './components/HomePage.vue';
import PlayerPage from './components/PlayerPage.vue';
import SettingsPage from './components/SettingsPage.vue';
import UnarchivedPage from './components/UnarchivedPage.vue';
import { startApplicationRuntime } from './runtime/startApplication';

let stopApplicationRuntime: (() => void) | undefined;

onMounted(() => {
  stopApplicationRuntime = startApplicationRuntime();
});

onBeforeUnmount(() => {
  stopApplicationRuntime?.();
});
</script>

<template>
  <div class="window">
    <HomePage />
    <DetailPage />
    <PlayerPage />
    <SettingsPage />
    <UnarchivedPage />
    <ArchivePage />
  </div>
  <GlobalOverlays />
</template>

<style>
#app {
  width: 100%;
  height: 100%;
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}
</style>
