/// <reference types="node" />
// The executables this package brings a project (tsc, biome), found from
// where Node resolves the package, so a project installs neither and pnpm's
// layout never matters. A package's exports map may hide its bin and its
// package.json, so the folder is found by walking up from its entry point.
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const require = createRequire(import.meta.url);

/** The folder of an installed package, searched the way Node searches, so an exports map never hides it. */
export function packageDir(name: string): string {
  for (const dir of require.resolve.paths(name) ?? []) {
    const candidate = join(dir, name);
    if (existsSync(join(candidate, 'package.json'))) return candidate;
  }
  throw new Error(`${name} is not installed beside design-hub.`);
}

export const tscBin = () => join(packageDir('typescript'), 'bin', 'tsc');
export const biomeBin = () => join(packageDir('@biomejs/biome'), 'bin', 'biome');
