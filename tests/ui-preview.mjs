import { fileURLToPath, pathToFileURL } from 'node:url';
import { build } from 'vite';
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { staticRoutes } from '../packages/frontend/static-routes.ts';

const requireFrontend = createRequire(new URL('../packages/frontend/package.json', import.meta.url));
const { default: react } = await import(pathToFileURL(requireFrontend.resolve('@vitejs/plugin-react-swc')).href);

export async function startPreview() {
  const result = await build({
    configFile: false,
    root: fileURLToPath(new URL('../packages/frontend', import.meta.url)),
    envDir: false,
    logLevel: 'error',
    plugins: [{
      name: 'test-only-quizcrowd-connection',
      enforce: 'pre',
      resolveId(source, importer) {
        if (source === './lib/rayfin-client' && importer?.replaceAll('\\', '/').endsWith('/src/App.tsx')) {
          return fileURLToPath(new URL('./fixtures/rayfin-client.mjs', import.meta.url));
        }
      },
    }, react(), staticRoutes()],
    resolve: { dedupe: ['react', 'react-dom'] },
    build: { write: false },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  const files = new Map(bundle.output.map(file => [file.fileName, file.type === 'chunk' ? file.code : file.source]));
  const server = createServer((request, response) => {
    let path = new URL(request.url, 'http://127.0.0.1:5174').pathname.slice(1);
    if (!path || path.endsWith('/')) path += 'index.html';
    else if (files.has(`${path}/index.html`)) path += '/index.html';
    const body = files.get(path);
    response.writeHead(body === undefined ? 404 : 200, {
      'Content-Type': path.endsWith('.html') ? 'text/html' : path.endsWith('.js') ? 'text/javascript' : path.endsWith('.css') ? 'text/css' : 'text/plain',
      'Cache-Control': 'no-store',
    });
    response.end(body ?? 'Not found');
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(5174, '127.0.0.1', resolve);
  });
  return {
    close: () => new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())),
    printUrls: () => console.log('Local static preview (test fixtures, no SPA fallback): http://127.0.0.1:5174'),
  };
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startPreview();
  server.printUrls();
}
