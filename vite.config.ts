import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  build: {
    outDir: 'dist/client',
    emptyOutDir: true,
  },
  server: {
    // For frontend-only dev (`npm run dev:frontend`), proxy API calls to `wrangler dev`.
    proxy: {
      '/api': 'http://localhost:8787',
      '/images': 'http://localhost:8787',
    },
  },
});
