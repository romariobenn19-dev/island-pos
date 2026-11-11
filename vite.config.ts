import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { VitePWA } from 'vite-plugin-pwa'

// ARTIFACT=1 builds a single-page demo without the offline service worker.
const demo = !!process.env.ARTIFACT

export default defineConfig({
  base: './', // works from any folder or host
  build: demo ? { outDir: 'dist-demo', assetsInlineLimit: 1e7, cssCodeSplit: false } : {},
  plugins: [
    react(),
    !demo && VitePWA({
      registerType: 'autoUpdate',
      workbox: {
        // app files plus the Latin font files, so the typefaces work offline too
        globPatterns: ['**/*.{js,css,html,svg}', '**/*-latin-wght-normal*.woff2'],
      },
      includeAssets: ['icon.svg'],
      manifest: {
        name: 'Island POS',
        short_name: 'Island POS',
        description: 'Simple point of sale, stock and credit book for Caribbean shops',
        theme_color: '#0b6e8a',
        background_color: '#f4f6f8',
        display: 'standalone',
        start_url: '.',
        icons: [{ src: 'icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any maskable' }],
      },
    }),
  ],
})
