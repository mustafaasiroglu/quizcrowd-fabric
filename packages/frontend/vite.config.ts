import react from '@vitejs/plugin-react-swc';
import { rayfinLocalDev } from '@microsoft/rayfin-local-dev/vite';
import { defineConfig } from 'vite';
import { staticRoutes } from './static-routes.ts';

export default defineConfig({
  plugins: [react(), rayfinLocalDev(), staticRoutes()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', strictPort: true, port: 5173 },
  build: { sourcemap: false },
});
