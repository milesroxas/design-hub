/// <reference types="node" />
// The prototype boundary inside a stylesheet. `@import` and `composes`
// inline another file's CSS, which leaves no built file behind for the
// end-of-build check (vite/settle.ts) to see, and Vite resolves `url()`
// itself. So the plugin adds this to Vite's own postcss run, where it sees
// every stylesheet whoever owns it (a prototype's, the kit's, the hub's), in
// dev and in a build, after `@import` is inlined: each node still carries the
// file it came from, at any depth. Owners are decided on real paths, so a
// symlink into another prototype's folder is that prototype's.
//
// Only values that are references count: `@import`, `url()`, the strings in
// `image-set()`, and in a CSS module `composes … from`, `@value … from` and `:import("…")`. A string in `content:` is text.
// Comments never count: postcss keeps them apart. Each reference is followed
// as a path and as Vite resolves it (vite/registry.ts hands over Vite's own
// resolvers), so an alias or a package path into a prototype's folder counts.
import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import postcss, { type ChildNode, type Node, type PluginCreator, type Root } from 'postcss';
import { crossImport, looseFile, real } from './boundary.ts';

type Owner = (id: string) => string | null;

const URL_REF = /url\(\s*(["']?)([^"')]*?)\1\s*\)/g;
const IMAGE_SET = /(?:-webkit-)?image-set\(([^;]*)\)/g;
const STRING = /(["'])((?:\\.|(?!\1)[^\\])*)\1/g;
const FROM = /\bfrom\s+(["'])([^"']+)\1/;
const IMPORT_SELECTOR = /:import\(\s*(["']?)([^"')]+)\1\s*\)/;
/** Data, remote and fragment references name no file. */
const isRef = (ref: string) => ref !== '' && !/^(#|[a-z][\w+.-]*:)/i.test(ref);
/** Nor, read as a path, do aliases and package paths: those are the resolver's. */
const isFile = (ref: string) => isRef(ref) && !/^[~@]/.test(ref);

/**
 * A reference unescaped as Vite unescapes it before resolving (`doUrlReplace`
 * in `vite:css`, which Vite does not export): a backslash before any
 * character that is not a letter, digit or `_` is dropped, so
 * `..\/beta\/x.png` is `../beta/x.png`. A hex escape (`\2f`) Vite leaves as
 * written, and so does this: Vite then names no such file.
 */
const unescaped = (ref: string) => ref.replace(/\\(\W)/g, '$1');

/** The references in a declaration's value, unescaped: `url()` and the strings in `image-set()`. */
export function valueRefs(value: string): string[] {
  const urls = [...value.matchAll(URL_REF)].map((m) => m[2]);
  const sets = [...value.matchAll(IMAGE_SET)].flatMap((m) => [...m[1].matchAll(STRING)].map((s) => s[2]));
  return [...urls, ...sets].map(unescaped).filter(isRef);
}

/**
 * Vite's own resolvers, as its CSS plugin builds them from the resolved
 * config (`config.createResolver`: `resolve.alias` and Vite's node
 * resolution): `url` for `url()` and `image-set()`, `css` for `@import`,
 * `composes`, `@value` and `:import`. Each gives a file, or undefined.
 */
export type CssResolvers = {
  url: (id: string, importer: string) => Promise<string | undefined>;
  css: (id: string, importer: string) => Promise<string | undefined>;
};

/** A URL as Vite reads it before resolving: decoded when it decodes, without its fragment. */
const asVite = (ref: string) => {
  let decoded = ref;
  try {
    decoded = decodeURI(ref);
  } catch {}
  return decoded.split('#')[0];
};

/**
 * Every file a reference may name: as a path beside its stylesheet (or an
 * absolute path that exists), and as Vite resolves it, aliases and package
 * paths included. Both count, so neither spelling gets round the other.
 */
async function targetsOf(ref: string, from: string, resolve?: CssResolvers['url']): Promise<string[]> {
  const found: string[] = [];
  const file = fileOfRef(ref, from);
  if (file) found.push(file);
  const resolved = resolve && isRef(ref) ? await resolve(asVite(ref), from) : undefined;
  if (resolved) found.push(resolved.replace(/[?#].*$/, ''));
  return found;
}

/** The file `@import` names, quoted or as `url()`. */
export const importRef = (params: string) =>
  [...valueRefs(params), ...[...params.matchAll(STRING)].map((m) => m[2])][0];

/**
 * A reference as a file on disk, or null: relative to the file that makes
 * it, or an absolute path that exists (a `/` path that does not is the
 * public folder's).
 */
export function fileOfRef(ref: string, from: string): string | null {
  const path = ref.split(/[?#]/)[0];
  if (!isFile(path)) return null;
  if (path.startsWith('/')) return existsSync(path) ? path : null;
  return resolve(dirname(from), path);
}

/** The file a CSS modules node names: `composes … from`, `@value … from`, or `:import("…")`. */
export function moduleRef(node: ChildNode): string | undefined {
  if (node.type === 'decl' && node.prop === 'composes') return node.value.match(FROM)?.[2];
  if (node.type === 'atrule' && node.name === 'value') return node.params.match(FROM)?.[2];
  if (node.type === 'rule') return node.selector.match(IMPORT_SELECTOR)?.[2];
  return undefined;
}

/**
 * Every file a CSS module's chain reaches, read from disk, each once:
 * `composes … from`, `@value … from` and `:import("…")`, through every module
 * they name. postcss-modules resolves these before any other plugin sees the
 * sheet, so they are followed here.
 */
export async function modulesChain(
  file: string,
  resolve?: CssResolvers['css'],
  seen = new Set<string>(),
): Promise<string[]> {
  if (seen.has(file) || !existsSync(file)) return [];
  seen.add(file);
  const refs: string[] = [];
  postcss.parse(readFileSync(file, 'utf8'), { from: file }).walk((node) => {
    const ref = moduleRef(node);
    if (ref) refs.push(ref);
  });
  const found: string[] = [];
  for (const ref of refs)
    for (const target of await targetsOf(ref, file, resolve))
      found.push(target, ...(await modulesChain(target, resolve, seen)));
  return found;
}

/**
 * The postcss plugin: for the stylesheet being compiled (the root), a node
 * inlined from another owner's file, or a reference into a prototype the
 * root's owner is not, throws the error that names both files. The kit and
 * the hub own no prototype, so they may reach none.
 */
export function cssBoundary(
  project: string,
  owner: Owner,
  isPrototype: (owner: string) => boolean,
  resolvers: () => CssResolvers | null,
): PluginCreator<never> {
  const ownerOf = (file: string) => owner(real(file));
  const plugin: PluginCreator<never> = () => ({
    postcssPlugin: 'design-hub-css-boundary',
    async Once(root: Root) {
      const rootFile = root.source?.input.file;
      if (!rootFile) return;
      // Fail closed: without Vite's resolvers an alias or a package path would go unread.
      const resolve = resolvers();
      if (!resolve) throw new Error(`${rootFile}: the stylesheet check ran before Vite resolved its config.`);
      const rootOwner = ownerOf(rootFile);
      const refuse = (reader: string, target: string, node?: Node) => {
        const to = ownerOf(target);
        if (to === null || (to === rootOwner && isPrototype(to))) return;
        const message = isPrototype(to)
          ? crossImport(project, real(reader), real(target), ownerOf(reader) !== null)
          : looseFile(project, real(reader), real(target));
        throw node ? node.error(message) : new Error(message);
      };
      const reads: { file: string; node: Node; ref: string; by: CssResolvers['url'] }[] = [];
      root.walk((node) => {
        const file = node.source?.input.file ?? rootFile;
        if (file !== rootFile) refuse(rootFile, file, node);
        if (node.type === 'decl')
          for (const ref of valueRefs(node.value)) reads.push({ file, node, ref, by: resolve.url });
        if (node.type === 'atrule' && node.name === 'import') {
          const ref = importRef(node.params);
          if (ref) reads.push({ file, node, ref, by: resolve.css });
        }
      });
      for (const { file, node, ref, by } of reads)
        for (const target of await targetsOf(ref, file, by)) refuse(file, target, node);
      // postcss-modules runs first and resolves composes, @value and :import, so the chain is read from the files.
      if (/\.module\.\w+$/.test(rootFile))
        for (const target of await modulesChain(rootFile, resolve.css)) refuse(rootFile, target);
    },
  });
  plugin.postcss = true;
  return plugin;
}
