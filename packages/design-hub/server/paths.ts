/// <reference types="node" />
// Where things are, computed once. The project is the folder that installed
// design-hub: the nearest ancestor of the working directory whose package.json
// depends on it, or $DESIGN_HUB_ROOT. The scripts, the hooks and the dev
// server resolve every path from here, never from the current directory, so a
// hook run from the repo root and a script run from a subfolder behave the same.
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEP = '@milesroxas/design-hub';

function dependsOnHub(dir: string): boolean {
  const file = join(dir, 'package.json');
  if (!existsSync(file)) return false;
  try {
    const pkg = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Record<string, string> | undefined>;
    return Boolean(pkg.dependencies?.[DEP] ?? pkg.devDependencies?.[DEP]);
  } catch {
    return false;
  }
}

/** The project folder for a path inside it, or null when no ancestor installed design-hub. */
export function findProject(from: string): string | null {
  let dir = resolve(from);
  for (;;) {
    if (dependsOnHub(dir)) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/** The project: $DESIGN_HUB_ROOT, else the nearest project above the working directory, else the working directory. */
export function projectRoot(
  env: Record<string, string | undefined> = process.env,
  cwd = process.cwd(),
): string {
  const root = env.DESIGN_HUB_ROOT ? resolve(env.DESIGN_HUB_ROOT) : (findProject(cwd) ?? resolve(cwd));
  // Real, so a file path a hook hands over compares with it whatever symlink it came through.
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

export const ROOT = projectRoot();
/** One folder per prototype. */
export const PROTOTYPES = join(ROOT, 'prototypes');
/** The project's materials: tokens, the shell's chrome, its icons. */
export const KIT = join(ROOT, 'kit');
export const DOCS = join(ROOT, 'docs');
export const SKILLS = join(ROOT, '.claude', 'skills');
/** Local state, gitignored but for checks.json: the Jev log and its labels, the dev review store. */
export const STATE_DIR = join(ROOT, '.design-hub');
export const CHECKS_FILE = join(STATE_DIR, 'checks.json');

/** The nearest ancestor of `from` whose package.json names this package, so source and dist agree. */
export function packageRoot(from: string): string {
  let dir = dirname(from);
  for (;;) {
    const file = join(dir, 'package.json');
    if (existsSync(file)) {
      try {
        if ((JSON.parse(readFileSync(file, 'utf8')) as { name?: string }).name === DEP) return dir;
      } catch {
        // Not ours; keep climbing.
      }
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`design-hub's package.json is not above ${from}.`);
    dir = parent;
  }
}

/** This package on disk, wherever it is installed: the shell, the kit, the templates, the skills. */
export const PACKAGE = packageRoot(fileURLToPath(import.meta.url));
export const SHELL = join(PACKAGE, 'shell');
export const PACKAGE_KIT = join(PACKAGE, 'kit');
export const TEMPLATES = join(PACKAGE, 'templates');
export const PACKAGE_SKILLS = join(PACKAGE, 'skills');
