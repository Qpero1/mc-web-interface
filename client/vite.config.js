import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Vite config: dev server proxies /api and /socket.io to the Node backend.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8787',
      '/socket.io': { target: 'http://localhost:8787', ws: true },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
