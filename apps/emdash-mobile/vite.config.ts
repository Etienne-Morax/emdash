import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const desktopSrc = resolve(__dirname, '../emdash-desktop/src');

/**
 * The phone app shares contracts and pure helpers with the desktop through the `@core`
 * alias. Only portable `api/` surfaces may be imported this way; the boundary is checked by
 * `tsconfig.json`, which has no node types.
 */
export default defineConfig({
  base: '/',
  plugins: [react()],
  resolve: {
    alias: {
      '@core': resolve(desktopSrc, 'core'),
      '@root/src/core': resolve(desktopSrc, 'core'),
    },
    conditions: ['development'],
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: false,
    target: 'safari16',
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
});
