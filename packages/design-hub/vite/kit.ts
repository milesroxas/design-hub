/// <reference types="node" />
// `@kit/<name>` is the project's kit/ first and this package's kit/ second,
// so a project forks a kit piece by copying the file into kit/ under the same
// name and changing the copy: every import of it, the hub's included, then
// takes the project's. `@milesroxas/design-hub/kit/<name>` always means the package's
// copy, for a project file that extends it (kit/icons.ts adds glyphs to the base set).
import { existsSync, realpathSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const KIT_PREFIX = '@kit/';
const PACKAGE_PREFIX = '@milesroxas/design-hub/kit/';
/** Vite's own test for a `?url` import (`urlRE`). */
const URL_QUERY = /(\?|&)url(?:&|$)/;
const CANDIDATES = ['', '.ts', '.tsx', '.css', '.json', '/index.ts', '/index.tsx'];

const isFile = (path: string) => existsSync(path) && statSync(path).isFile();

/** The file `@kit/<rest>` names in the first of `dirs` that has it, or null. */
export function findKitFile(dirs: string[], rest: string): string | null {
  for (const dir of dirs)
    for (const ext of CANDIDATES) {
      const path = join(dir, rest + ext);
      if (isFile(path)) return path;
    }
  return null;
}

export function kitResolver(projectKit: string, packageKit: string): Plugin {
  return {
    name: 'design-hub-kit',
    enforce: 'pre',
    resolveId(id) {
      // A query (`?worker`, `?url`) rides along on the file it finds.
      const [path, query] = id.split(/(?=\?)/);
      const found = path.startsWith(KIT_PREFIX)
        ? findKitFile([projectKit, packageKit], path.slice(KIT_PREFIX.length))
        : path.startsWith(PACKAGE_PREFIX)
          ? findKitFile([packageKit], path.slice(PACKAGE_PREFIX.length))
          : null;
      // `?url` on its real path: Vite turns it into `?transform-only` and resolves that itself, on the
      // real path, so both must name one module. Anything else keeps the path in kit/, so a kit/ linked
      // from outside the project still resolves the project's own dependencies (`motion/react`).
      const file = found && (query && URL_QUERY.test(query) ? realpathSync(found) : found);
      return file && query ? file + query : file;
    },
  };
}
