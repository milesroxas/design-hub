/// <reference types="node" />
// The prototypes on disk, read the way the browser index reads them (vite/registry.ts).
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { byIndexOrder, isLive, type Meta, readMeta } from '../../core/catalog.ts';
import { PROTOTYPES } from '../../server/paths.ts';

export type OnDisk = Meta & { dir: string };

export function prototypes(root = PROTOTYPES): OnDisk[] {
  return readdirSync(root, { withFileTypes: true })
    .filter(
      (d) =>
        d.isDirectory() && !d.name.startsWith('_') && !d.name.startsWith('.') && d.name !== 'node_modules',
    )
    .filter((d) => existsSync(join(root, d.name, 'README.md')))
    .map((d) => ({
      ...readMeta(d.name, readFileSync(join(root, d.name, 'README.md'), 'utf8')),
      dir: join(root, d.name),
    }))
    .sort(byIndexOrder);
}

/** The feature's live primary prototype, if it has one. */
export const primaryOf = (feature: string, all = prototypes()) =>
  all.find((p) => p.kind === 'sprint' && isLive(p) && p.feature === feature);
