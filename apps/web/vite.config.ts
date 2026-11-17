import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

// One static site serves everything:
//   /score   volunteer scoring app (installable, works offline)
//   /board   public phone leaderboard
//   /tv      clubhouse TV leaderboard
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/icon.svg'],
      manifest: {
        name: "Slayin' Clays Scoring",
        short_name: 'Clay Scoring',
        description: "Station scoring for Slayin' Clays volunteers.",
        start_url: '/score',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#16202a',
        theme_color: '#16202a',
        icons: [
          { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        navigateFallback: '/index.html',
        globPatterns: ['**/*.{js,css,html,svg,png,woff2}'],
        runtimeCaching: [
          {
            urlPattern: ({ url }) => url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com',
            handler: 'CacheFirst',
            options: { cacheName: 'fonts', expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 } },
          },
        ],
      },
    }),
  ],
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
