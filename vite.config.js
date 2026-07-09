import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  plugins: [react()],
  publicDir: 'frontend/public',
  resolve: {
    alias: {
      re2js: fileURLToPath(new URL('./frontend/src/shims/re2js.js', import.meta.url))
    }
  },
  server: { host: '0.0.0.0', port: 5173 },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules/react') || id.includes('node_modules/react-dom')) return 'vendor-react'
          if (id.includes('node_modules/firebase')) return 'vendor-firebase'
          if (id.includes('node_modules/lucide-react')) return 'vendor-icons'
          if (id.includes('node_modules')) return 'vendor'
        }
      }
    }
  }
})
