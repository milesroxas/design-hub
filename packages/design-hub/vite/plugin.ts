/// <reference types="node" />
// The Vite side of the hub. `design-hub dev` and `design-hub build` run Vite
// on this config: the hub's own index.html as the root, the project's
// prototypes reached through the registry module, the project's kit/ in
// front of the package's, the review API in dev, and the gate's font emitted
// where the gate serves it. A project keeps no vite.config.ts; one that wants
// its own can import `designHub` from '@milesroxas/design-hub/vite'.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import react from '@vitejs/plugin-react';
import type { InlineConfig, Plugin, PluginOption } from 'vite';
import { devReview } from '../server/dev.ts';
import { devPort, readEnv } from '../server/env.ts';
import { PACKAGE, PACKAGE_KIT, SHELL } from '../server/paths.ts';
import { GATE_FONT, gatePreview } from '../vercel/proxy.ts';
import { kitResolver } from './kit.ts';
import { lapse } from './lapse.ts';
import { markdownDocs } from './markdown.ts';
import { registry } from './registry.ts';

const require = createRequire(import.meta.url);

// The password page loads before sign-in, so it cannot reach the hashed
// bundle. Its font goes out at the one fixed path the gate lets through.
// `design-hub dev` has no gate, so there /_gate/ previews the page (?failed
// shows the wrong-password state).
const gateFontFile = () =>
  join(dirname(require.resolve('@fontsource-variable/geist')), 'files', 'geist-latin-wght-normal.woff2');

function gateFont(): Plugin {
  return {
    name: 'design-hub-gate-font',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: GATE_FONT.slice(1), source: readFileSync(gateFontFile()) });
    },
    configureServer(server) {
      server.middlewares.use(async (req, res, nextMiddleware) => {
        const url = new URL(req.url ?? '/', 'http://dev');
        if (url.pathname === GATE_FONT) {
          res.setHeader('content-type', 'font/woff2');
          res.end(readFileSync(gateFontFile()));
          return;
        }
        if (url.pathname !== '/_gate/') return nextMiddleware();
        const page = await gatePreview(url.searchParams.has('failed'));
        res.setHeader('content-type', 'text/html; charset=utf-8');
        res.setHeader('content-security-policy', page.csp);
        res.end(page.html);
      });
    },
  };
}

export type HubOptions = {
  /** The project: the folder with prototypes/, kit/ and docs/. */
  root: string;
};

/** Every plugin the hub needs, for a project that writes its own vite.config.ts. */
export function designHub({ root }: HubOptions): PluginOption[] {
  return [
    react(),
    kitResolver(join(root, 'kit'), PACKAGE_KIT),
    registry(root),
    lapse(root),
    markdownDocs(),
    devReview(),
    gateFont(),
  ];
}

/**
 * The whole config `design-hub dev` and `design-hub build` run on. One port per
 * project: Conductor's per-workspace port when it runs us, else the PORT
 * `design-hub bootstrap` wrote to .env. strictPort refuses a taken port rather
 * than drifting to the next one, because a fallback silently serves the wrong
 * project. A build needs no port, so Vercel builds without a .env.
 */
export function hubConfig({ root }: HubOptions, command: 'serve' | 'build'): InlineConfig {
  const port = devPort(readEnv(root));
  if (command === 'serve' && port === undefined)
    throw new Error(
      'PORT is not set. Run `design-hub bootstrap` once to pick a free port and write it to .env.',
    );
  return {
    configFile: false,
    root: SHELL,
    publicDir: join(SHELL, 'public'),
    envDir: root,
    cacheDir: join(root, 'node_modules', '.vite'),
    plugins: designHub({ root }),
    resolve: { dedupe: ['react', 'react-dom'] },
    optimizeDeps: { entries: [join(SHELL, 'index.html'), join(root, 'prototypes', '*', 'index.tsx')] },
    server: { port, strictPort: true, fs: { allow: [root, PACKAGE] } },
    preview: port === undefined ? undefined : { port, strictPort: true },
    build: { outDir: join(root, 'dist'), emptyOutDir: true },
  };
}
