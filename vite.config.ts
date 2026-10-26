import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwind from '@tailwindcss/vite';
export default defineConfig({
  root: 'apps/web', plugins: [react(), tailwind()],
  build: { outDir: 'dist', emptyOutDir: true },
  server: { port: 5173, strictPort: true, proxy: { '/api': 'http://127.0.0.1:8787' } },
  preview: {port:5173,strictPort:true,host:'127.0.0.1',proxy:{'/api':'http://127.0.0.1:8787'}}
});
