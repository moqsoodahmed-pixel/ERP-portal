import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin proxy keeps the httpOnly refresh cookie first-party in development.
    proxy: { '/api': { target: process.env.VITE_PROXY_TARGET || 'http://localhost:4000', changeOrigin: true } },
  },
  test: { environment: 'jsdom', globals: true, setupFiles: ['./src/setupTests.js'], css: false },
});
