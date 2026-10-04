import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

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
    port: 5175,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3020', changeOrigin: true },
    },
  },
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
});
