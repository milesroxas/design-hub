/// <reference types="node" />
// `@kit/<name>` is the project's kit/ first and this package's kit/ second,
// so a project forks a kit piece by copying the file into kit/ under the same
// name and changing the copy: every import of it, the hub's included, then
// takes the project's. `design-hub/kit/<name>` always means the package's
// copy, for a project file that extends it (kit/icons.ts adds glyphs to the base set).
import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const KIT_PREFIX = '@kit/';
const PACKAGE_PREFIX = 'design-hub/kit/';
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
      if (id.startsWith(KIT_PREFIX))
        return findKitFile([projectKit, packageKit], id.slice(KIT_PREFIX.length));
      if (id.startsWith(PACKAGE_PREFIX)) return findKitFile([packageKit], id.slice(PACKAGE_PREFIX.length));
      return null;
    },
  };
}
