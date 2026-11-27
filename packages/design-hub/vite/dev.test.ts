/// <reference types="node" />
// `design-hub dev` on a small project with a cold dependency cache: the
// dependency scan runs without a failure logged (it resolves every
// prototype's index.tsx from shell/index.html, which is not a reach), and the
// registry module and a prototype's entry load. The project is a folder of
// its own, set as the project root before the hub's code is loaded, so the
// dev server's local review store is written there and nowhere else.
import assert from 'node:assert/strict';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer as listenOn } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, test } from 'node:test';
import { createLogger, createServer, type ViteDevServer } from 'vite';

const root = mkdtempSync(join(tmpdir(), 'hub-dev-'));
let server: ViteDevServer | undefined;

after(async () => {
  await server?.close();
  rmSync(root, { recursive: true, force: true });
});

const cache = () => join(root, 'node_modules', '.vite');
const busy = () => existsSync(cache()) && readdirSync(cache()).some((name) => name.startsWith('deps_temp'));

/** Until the optimizer is done: the scan, every dependency it found, and no deps_temp_* folder being written. */
async function optimized(dev: ViteDevServer) {
  const optimizer = dev.environments.client.depsOptimizer;
  await optimizer?.scanProcessing;
  const discovered = Object.values(optimizer?.metadata.discovered ?? {});
  await Promise.all(discovered.map((dep) => dep.processing));
  for (let i = 0; i < 300 && (busy() || !existsSync(join(cache(), 'deps', '_metadata.json'))); i++)
    await new Promise((done) => setTimeout(done, 100));
  assert.ok(!busy(), 'the optimizer finished');
}

/** A port nothing holds. */
const freePort = () =>
  new Promise<number>((done) => {
    const probe = listenOn().listen(0, () => {
      const { port } = probe.address() as { port: number };
      probe.close(() => done(port));
    });
  });

function project(templates: string) {
  mkdirSync(join(root, 'kit'), { recursive: true });
  writeFileSync(join(root, 'kit', 'tokens.css'), ':root { --t: 1; }\n');
  const dir = join(root, 'prototypes', 'alpha-proto');
  cpSync(join(templates, 'space'), dir, { recursive: true });
  for (const name of readdirSync(dir)) {
    const text = readFileSync(join(dir, name), 'utf8')
      .replaceAll('{{title}}', 'Alpha')
      .replaceAll('{{slug}}', 'alpha-proto')
      .replaceAll('{{created}}', '2030-01-01')
      .replaceAll('{{kind}}', 'exploration')
      .replaceAll('{{feature}}', '')
      .replaceAll('{{track}}', 'product');
    writeFileSync(join(dir, name), text);
  }
}

test('the dev server starts cold with no dependency-scan failure, and serves the registry and an entry', async () => {
  process.env.DESIGN_HUB_ROOT = root;
  process.env.DESIGN_HUB_PORT = String(await freePort());
  const { TEMPLATES } = await import('../server/paths.ts');
  const { hubConfig } = await import('./plugin.ts');
  project(TEMPLATES);
  const logged: string[] = [];
  const logger = createLogger('info');
  logger.error = (message) => {
    logged.push(message);
  };
  logger.warn = (message) => {
    logged.push(message);
  };
  server = await createServer({ ...hubConfig({ root }, 'serve'), customLogger: logger });
  await server.listen();
  const base = `http://localhost:${server.config.server.port}`;
  // No retry: a 504 is Vite saying it optimized a dependency after the scan, which an export cannot recover from.
  const get = async (path: string) => {
    const response = await fetch(base + path);
    return { status: response.status, text: await response.text() };
  };
  await optimized(server);
  const registry = await get('/@id/__x00__virtual:design-hub/registry');
  assert.equal(registry.status, 200, registry.text.slice(0, 800));
  assert.match(registry.text, /"alpha-proto": \(\) => import\(/);
  const entry = await get('/@id/__x00__virtual:design-hub/entry/alpha-proto');
  assert.equal(entry.status, 200);
  assert.match(entry.text, /export const load = \(\) => import\(/);
  const index = await get(`/@fs${join(root, 'prototypes', 'alpha-proto', 'index.tsx')}`);
  assert.equal(index.status, 200, index.text.slice(0, 1500) + logged.join('\n').slice(0, 1500));
  assert.match(index.text, /react/);
  assert.deepEqual(
    logged.filter((m) => /dependency scan|prototype's file|Pre-transform error/i.test(m)),
    [],
  );
  // Nothing left running when the server closes: the folder goes with no deps_temp_* behind.
  await server.waitForRequestsIdle();
  await optimized(server);
});

test('in dev a prototype importing Sass is refused, naming the file and saying to use plain CSS', async () => {
  assert.ok(server, 'the dev server from the test above');
  const dir = join(root, 'prototypes', 'beta-proto');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), readFileSync(join(root, 'prototypes', 'alpha-proto', 'README.md')));
  writeFileSync(join(dir, 'x.scss'), '.x { color: red; }\n');
  writeFileSync(join(dir, 'index.tsx'), "import './x.scss';\nexport default function P() { return null; }\n");
  const response = await fetch(`http://localhost:${server.config.server.port}/@fs${join(dir, 'index.tsx')}`);
  const text = await response.text();
  assert.equal(response.status, 500, text.slice(0, 400));
  assert.match(
    text,
    /prototypes\/beta-proto\/index\.tsx imports prototypes\/beta-proto\/x\.scss\. Sass, Less and Stylus are refused/,
  );
  assert.match(text, /Use plain CSS or \.pcss/);
});
