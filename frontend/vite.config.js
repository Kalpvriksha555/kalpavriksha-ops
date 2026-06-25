import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      re2js: fileURLToPath(new URL('./src/shims/re2js.js', import.meta.url))
    }
  },
  server: { host: '0.0.0.0', port: 5173 },
  build: { chunkSizeWarningLimit: 1200 }
});
