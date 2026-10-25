import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
    strategies: 'injectManifest', srcDir: 'src', filename: 'sw.ts', registerType: 'autoUpdate',
    injectRegister: 'auto', includeAssets: ['icons/*.svg', 'mat.svg'],
    manifest: { name: 'DexPlay — Dexterity Coach', short_name: 'DexPlay', description: 'Offline-first dexterity practice for children and clinics',
      theme_color: '#fff8ed', background_color: '#fff8ed', display: 'standalone', orientation: 'any',
      start_url: '/', scope: '/', lang: 'en', categories: ['health', 'education'],
      icons: [{ src: '/icons/icon-192.svg', sizes: '192x192', type: 'image/svg+xml', purpose: 'any' },
        { src: '/icons/icon-512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' }] },
    injectManifest: { globPatterns: ['**/*.{js,css,html,svg,json,wasm}'], maximumFileSizeToCacheInBytes: 15 * 1024 * 1024 },
    devOptions: { enabled: false },
  })],
  server: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } } },
  build: { target: 'es2022', sourcemap: false },
})
