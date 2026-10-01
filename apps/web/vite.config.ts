import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same-origin API in dev, like Nginx in production.
    proxy: {
      '/api': { target: 'http://127.0.0.1:5090', ws: true }
    }
  }
});
