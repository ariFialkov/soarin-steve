import { defineConfig } from 'vite';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  define: { APP_VERSION: JSON.stringify(process.env.npm_package_version ?? '0.1.0') },
  build: { target: 'es2022', sourcemap: false },
  plugins: [
    VitePWA({
      registerType: 'autoUpdate',
      // plain .json name: some hosts reject the .webmanifest extension
      manifestFilename: 'manifest.json',
      includeAssets: ['icons/*.png', 'icons/*.svg'],
      manifest: {
        name: "Soarin' Steve",
        short_name: "Soarin' Steve",
        description: "Pack the powder, fire the cannon, and watch Soarin' Steve fly across the city.",
        theme_color: '#0f1b3d',
        background_color: '#0f1b3d',
        display: 'fullscreen',
        orientation: 'any',
        start_url: './',
        scope: './',
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,png,svg,woff2}'],
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
      },
    }),
  ],
});
