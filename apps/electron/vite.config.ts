import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

const PRODUCTION_RAILWAY_URL = 'https://campus-quest-backend-production-8cee.up.railway.app';

export default defineConfig({
  define: {
    'import.meta.env.VITE_API_URL': JSON.stringify(process.env.VITE_API_URL || PRODUCTION_RAILWAY_URL),
    'import.meta.env.VITE_SOCKET_URL': JSON.stringify(process.env.VITE_SOCKET_URL || PRODUCTION_RAILWAY_URL),
  },
  plugins: [
    react(),
    electron([
      {
        entry: 'src/main/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/main',
            minify: false,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
      {
        entry: 'src/preload/index.ts',
        vite: {
          build: {
            outDir: 'dist-electron/preload',
            minify: false,
            rollupOptions: {
              external: ['electron'],
            },
          },
        },
      },
    ]),
    renderer(),
  ],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
});
