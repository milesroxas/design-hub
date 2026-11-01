/// <reference types="node" />
// `virtual:design-hub/lapse`: the Lapse panel when the project has installed
// @aiforui/lapse, else nothing. Lapse lives on a private registry, so the hub
// never depends on it: a project opts in with `pnpm add -D @aiforui/lapse`
// and ?lapse loads it from the project's node_modules. The build always gets
// the empty module, since Lapse is a dev tool and Rollup must not resolve it
// on Vercel.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const LAPSE_ID = 'virtual:design-hub/lapse';
const RESOLVED = `\0${LAPSE_ID}`;
const LAPSE_PACKAGE = '@aiforui/lapse';
const LAPSE_PANEL = `${LAPSE_PACKAGE}/panel`;

/** Whether the project (never the hub) has Lapse installed. */
export const hasLapse = (root: string) =>
  existsSync(join(root, 'node_modules', ...LAPSE_PACKAGE.split('/'), 'package.json'));

/** The module's source: a re-export of the resolved panel, or a null mount. */
export function lapseSource(panel: string | null): string {
  return panel
    ? `export { mountLapse } from ${JSON.stringify(panel)};\n`
    : 'export const mountLapse = null;\n';
}

export function lapse(root: string): Plugin {
  let serve = false;
  return {
    name: 'design-hub-lapse',
    configResolved(config) {
      serve = config.command === 'serve';
    },
    resolveId(id) {
      return id === LAPSE_ID ? RESOLVED : null;
    },
    async load(id) {
      if (id !== RESOLVED) return null;
      if (!serve || !hasLapse(root)) return lapseSource(null);
      // Resolved from the project, so the package's exports map and pnpm's layout both apply.
      const panel = await this.resolve(LAPSE_PANEL, join(root, 'index.html'));
      return lapseSource(panel?.id ?? null);
    },
  };
}
