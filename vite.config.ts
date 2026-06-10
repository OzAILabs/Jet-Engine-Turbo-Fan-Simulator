/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  // Served as a static SPA behind nginx at https://omessner.cloud/JetEngine.
  // This prefixes all built asset URLs so they resolve under the subpath.
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
