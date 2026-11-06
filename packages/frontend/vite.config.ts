import react from '@vitejs/plugin-react-swc';
import { rayfinLocalDev } from '@microsoft/rayfin-local-dev/vite';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), rayfinLocalDev()],
  resolve: { dedupe: ['react', 'react-dom'] },
  server: { host: '127.0.0.1', strictPort: true, port: 5173 },
  build: { sourcemap: false },
});
