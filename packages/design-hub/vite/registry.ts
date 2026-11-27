/// <reference types="node" />
// `virtual:design-hub/registry`: the project's prototypes and walkthroughs as
// a module the hub imports. The hub's own code lives in this package, so it
// cannot glob the project; this plugin scans the project's folders instead.
//
// Each prototype is reached through its own entry module
// (`virtual:design-hub/entry/<slug>`): its README and a loader for its code.
// In a build each entry is its own file, `_p/<slug>/entry.js`, and every file
// built from the prototype lands beside it (vite/boundary.ts), so the gate
// refuses an internal prototype by path. The registry module then holds no
// slug at all: Studio's list of every slug is `_p/all.js`, which the gate
// never gives a Client, and an entry is fetched by its path. In dev there is
// no gate and the module keeps a map. A folder that appears or disappears
// invalidates the modules and reloads the page, so a new prototype shows
// without a restart.
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import postcss, { type Root } from 'postcss';
import { createIdResolver, type Environment, type Plugin, type ResolvedConfig, type Rolldown } from 'vite';
import { SLUG } from '../core/feature.ts';
import { ALL_FILE, entryFile, isPrototypeSlug, PROTOTYPE_DIR } from '../core/prototype.ts';
import { PACKAGE, PACKAGE_KIT, SHELL } from '../server/paths.ts';
import {
  crossImport,
  ENTRY_ID,
  fromRoot,
  looseFile,
  newUrlTargets,
  ownerOf,
  ownersOf,
  PREPROCESSED,
  placed,
  preprocessed,
  real,
  unreadable,
  workerRefused,
} from './boundary.ts';
import { type CssResolvers, cssBoundary, importRef, moduleRef } from './css-boundary.ts';
import { kitResolver } from './kit.ts';
import { leaks, type Written } from './leaks.ts';
import { type Owners, type SheetWrite, settle } from './settle.ts';

type PluginContext = Rolldown.PluginContext;

const REGISTRY_ID = 'virtual:design-hub/registry';
const RESOLVED = `\0${REGISTRY_ID}`;

const dirs = (parent: string) =>
  existsSync(parent)
    ? readdirSync(parent, { withFileTypes: true })
        .filter((d) => d.isDirectory() && SLUG.test(d.name))
        .map((d) => d.name)
        .sort()
    : [];

/** The prototype folders: kebab-case, with a README, and never one of the hub's own paths (core/prototype.ts). */
export const prototypeSlugs = (prototypes: string) =>
  dirs(prototypes).filter((slug) => isPrototypeSlug(slug) && existsSync(join(prototypes, slug, 'README.md')));

/** The features with a walkthrough at docs/sprints/<feature>/guide.md. */
export const guideFeatures = (sprints: string) =>
  dirs(sprints).filter((feature) => existsSync(join(sprints, feature, 'guide.md')));

const lazy = (key: string, id: string) => `  ${JSON.stringify(key)}: () => import(${JSON.stringify(id)}),`;

/** One prototype's entry: its README text, and a loader for its code when it has an index.tsx. */
export function entrySource(root: string, slug: string): string {
  const dir = join(root, 'prototypes', slug);
  const code = existsSync(join(dir, 'index.tsx'))
    ? [`export const load = () => import(${JSON.stringify(join(dir, 'index.tsx'))});`]
    : [];
  return [
    `export { default as readme } from ${JSON.stringify(`${join(dir, 'README.md')}?raw`)};`,
    ...code,
    '',
  ].join('\n');
}

export type Mode = 'serve' | 'build';

/** The package's own probe (core/prototype.ts), imported by the built registry. */
const PROBE = join(PACKAGE, 'core', 'prototype.ts');

/**
 * The registry module: `allSlugs()` and `entryOf(slug)`, both async, and
 * `guideDocs`. Served, a map of every entry. Built, no slug: `_p/all.js` and
 * `_p/<slug>/entry.js` are fetched by path from `base`, so the gate decides
 * who gets each.
 */
export function registrySource(root: string, mode: Mode = 'serve', base = '/'): string {
  const sprints = join(root, 'docs', 'sprints');
  const guides = guideFeatures(sprints).map((feature) =>
    lazy(feature, `${join(sprints, feature, 'guide.md')}?doc`),
  );
  const guideDocs = `export const guideDocs = {\n${guides.join('\n')}\n};`;
  if (mode === 'build')
    return [
      // A path in a variable, so Rolldown leaves the import to the browser.
      'const at = (path) => import(/* @vite-ignore */ path);',
      `export const allSlugs = () => at(${JSON.stringify(base + ALL_FILE)}).then((m) => m.slugs);`,
      // The gate answers 404 for a prototype this person may not open, and the host its page for one not built: neither is there.
      `import { probeEntry } from ${JSON.stringify(PROBE)};`,
      `const dir = ${JSON.stringify(`${base}${PROTOTYPE_DIR}/`)};`,
      'export const entryOf = async (slug) => {',
      '  const path = dir + slug + "/entry.js";',
      '  return (await probeEntry(path, fetch)) ? at(path) : null;',
      '};',
      guideDocs,
      '',
    ].join('\n');
  const slugs = prototypeSlugs(join(root, 'prototypes'));
  return [
    `const entries = {\n${slugs.map((slug) => lazy(slug, ENTRY_ID + slug)).join('\n')}\n};`,
    'export const allSlugs = async () => Object.keys(entries);',
    'export const entryOf = async (slug) => (Object.hasOwn(entries, slug) ? entries[slug]() : null);',
    guideDocs,
    '',
  ].join('\n');
}

/** The source of Studio's list of every slug, `_p/all.js`. */
export const allSource = (slugs: string[]) => `export const slugs = ${JSON.stringify(slugs)};\n`;

/** Who decides a reach: the project, owners on real paths, and which owners are prototypes. */
type Judge = {
  root: string;
  owner: (id: string) => string | null;
  isPrototype: (owner: string) => boolean;
  isBuild: () => boolean;
  /** An asset's original file, which Rolldown names relative to Vite's root. */
  inRoot: (file: string) => string;
  /** Whether a file is one the project writes and the build checks: a prototype's, or in the project's kit/. */
  authored: (file: string) => boolean;
};

/** The hub's page: Vite's importer for every URL a browser asks for in dev, and for each entry. */
const HUB_HTML = join(SHELL, 'index.html');

/** A prototype's import of a sheet the hub itself loads, answered once the hub's graph is known. */
const HUB_SHEET = '\0design-hub-hub-sheet:';

/** Every module the hub's entry loads statically: on every page, before any prototype. */
async function hubGraph(ctx: PluginContext): Promise<Set<string>> {
  const seen = new Set<string>();
  const stack = [join(SHELL, 'main.tsx')];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id)) continue;
    seen.add(id);
    const info = await ctx.load({ id, resolveDependencies: true });
    stack.push(...info.importedIds);
  }
  return seen;
}

/**
 * What is wrong with `importer` reaching `file`, or null: a file in
 * prototypes/ outside any prototype's folder, or another owner's prototype
 * file (for the kit and the hub, any prototype's). The registry's own virtual
 * modules load prototypes by design.
 */
function reachProblem(j: Judge, importer: string, file: string): string | null {
  const to = j.owner(file);
  if (to === null) return null;
  if (!j.isPrototype(to)) return looseFile(j.root, importer, file);
  const from = j.owner(importer);
  if (from === to || (from === null && importer.startsWith('\0virtual:design-hub/'))) return null;
  return crossImport(j.root, importer, file, from !== null);
}

const SCRIPT = /\.(m?[jt]sx?|vue|svelte)$/;
/** Vite's own test for a `?raw` import (`rawRE`): the file's text, never compiled. */
const RAW = /(\?|&)raw(?:&|$)/;
/** Plain CSS the build parses itself: what postcss reads before any preprocessor. */
const PLAIN_CSS = /\.(css|pcss|postcss)$/;
const inNodeModules = (id: string) => id.includes('/node_modules/');

/** Where a `new URL` path points on disk: relative to the module, else through the resolver; null for the public folder. */
async function urlTarget(ctx: PluginContext, url: string, id: string): Promise<string | null> {
  const path = url.split(/[?#]/)[0];
  if (path.startsWith('.')) return resolve(dirname(id.replace(/\?.*$/, '')), path);
  return (await ctx.resolve(path, id, { skipSelf: true }))?.id ?? null;
}

/**
 * The boundary in dev and in a build, on real paths: any import (whoever
 * imports) into a prototype it does not own, or into prototypes/ outside any
 * prototype; any `new URL(…, import.meta.url)` that does (Vite answers those,
 * `?inline` included, without asking the plugins); and a stylesheet the
 * build cannot parse. Reaches inside a stylesheet are the postcss plugin's
 * (vite/css-boundary.ts); every built file read across owners is
 * vite/settle.ts's.
 */
function prototypeBoundary(j: Judge, loaded: Set<string>): Plugin {
  let hub: Promise<Set<string>> | null = null;
  return {
    name: 'design-hub-prototype-boundary',
    enforce: 'pre',
    buildStart() {
      hub = null;
      loaded.clear();
    },
    async resolveId(source, importer, options) {
      // Not a reach: no importer; the hub's index.html, which Vite names as the importer of every URL a
      // browser asks for in dev and of every entry; or the dependency scan, which resolves each
      // prototype's index.tsx from that page.
      if (!importer || importer === HUB_HTML || (options as { scan?: boolean }).scan) return null;
      if (inNodeModules(importer) && j.owner(importer) === null) return null;
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      if (!resolved || resolved.external) return resolved;
      const problem = reachProblem(j, importer, resolved.id);
      if (problem) this.error(problem);
      const file = resolved.id.replace(/\?.*$/, '');
      // Read as text (`?raw`), a preprocessor file is never compiled, so nothing it imports is resolved.
      if (PREPROCESSED.test(file) && !RAW.test(resolved.id) && j.authored(importer))
        this.error(preprocessed(j.root, importer, file));
      // In a build, a prototype's import of a kit or hub sheet goes through a stand-in, so a sheet the
      // hub already loads on every page is not pulled out of the hub's own sheet into a shared chunk.
      if (
        j.isBuild() &&
        j.owner(importer) !== null &&
        j.owner(resolved.id) === null &&
        isSheetModule(resolved.id)
      )
        return `${HUB_SHEET}${resolved.id}.js`;
      return resolved;
    },
    async load(id) {
      // Every prototype file the build loads, `?raw` included: a pre plugin's load runs before Vite's own
      // loaders (vite:asset answers `?raw`), and this one never answers for a file.
      if (j.isBuild() && !id.startsWith('\0') && j.owner(id) !== null) loaded.add(id);
      if (!id.startsWith(HUB_SHEET)) return null;
      const sheet = id.slice(HUB_SHEET.length, -'.js'.length);
      hub ??= hubGraph(this);
      const from = JSON.stringify(sheet);
      // A CSS module's class names are what the prototype imports it for: always passed on.
      if (/\.module\.\w+$/.test(sheet)) return `export * from ${from};\nexport { default } from ${from};\n`;
      return (await hub).has(sheet) ? 'export {};' : `import ${from};`;
    },
    async transform(code, id) {
      const file = id.replace(/\?.*$/, '');
      if (id.startsWith('\0') || inNodeModules(file)) return null;
      // The file without its query (`./q.css?theme=dark` is q.css); the query decides whether it is a sheet.
      if (PLAIN_CSS.test(file) && !/[?&](?:raw|url|inline)\b/.test(id)) {
        let sheet: Root;
        try {
          sheet = postcss.parse(code, { from: file });
        } catch (error) {
          const e = error as { line?: number; column?: number; reason?: string; message: string };
          this.error(unreadable(j.root, file, e.line ?? 0, e.column ?? 0, e.reason ?? e.message));
        }
        if (j.authored(file)) await refusePreprocessed(this, j, sheet, file);
      }
      return null;
    },
  };
}

/**
 * A Sass, Less or Stylus file a stylesheet names by `@import`, `composes`,
 * `@value` or `:import`, refused before Vite hands it to the preprocessor.
 * Each is resolved as Vite resolves it; one that does not resolve is named as written.
 */
async function refusePreprocessed(ctx: PluginContext, j: Judge, sheet: Root, file: string) {
  const refs: string[] = [];
  sheet.walk((node) => {
    const ref = node.type === 'atrule' && node.name === 'import' ? importRef(node.params) : moduleRef(node);
    if (ref) refs.push(ref);
  });
  for (const ref of refs) {
    const target = ((await ctx.resolve(ref, file, { skipSelf: true }))?.id ?? ref).replace(/\?.*$/, '');
    if (PREPROCESSED.test(target)) ctx.error(preprocessed(j.root, file, target));
  }
}

/** The targets of a module's `new URL(…, import.meta.url)`, on disk. */
async function urlTargets(ctx: PluginContext, code: string, id: string): Promise<string[]> {
  const file = id.replace(/\?.*$/, '');
  if (id.startsWith('\0') || !SCRIPT.test(file)) return [];
  const targets: string[] = [];
  for (const url of newUrlTargets(code, file) ?? []) {
    const target = await urlTarget(ctx, url, id);
    if (target) targets.push(real(target));
  }
  return targets;
}

/**
 * `new URL(…, import.meta.url)` into a file another owner holds, `?inline`
 * included, refused in dev and in a build. A normal-order plugin, so it reads
 * the code Vite's own `new URL` plugin reads: TypeScript and JSX already
 * compiled, and Vite not yet answered.
 */
function urlBoundary(j: Judge): Plugin {
  return {
    name: 'design-hub-url-boundary',
    async transform(code, id) {
      // A package is skipped only when nobody owns it: one inside a prototype's folder is that prototype's.
      if (inNodeModules(id) && j.owner(id) === null) return null;
      for (const target of await urlTargets(this, code, id)) {
        const problem = reachProblem(j, id, target);
        if (problem) this.error(problem);
      }
      return null;
    },
  };
}

/**
 * The guard in every worker bundle, which Vite builds without the hub's
 * plugins: a module under prototypes/, reached any way (an import with any
 * query, a glob, a `new URL`), is refused before Vite's own plugins answer
 * it. What the bundle writes is recorded as the kit's only when every source
 * it has is outside prototypes/.
 */
function workerGuard(j: Judge, written: Set<string>): Plugin[] {
  const refuse = (ctx: { error(m: string): never }, id: string) => {
    if (j.owner(real(id.replace(/^\0/, '').replace(/\?.*$/, ''))) !== null)
      ctx.error(workerRefused(j.root, id));
  };
  const guard: Plugin = {
    name: 'design-hub-worker-guard',
    enforce: 'pre',
    async resolveId(source, importer, options) {
      const resolved = await this.resolve(source, importer, { ...options, skipSelf: true });
      refuse(this, resolved?.id ?? source);
      return resolved;
    },
    load(id) {
      refuse(this, id);
      return null;
    },
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        // An asset's original files are relative to Vite's root, not the project's.
        const sources = file.type === 'chunk' ? file.moduleIds : file.originalFileNames.map(j.inRoot);
        if (sources.length && sources.every((id) => j.owner(id) === null)) written.add(file.fileName);
      }
    },
  };
  // Normal order, so it reads the worker's code as Vite's own `new URL` plugin does.
  const urls: Plugin = {
    name: 'design-hub-worker-url-guard',
    async transform(code, id) {
      for (const target of await urlTargets(this, code, id)) refuse(this, target);
      return null;
    },
  };
  return [guard, urls];
}

// Vite's own tests (vite:css) for a stylesheet module that goes into a chunk's sheet: not one
// imported as ?inline, ?raw, ?url, a worker, transform-only or a CommonJS proxy.
const CSS_LANGS = /\.(css|less|sass|scss|styl|stylus|pcss|postcss|sss)(?:$|\?)/;
const SPECIAL_QUERY = /[?&](?:worker|sharedworker|raw|url)\b/;
const NOT_A_SHEET = [SPECIAL_QUERY, /[?&]inline\b/, /[?&]transform-only\b/, /[?&]commonjs-proxy/];
const isSheetModule = (id: string) =>
  !id.startsWith('\0') && CSS_LANGS.test(id) && !NOT_A_SHEET.some((re) => re.test(id));

const shortHash = (text: string) => createHash('sha256').update(text).digest('hex').slice(0, 6);

/**
 * The chunk group a kit or hub sheet goes into: one of its own, per file,
 * when only prototypes import it, so its sheet is the kit's alone and lives
 * once in assets/. A sheet the hub or the kit itself imports stays where it
 * is, so the hub's own sheet and its order never change.
 */
function kitSheetGroup(
  id: string,
  importers: readonly string[],
  owner: (id: string) => string | null,
): string | null {
  if (!isSheetModule(id) || owner(id) !== null) return null;
  const byPrototype = (i: string) => i.startsWith(HUB_SHEET) || owner(i) !== null;
  if (!importers.length || !importers.every(byPrototype)) return null;
  const file = id.replace(/^\0/, '').replace(/\?.*$/, '');
  return `kit-${basename(file, extname(file))}-${shortHash(file)}`;
}

/**
 * The order modules run in from `roots`: each module's static imports first,
 * in import order, then the module itself, as ES modules evaluate. A
 * stylesheet module's place in it is where dev applies its CSS.
 */
function runOrder(roots: readonly string[], info: (id: string) => { importedIds: readonly string[] } | null) {
  const order = new Map<string, number>();
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    for (const dep of info(id)?.importedIds ?? []) visit(dep);
    order.set(id, order.size);
  };
  for (const id of roots) visit(id);
  return order;
}

/**
 * A chunk's sheets in the order the source imports them, as dev applies
 * them, for kit and own sheets alike. Vite puts a chunk's own sheet before
 * the ones it moves onto it from CSS-only chunks, whatever the source said:
 * a kit sheet a prototype imports first, or a prototype's own sheet it shares
 * with a lazy module, would otherwise come after. Runs after Vite moves those
 * sheets and before it writes the preload lists (enforce 'post'). Only a
 * prototype's chunks: the hub's and the kit's keep the order Vite gives them,
 * so the hub's pages load what they loaded before.
 */
function sheetOrder(
  css: ReadonlyMap<string, readonly SheetWrite[]>,
  owner: (id: string) => string | null,
): Plugin {
  return {
    name: 'design-hub-sheet-order',
    enforce: 'post',
    apply: 'build',
    generateBundle(_, bundle) {
      for (const file of Object.values(bundle)) {
        if (file.type !== 'chunk' || !ownersOf(owner, file.moduleIds).length) continue;
        const sheets = (file as unknown as { viteMetadata?: { importedCss: Set<string> } }).viteMetadata
          ?.importedCss;
        if (!sheets || sheets.size < 2) continue;
        const roots = file.facadeModuleId ? [file.facadeModuleId] : file.moduleIds;
        const order = runOrder(roots, (id) => this.getModuleInfo(id));
        const place = (sheet: string) =>
          Math.min(
            Infinity,
            ...(css.get(sheet) ?? []).flatMap((w) => w.modules.map((id) => order.get(id) ?? Infinity)),
          );
        const ordered = [...sheets]
          .map((s, i) => ({ s, i, at: place(s) }))
          .sort((a, b) => a.at - b.at || a.i - b.i);
        sheets.clear();
        for (const { s } of ordered) sheets.add(s);
      }
    },
  };
}

export function registry(root: string): Plugin[] {
  const prototypes = join(root, 'prototypes');
  const sprints = join(root, 'docs', 'sprints');
  const owner = ownerOf(prototypes);
  const isPrototype = (o: string) => isPrototypeSlug(o) && existsSync(join(prototypes, o, 'README.md'));
  const projectKit = `${real(join(root, 'kit'))}/`;
  const judge: Judge = {
    root,
    owner,
    isPrototype,
    authored: (file) => owner(file) !== null || real(file.replace(/\?.*$/, '')).startsWith(projectKit),
    isBuild: () => config.command === 'build',
    inRoot: (file) => inRoot(file),
  };
  // Recorded as the build writes them, never inferred later from who reads a file.
  const css = new Map<string, SheetWrite[]>();
  const workers = new Set<string>();
  const loaded = new Set<string>();
  let config: Pick<ResolvedConfig, 'command' | 'base' | 'root'> = { command: 'serve', base: '/', root };
  const inRoot = (file: string) => fromRoot(config.root)(file);
  // Vite's own CSS resolvers, with the options its CSS plugin gives them, on the client environment.
  let cssResolvers: CssResolvers | null = null;
  let client: Environment | null = null;
  const onClient =
    (resolve: ReturnType<typeof createIdResolver>) =>
    (id: string, importer: string): Promise<string | undefined> =>
      client ? resolve(client, id, importer) : Promise.resolve(undefined);
  const main: Plugin = {
    name: 'design-hub-registry',
    // Named by what they hold: one prototype's chunks and assets under _p/<slug>/, everything shared in assets/.
    config: () => ({
      // Every stylesheet, whoever owns it, is read for reaches in Vite's own postcss run.
      css: {
        postcss: { plugins: [cssBoundary(root, owner, isPrototype, () => (client ? cssResolvers : null))()] },
      },
      // Vite builds a worker without the hub's plugins: the guard, and the kit resolver so a kit worker's
      // `@kit/*` imports are bundled, not left external.
      worker: {
        plugins: () => [...workerGuard(judge, workers), kitResolver(join(root, 'kit'), PACKAGE_KIT)],
      },
      build: {
        // Nothing a prototype owns is inlined: every reach leaves a file with a source the end-of-build check can see.
        assetsInlineLimit: (file: string) => (owner(file) !== null ? false : undefined),
        rolldownOptions: {
          output: {
            // A kit or hub sheet a prototype imports is a chunk of its own, so its sheet is the kit's alone
            // and lives once in assets/, never folded into the prototype's sheet.
            codeSplitting: {
              groups: [
                {
                  debugName: 'kit-sheet',
                  name: (
                    id: string,
                    ctx: { getModuleInfo(id: string): { importers: readonly string[] } | null },
                  ) => kitSheetGroup(id, ctx.getModuleInfo(id)?.importers ?? [], owner),
                },
              ],
            },
            chunkFileNames: (chunk) => placed(ownersOf(owner, chunk.moduleIds), '[name]-[hash].js'),
            assetFileNames: (asset) => {
              const sources = asset.originalFileNames.map(inRoot);
              const shared = sources.some((f) => owner(f) === null);
              return placed(ownersOf(owner, sources), '[name]-[hash][extname]', shared);
            },
          },
        },
      },
    }),
    configResolved(resolved) {
      config = resolved;
      cssResolvers = {
        // vite:css's resolver for url() and image-set().
        url: onClient(createIdResolver(resolved, { preferRelative: true, tryIndex: false, extensions: [] })),
        // Its resolver for @import, which postcss-modules also asks for composes, @value and :import.
        css: onClient(
          createIdResolver(resolved, {
            extensions: ['.css'],
            mainFields: ['style'],
            conditions: ['style', 'development|production'],
            tryIndex: false,
            preferRelative: true,
          }),
        ),
      };
    },
    resolveId(id) {
      if (id === REGISTRY_ID) return RESOLVED;
      return id.startsWith(ENTRY_ID) && isPrototypeSlug(id.slice(ENTRY_ID.length)) ? `\0${id}` : null;
    },
    load(id) {
      if (id === RESOLVED) return registrySource(root, config.command, config.base);
      return id.startsWith(`\0${ENTRY_ID}`) ? entrySource(root, id.slice(ENTRY_ID.length + 1)) : null;
    },
    buildStart() {
      if (this.environment.name === 'client') client = this.environment;
      if (config.command !== 'build') return;
      css.clear();
      workers.clear();
      const slugs = prototypeSlugs(prototypes);
      // preserveSignature: 'strict', or Rolldown empties an entry nothing else imports.
      for (const slug of slugs)
        this.emitFile({
          type: 'chunk',
          id: ENTRY_ID + slug,
          fileName: entryFile(slug),
          preserveSignature: 'strict',
        });
      this.emitFile({ type: 'asset', fileName: ALL_FILE, source: allSource(slugs) });
    },
    // After Vite's own renderChunk, while each chunk's importedCss still holds only its own sheet:
    // the sheet's CSS modules are its sources. Vite later moves a CSS-only chunk's sheet onto its importers.
    renderChunk: {
      order: 'post',
      handler(_, chunk) {
        const sheets = (chunk as unknown as { viteMetadata?: { importedCss: Set<string> } }).viteMetadata
          ?.importedCss;
        if (!sheets?.size) return null;
        const write: SheetWrite = {
          modules: chunk.moduleIds.filter(isSheetModule),
          writer: ownersOf(owner, chunk.moduleIds)[0] ?? null,
        };
        for (const sheet of sheets) css.set(sheet, [...(css.get(sheet) ?? []), write]);
        return null;
      },
    },
    // After Vite's own generateBundle work, so its preload lists are final:
    // every asset goes where its readers can reach it, then the build proves
    // its own boundary, and a file that breaks it fails the build.
    generateBundle: {
      order: 'post',
      handler(_, bundle) {
        const o: Owners = { owner, inRoot, slugs: prototypeSlugs(prototypes), root, css, workers };
        // Every file the bundle read, before settle moves or splits anything: a CSS-only chunk is gone by
        // now, so its stylesheet modules come from the sheet records, and a module no chunk holds (one a
        // plugin loaded with `this.load`) from the loads.
        const inputs = [
          ...loaded,
          ...Object.values(bundle).flatMap((f) =>
            f.type === 'chunk' ? f.moduleIds : f.originalFileNames.map(inRoot),
          ),
          ...[...css.values()].flatMap((writes) => writes.flatMap((w) => w.modules)),
        ];
        const copies = new Map<string, Written>();
        const problems = settle(bundle, o, (fileName, source) => {
          copies.set(fileName, { fileName, source });
          this.emitFile({ type: 'asset', fileName, source });
        });
        // Then what was written, whatever wrote it: no prototype's content outside its folder.
        if (!problems.length) {
          const written = new Map<string, Written>(
            Object.values(bundle).map((f) => [
              f.fileName,
              { fileName: f.fileName, source: f.type === 'chunk' ? f.code : f.source },
            ]),
          );
          for (const [name, copy] of copies) written.set(name, copy);
          problems.push(...leaks(root, prototypes, owner, inputs, [...written.values()]));
        }
        if (problems.length) this.error(`The prototype boundary does not hold:\n${problems.join('\n')}`);
      },
    },
    configureServer(server) {
      server.watcher.add([prototypes, sprints]);
      const refresh = (path: string) => {
        if (!path.startsWith(prototypes) && !path.startsWith(sprints)) return;
        for (const id of [RESOLVED, ...prototypeSlugs(prototypes).map((slug) => `\0${ENTRY_ID}${slug}`)]) {
          const mod = server.moduleGraph.getModuleById(id);
          if (mod) server.moduleGraph.invalidateModule(mod);
        }
        server.ws.send({ type: 'full-reload' });
      };
      // A folder coming or going, or one of the three files the registry lists, changes what the index shows.
      server.watcher.on('addDir', refresh);
      server.watcher.on('unlinkDir', refresh);
      server.watcher.on('add', (path) => REGISTRY_FILE.test(path) && refresh(path));
      server.watcher.on('unlink', (path) => REGISTRY_FILE.test(path) && refresh(path));
    },
  };
  return [prototypeBoundary(judge, loaded), urlBoundary(judge), main, sheetOrder(css, owner)];
}

const REGISTRY_FILE = /\/(README\.md|index\.tsx|guide\.md)$/;
