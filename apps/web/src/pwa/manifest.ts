import type { ManifestOptions } from 'vite-plugin-pwa';

/**
 * The installable app's identity. Shared by the build (which writes
 * `manifest.webmanifest`) and by the tests that check it.
 */
export const manifest: Partial<ManifestOptions> = {
  name: 'Ownwords',
  short_name: 'Ownwords',
  description: 'Practise the words you actually use, and learn a new language in the same app.',
  start_url: '/',
  scope: '/',
  id: '/',
  display: 'standalone',
  display_override: ['standalone', 'fullscreen'],
  orientation: 'portrait',
  background_color: '#215E49',
  theme_color: '#f8f8f8',
  lang: 'en-GB',
  dir: 'ltr',
  categories: ['education', 'productivity'],
  icons: [
    { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
    { src: 'icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    { src: 'icons/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
  ],
};
