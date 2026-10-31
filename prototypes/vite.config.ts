import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import { devReview } from './_server/dev.ts';
import { devPort } from './_server/env.ts';
import { markdownDocs } from './_shell/markdown.ts';
import { GATE_FONT, gatePreview } from './proxy.ts';

// The password page loads before sign-in, so it cannot reach the hashed
// bundle. Its font goes out at the one fixed path proxy.ts lets through.
// `pnpm dev` has no gate, so there /_gate/ previews the page (?failed shows
// the wrong-password state).
const GATE_FONT_FILE = new URL(
  './node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
  import.meta.url,
);
const gateFont = (): Plugin => ({
  name: 'gate-font',
  generateBundle() {
    this.emitFile({ type: 'asset', fileName: GATE_FONT.slice(1), source: readFileSync(GATE_FONT_FILE) });
  },
  configureServer(server) {
    server.middlewares.use(async (req, res, nextMiddleware) => {
      const url = new URL(req.url ?? '/', 'http://dev');
      if (url.pathname === GATE_FONT) {
        res.setHeader('content-type', 'font/woff2');
        res.end(readFileSync(GATE_FONT_FILE));
        return;
      }
      if (url.pathname !== '/_gate/') return nextMiddleware();
      const page = await gatePreview(url.searchParams.has('failed'));
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.setHeader('content-security-policy', page.csp);
      res.end(page.html);
    });
  },
});

// One port per project: Conductor's per-workspace port when it runs us, else
// the PORT `pnpm bootstrap` wrote to .env. strictPort refuses a taken port
// rather than drifting to the next one, because a fallback silently serves
// the wrong project. A build needs no port, so Vercel builds without a .env.
export default defineConfig(({ command, mode }) => {
  const port = devPort(loadEnv(mode, process.cwd(), ''));
  if (command === 'serve' && port === undefined) {
    throw new Error('PORT is not set. Run `pnpm bootstrap` once to pick a free port and write it to .env.');
  }
  return {
    plugins: [react(), markdownDocs(), devReview(), gateFont()],
    resolve: { alias: { '@kit': '/_kit' } },
    server: { port, strictPort: true, fs: { allow: ['..'] } },
    preview: port === undefined ? undefined : { port, strictPort: true },
  };
});
