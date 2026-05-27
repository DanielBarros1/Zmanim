import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { resolve } from 'path'

export default defineConfig({
  plugins: [react(), tailwindcss()],

  resolve: {
    alias: {
      // Resolve @zmanim/shared directly from source during dev/build.
      // This avoids requiring a `npm run build --workspace=shared` before
      // running the client dev server. Vite handles the TypeScript directly.
      '@zmanim/shared': resolve(__dirname, '../shared/src/index.ts'),
    },
  },

  server: {
    port: 5173,
    proxy: {
      // Proxy API and auth calls to Express during development
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/auth': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
