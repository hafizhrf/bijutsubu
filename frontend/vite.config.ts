import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'node:path'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  define: {
    // react-draggable (inside react-grid-layout) reads process.env.DRAGGABLE_DEBUG
    // on every drag start; browsers have no `process`, so without this constant
    // the read throws and dashboard layout editing silently does nothing.
    'process.env.DRAGGABLE_DEBUG': 'false',
  },
  // .lottie files (dotLottie) are binary assets — serve them as URLs.
  assetsInclude: ['**/*.lottie'],
  build: {
    // Never inline .lottie files as data URIs — the dotLottie player fetches
    // them, and real file URLs keep that path uniform across dev/prod.
    assetsInlineLimit: (filePath) => (filePath.endsWith('.lottie') ? false : undefined),
  },
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:4000',
        changeOrigin: true,
      },
    },
  },
})
