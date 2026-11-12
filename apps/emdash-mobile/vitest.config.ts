import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@core': resolve(__dirname, '../emdash-desktop/src/core'),
      '@root/src/core': resolve(__dirname, '../emdash-desktop/src/core'),
    },
    conditions: ['development'],
  },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
  },
});
