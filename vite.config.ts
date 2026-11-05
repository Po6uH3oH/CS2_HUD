import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({
  root: 'apps/web', plugins: [react()], publicDir: '../../assets',
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:3190', '/ws': { target: 'ws://127.0.0.1:3190', ws: true }, '/uploads': 'http://127.0.0.1:3190', '/assets': 'http://127.0.0.1:3190' } },
  build: { outDir: '../../dist/web', emptyOutDir: true }
});
