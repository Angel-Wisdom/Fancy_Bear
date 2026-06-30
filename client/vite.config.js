import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // host:true is required in Docker so Vite binds to 0.0.0.0, not just 127.0.0.1
    host: true,
    proxy: {
      '/api': {
        // Docker sets VITE_API_TARGET=http://server:3001 via the compose env
        target: process.env.VITE_API_TARGET || 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
  },
});
