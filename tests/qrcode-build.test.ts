import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import { build } from 'vite';
import { expect, it } from 'vitest';

it('renders the QR component with the production frontend React resolution', async () => {
  const entry = 'virtual:quizcrowd-qr-regression';
  const result = await build({
    root: fileURLToPath(new URL('../packages/frontend', import.meta.url)),
    configFile: fileURLToPath(new URL('../packages/frontend/vite.config.ts', import.meta.url)),
    logLevel: 'silent',
    define: { 'process.env.NODE_ENV': JSON.stringify('production') },
    plugins: [{
      name: 'quizcrowd-qr-regression',
      resolveId: (id) => id.endsWith(entry) ? `\0${entry}` : undefined,
      load: (id) => id === `\0${entry}` ? `
        import { createElement } from 'react';
        import { renderToStaticMarkup } from 'react-dom/server.browser';
        import { QRCodeSVG } from 'qrcode.react';
        export function renderQR() {
          return renderToStaticMarkup(createElement(QRCodeSVG, {
            value: 'https://quizcrowd-test.invalid/?quiz=regression', size: 160
          }));
        }
      ` : undefined,
    }],
    build: {
      write: false, minify: false,
      lib: { entry, name: 'QRCodeSmoke', formats: ['iife'], fileName: () => 'qr-regression.js' },
    },
  });
  const bundle = Array.isArray(result) ? result[0] : result;
  if (!bundle || !('output' in bundle)) throw new Error('Expected a frontend bundle.');
  const chunk = bundle.output.find((output) => output.type === 'chunk');
  if (!chunk) throw new Error('QR regression bundle was not generated.');
  const scope: {
    QRCodeSmoke?: { renderQR(): string };
    TextEncoder: typeof TextEncoder;
    TextDecoder: typeof TextDecoder;
    MessageChannel: typeof MessageChannel;
    ReadableStream: typeof ReadableStream;
    setTimeout: typeof setTimeout;
    clearTimeout: typeof clearTimeout;
  } = { TextEncoder, TextDecoder, MessageChannel, ReadableStream, setTimeout, clearTimeout };
  runInNewContext(chunk.code, scope);
  expect(scope.QRCodeSmoke?.renderQR()).toMatch(/^<svg[^>]*width="160"/);
}, 20000);
