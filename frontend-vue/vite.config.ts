import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig({
  plugins: [
    vue(),
    {
      name: 'full-reload-application-runtime',
      handleHotUpdate(context) {
        const normalized = context.file.replace(/\\/g, '/');
        if (normalized.includes('/frontend-vue/src/runtime/') || normalized.includes('/frontend-vue/src/features/')) {
          context.server.ws.send({ type: 'full-reload' });
          return [];
        }
      },
    },
  ],
  clearScreen: false,
  server: {
    strictPort: true,
  },
  build: {
    target: 'es2021',
  },
});
