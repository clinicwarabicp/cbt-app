import { defineConfig } from 'vite';
import preact from '@preact/preset-vite';
import basicSsl from '@vitejs/plugin-basic-ssl';
import { VitePWA } from 'vite-plugin-pwa';

// --mode https で自己署名HTTPS+LAN公開(実機テスト用)
// GitHub Pages公開時は環境変数 PAGES_BASE(例 /cbt-app/)を指定してビルドする
export default defineConfig(({ mode }) => ({
  base: process.env.PAGES_BASE ?? '/',
  plugins: [
    preact(),
    ...(mode === 'https' ? [basicSsl()] : []),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['apple-touch-icon.png'],
      manifest: {
        name: 'CBT記録',
        short_name: 'CBT記録',
        description: 'CBTワークシートの記録(データは端末内のみに保存)',
        lang: 'ja',
        start_url: '.',
        scope: '.',
        display: 'standalone',
        background_color: '#f6f7f9',
        theme_color: '#2563eb',
        icons: [
          { src: 'pwa-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'pwa-512.png', sizes: '512x512', type: 'image/png' },
        ],
      },
    }),
  ],
  server: { port: 5173 },
  optimizeDeps: { exclude: ['@cbt/core'] },
}));
