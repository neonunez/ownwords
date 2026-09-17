import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';
import { manifest } from './src/pwa/manifest.ts';

// The app is served from the site root. `base` stays '/' so the service worker
// scope, the manifest scope and the navigation fallback all agree.
export default defineConfig({
  base: '/',
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  plugins: [
    react(),
    VitePWA({
      // 'prompt': a new build never replaces a running one silently. The app
      // shows "A new version of Ownwords is ready" with a reload action, so a
      // person is never left on a stale shell without being told.
      registerType: 'prompt',
      injectRegister: null,
      manifest,
      includeAssets: ['icons/apple-touch-icon.png', 'icons/icon.svg', 'icons/icon-maskable.svg'],
      workbox: {
        globPatterns: ['**/*.{js,css,html,svg,png,woff2,webmanifest}'],
        // Hashed build assets are safe to precache; stale caches from older
        // builds are deleted on activation so no old shell can survive.
        cleanupOutdatedCaches: true,
        clientsClaim: true,
        skipWaiting: false,
        navigateFallback: 'index.html',
        navigateFallbackDenylist: [/^\/api\//],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
  server: { port: 5173 },
  preview: { port: 4173 },
});
