import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

const frontendRoot = fileURLToPath(new URL('.', import.meta.url));
const localApiTarget = 'http://127.0.0.1:8080';

export default defineConfig(({ command, mode }) => {
  const env = loadEnv(mode, frontendRoot, '');
  const productionApiUrl = process.env.VITE_API_BASE || process.env.VITE_API_URL || env.VITE_API_BASE || env.VITE_API_URL;
  if (command === 'build' && mode === 'production' && !String(productionApiUrl || '').trim()) {
    throw new Error('Production build blocked: set VITE_API_URL (or VITE_API_BASE) explicitly.');
  }

  return {
    plugins: [react()],
    resolve: {
      alias: {
        re2js: fileURLToPath(new URL('./src/shims/re2js.js', import.meta.url))
      }
    },
    server: {
      host: '0.0.0.0',
      port: 5173,
      strictPort: true,
      proxy: {
        '/api': {
          target: localApiTarget,
          changeOrigin: false,
          secure: false
        },
        '/uploads': {
          target: localApiTarget,
          changeOrigin: false,
          secure: false
        }
      }
    },
    build: { chunkSizeWarningLimit: 1200 }
  };
});
