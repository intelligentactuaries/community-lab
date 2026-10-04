import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// The dev pair: this Vite client and the Bun API (src/server/index.ts). Their ports are Community Lab IDE's own
// (API 3040, UI 5195), clear of Scelo IDE's bundled copy (3020/5175) and the website's dev server (5175).
const API_PORT = Number(process.env.COMMUNITY_API_PORT ?? process.env.PORT ?? 3040);
const UI_PORT = Number(process.env.COMMUNITY_UI_PORT ?? 5195);

export default defineConfig({
  plugins: [react()],
  root: '.',
  publicDir: 'public',
  resolve: {
    alias: {
      '@sim': path.resolve(__dirname, 'src/sim'),
      '@shared': path.resolve(__dirname, 'src/shared'),
      '@client': path.resolve(__dirname, 'src/client'),
    },
  },
  server: {
    port: UI_PORT,
    strictPort: true,
    proxy: {
      '/api': { target: `http://localhost:${API_PORT}`, changeOrigin: true },
    },
  },
  // The workbench's script runtime and Monaco's language services run in module workers that import the engine.
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: true,
    // Monaco and three.js are large by nature; they load only when the workbench or the 3D view is first opened.
    chunkSizeWarningLimit: 4096,
  },
});
