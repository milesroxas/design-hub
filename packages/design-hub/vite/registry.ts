/// <reference types="node" />
// `virtual:design-hub/registry`: the project's prototypes and walkthroughs as
// a module the hub imports. The hub's own code lives in this package, so it
// cannot glob the project; this plugin scans the project's folders instead
// and writes the imports the browser index and the loader need, each on an
// absolute path. A folder that appears or disappears invalidates the module
// and reloads the page, so a new prototype shows without a restart.
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';
import { SLUG } from '../core/feature.ts';

const REGISTRY_ID = 'virtual:design-hub/registry';
const RESOLVED = `\0${REGISTRY_ID}`;

const dirs = (parent: string) =>
  existsSync(parent)
    ? readdirSync(parent, { withFileTypes: true })
        .filter((d) => d.isDirectory() && SLUG.test(d.name))
        .map((d) => d.name)
        .sort()
    : [];

/** The prototype folders: kebab-case, with a README. `guide` is the walkthrough route, never a prototype. */
export const prototypeSlugs = (prototypes: string) =>
  dirs(prototypes).filter((slug) => slug !== 'guide' && existsSync(join(prototypes, slug, 'README.md')));

/** The features with a walkthrough at docs/sprints/<feature>/guide.md. */
export const guideFeatures = (sprints: string) =>
  dirs(sprints).filter((feature) => existsSync(join(sprints, feature, 'guide.md')));

const entry = (key: string, path: string, query = '') =>
  `  ${JSON.stringify(key)}: () => import(${JSON.stringify(path + query)}),`;

export function registrySource(root: string): string {
  const prototypes = join(root, 'prototypes');
  const sprints = join(root, 'docs', 'sprints');
  const slugs = prototypeSlugs(prototypes);
  const readmes = slugs.map(
    (slug, i) => `import readme${i} from ${JSON.stringify(`${join(prototypes, slug, 'README.md')}?raw`)};`,
  );
  const modules = slugs
    .filter((slug) => existsSync(join(prototypes, slug, 'index.tsx')))
    .map((slug) => entry(slug, join(prototypes, slug, 'index.tsx')));
  const guides = guideFeatures(sprints).map((feature) =>
    entry(feature, join(sprints, feature, 'guide.md'), '?doc'),
  );
  return [
    ...readmes,
    `export const readmes = {\n${slugs.map((slug, i) => `  ${JSON.stringify(slug)}: readme${i},`).join('\n')}\n};`,
    `export const modules = {\n${modules.join('\n')}\n};`,
    `export const guideDocs = {\n${guides.join('\n')}\n};`,
    '',
  ].join('\n');
}

const REGISTRY_FILE = /\/(README\.md|index\.tsx|guide\.md)$/;

export function registry(root: string): Plugin {
  const prototypes = join(root, 'prototypes');
  const sprints = join(root, 'docs', 'sprints');
  return {
    name: 'design-hub-registry',
    resolveId(id) {
      return id === REGISTRY_ID ? RESOLVED : null;
    },
    load(id) {
      return id === RESOLVED ? registrySource(root) : null;
    },
    configureServer(server) {
      server.watcher.add([prototypes, sprints]);
      const refresh = (path: string) => {
        if (!path.startsWith(prototypes) && !path.startsWith(sprints)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      // A folder coming or going, or one of the three files the registry lists, changes what the index shows.
      server.watcher.on('addDir', refresh);
      server.watcher.on('unlinkDir', refresh);
      server.watcher.on('add', (path) => REGISTRY_FILE.test(path) && refresh(path));
      server.watcher.on('unlink', (path) => REGISTRY_FILE.test(path) && refresh(path));
    },
  };
}
