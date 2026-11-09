import { fileURLToPath, pathToFileURL } from 'node:url';
import { createServer } from 'vite';
import { createRequire } from 'node:module';

const requireFrontend = createRequire(new URL('../packages/frontend/package.json', import.meta.url));
const { default: react } = await import(pathToFileURL(requireFrontend.resolve('@vitejs/plugin-react-swc')).href);

export async function startPreview() {
  const server = await createServer({
    configFile: false,
    root: fileURLToPath(new URL('../packages/frontend', import.meta.url)),
    envDir: false,
    plugins: [{
      name: 'test-only-quizcrowd-connection',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './lib/rayfin-client' && importer?.replaceAll('\\', '/').endsWith('/src/App.tsx')) {
          return fileURLToPath(new URL('./fixtures/rayfin-client.mjs', import.meta.url));
        }
      },
    }, react()],
    resolve: { dedupe: ['react', 'react-dom'] },
    server: { host: '127.0.0.1', port: 5174, strictPort: true },
  });
  await server.listen();
  return server;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startPreview();
  server.printUrls();
}
