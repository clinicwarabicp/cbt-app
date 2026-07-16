import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import basicSsl from '@vitejs/plugin-basic-ssl';

// --mode https で自己署名HTTPS+LAN公開(iPad実機テスト用。カメラはセキュアコンテキスト必須)
export default defineConfig(({ mode }) => ({
  plugins: [react(), ...(mode === 'https' ? [basicSsl()] : [])],
  server: { port: 5174 },
  optimizeDeps: { exclude: ['@cbt/core'] },
}));
