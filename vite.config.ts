import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig} from 'vite';
import {compression} from 'vite-plugin-compression2';
import {VitePWA} from 'vite-plugin-pwa';

export default defineConfig(() => {
  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        registerType: 'autoUpdate',
        injectRegister: false,
        includeAssets: [
          'favicon.ico',
          'icon.svg',
          'apple-touch-icon.png',
          'pwa-192x192.png',
          'pwa-512x512.png',
          'pwa-maskable-512x512.png',
        ],
        manifest: {
          name: 'Андрій Даньків — Письменник',
          short_name: 'Андрій Даньків',
          description:
            'Офіційний сайт письменника Андрія Даньківа: поезія, мала і велика проза, авторський блог та крамниця електронних книг.',
          theme_color: '#18231C',
          background_color: '#181818',
          display: 'standalone',
          lang: 'uk',
          start_url: '/',
          icons: [
            {src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png'},
            {src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png'},
            {
              src: '/pwa-maskable-512x512.png',
              sizes: '512x512',
              type: 'image/png',
              purpose: 'maskable',
            },
          ],
        },
        workbox: {
          globPatterns: ['**/*.{js,css,html,ico,png,svg,woff,woff2}'],
          importScripts: ['/sw-notifications.js'],
          navigateFallback: '/index.html',
          navigateFallbackDenylist: [/^\/api\//, /^\/ws\//, /^\/uploads\//],
          cleanupOutdatedCaches: true,
          clientsClaim: true,
          skipWaiting: true,
          runtimeCaching: [
            {
              urlPattern: /^https?:\/\/[^/]+\/api\/.*/i,
              handler: 'NetworkOnly',
            },
            {
              urlPattern: /^https:\/\/fonts\.gstatic\.com\/.*/i,
              handler: 'CacheFirst',
              options: {
                cacheName: 'google-fonts-webfonts',
                expiration: {
                  maxEntries: 16,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
                cacheableResponse: {
                  statuses: [0, 200],
                },
              },
            },
          ],
        },
      }),
      compression({
        algorithms: ['gzip', 'brotliCompress'],
        threshold: 512,
        skipIfLargerOrEqual: true,
      }),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(__dirname, 'dist');
          const srcAssets = path.resolve(__dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks(id) {
            const normalizedId = id.replace(/\\/g, '/');
            if (/\/node_modules\/(react|react-dom|scheduler)\//.test(normalizedId)) {
              return 'vendor-react';
            }
            if (/\/node_modules\/(firebase|@firebase)\//.test(normalizedId)) {
              return 'vendor-firebase';
            }
            if (/\/node_modules\/(motion|framer-motion|motion-dom|motion-utils)\//.test(normalizedId)) {
              return 'vendor-motion';
            }
            if (/\/node_modules\/lucide-react\//.test(normalizedId)) {
              return 'vendor-icons';
            }
          },
        },
      },
    },
  };
});
