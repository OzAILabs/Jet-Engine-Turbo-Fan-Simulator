/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Built to be served as a static SPA from a /JetEngine subpath; this
  // prefixes all built asset URLs so they resolve there.
  base: '/JetEngine/',
  plugins: [react()],
  server: {
    port: 5173,
    open: false,
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/tests/**/*.test.ts'],
  },
});
