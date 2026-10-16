import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiTarget = process.env.CABO_DEV_SERVER ?? 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/api': { target: apiTarget, changeOrigin: false },
      '/socket.io': { target: apiTarget, ws: true, changeOrigin: false },
      '/healthz': { target: apiTarget },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
