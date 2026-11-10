import type { Plugin } from 'vite';
import { screenPaths } from './src/lib/routes.ts';

// Physical entry points use documented directory indexes, not a host-specific SPA rewrite.
export function staticRoutes(): Plugin {
  return {
    name: 'quizcrowd-static-routes',
    enforce: 'post',
    generateBundle(_options, bundle) {
      const index = bundle['index.html'];
      if (!index || index.type !== 'asset') return;
      for (const path of [...screenPaths, 'library', 'quizzes']) {
        this.emitFile({ type: 'asset', fileName: `${path}/index.html`, source: index.source });
      }
    },
  };
}
