import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [react(), VitePWA({
  registerType: 'autoUpdate',
  workbox: {
    globPatterns: ['**/*.{js,css,html,svg,png,woff2,js}'],
    // Small launchers ship with the app; the multi-MB WASM/model are runtime-cached.
    // Bump only if you later decide to precache them intentionally.
    maximumFileSizeToCacheInBytes: 2 * 1024 * 1024,
    cleanupOutdatedCaches: true,
    navigateFallback: '/index.html',
    navigateFallbackDenylist: [/^\/api/],
    runtimeCaching: [
      {
        // MediaPipe WASM: fetch the variant the device needs, cache forever.
        urlPattern: /\/wasm\/.*\.wasm$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'dexplay-mediapipe-wasm',
          expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
      {
        // MediaPipe model: 7.8 MB, fetched once per device, cached forever.
        urlPattern: /\/models\/.*\.task$/,
        handler: 'CacheFirst',
        options: {
          cacheName: 'dexplay-models',
          expiration: { maxEntries: 2, maxAgeSeconds: 60 * 60 * 24 * 365 },
          cacheableResponse: { statuses: [0, 200] },
        },
      },
    ],
  },
})],
  server: { proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, '') } } },
  build: { target: 'es2022', sourcemap: false },
})
