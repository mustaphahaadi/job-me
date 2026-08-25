import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { resolve } from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@job-me/shared': resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
});
