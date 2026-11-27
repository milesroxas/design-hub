/// <reference types="node" />
// The prototype boundary as the build sees it. A built file is owned by where
// its content comes from, never by who reads it:
//
// - owned only by prototype `a` (its modules, or for a stylesheet the
//   modules whose CSS it holds): it lives in `_p/a/`, and only `a`'s files read it;
// - owned by nothing under `prototypes/` (the hub, the kit, node_modules): it
//   lives in `assets/` and is never copied into a prototype's folder;
// - the same bytes from several owners (Rolldown writes them once): one copy
//   per owner, each owner's files pointed at its own.
//
// A file that reads what another prototype owns, or a hub file that reads
// what a prototype owns, fails the build. These are the pure rules;
// vite/registry.ts and vite/settle.ts apply them to the modules and bundle
// Rolldown hands them.
import { realpathSync } from 'node:fs';
import nodePath, { extname, posix, resolve } from 'node:path';
import { parseSync, Visitor } from 'vite';
import { ALL_FILE, PROTOTYPE_DIR } from '../core/prototype.ts';

/** The virtual module Studio and a Client load a prototype through: its README and its loader. */
export const ENTRY_ID = 'virtual:design-hub/entry/';

const realCache = new Map<string, string>();
/**
 * A path with every symlink followed and in the letter case it has on disk,
 * or the path itself when it is not a file on disk (a virtual module). The
 * native call, because Node's own keeps the case as written: on a disk that
 * folds case (macOS, Windows) `Prototypes/beta/x.css` is `prototypes/beta/x.css`,
 * and an owner must be the same either way.
 */
export const real = (path: string) => {
  let found = realCache.get(path);
  if (found === undefined) {
    try {
      found = realpathSync.native(path);
    } catch {
      found = path;
    }
    realCache.set(path, found);
  }
  return found;
};

/** A module id as a file path: no leading `\0`, no `?query`. */
const fileOf = (id: string) => id.replace(/^\0/, '').replace(/\?.*$/, '');

/**
 * Which prototype folder a module or file belongs to, on its real path (a
 * symlink into another prototype's folder is that prototype's): the first
 * segment under `prototypes/`, whatever its name (a file directly there is
 * owned by its own name, so nothing under `prototypes/` is ever the hub's),
 * or null for anything outside it. A prototype's virtual entry belongs to its
 * slug. Whether that owner is a prototype at all is for the caller: a folder
 * with no README, or a file directly in `prototypes/`, is refused (looseFile).
 */
export function ownerOf(
  prototypes: string,
  paths: typeof nodePath = nodePath,
): (id: string) => string | null {
  const roots = [...new Set([prototypes, real(prototypes)])];
  return (id) => {
    const path = real(fileOf(id));
    if (path.startsWith(ENTRY_ID)) return path.slice(ENTRY_ID.length) || null;
    if (!paths.isAbsolute(path)) return null;
    // By the platform's path rules, so a Windows path (backslashes from realpath, `/` from Vite) is judged as a POSIX one.
    for (const root of roots) {
      const rest = paths.relative(root, path);
      if (rest === '..' || rest.startsWith(`..${paths.sep}`) || paths.isAbsolute(rest)) continue;
      // A file directly in prototypes/ is owned by its own name: nothing there is the hub's.
      return rest.split(paths.sep)[0] || null;
    }
    return null;
  };
}

/** The owners of a set of modules or files, each once, sorted; none for shared code. */
export function ownersOf(owner: (id: string) => string | null, ids: readonly string[]): string[] {
  return [...new Set(ids.map(owner).filter((o): o is string => o !== null))].sort();
}

/** Where a built file goes: under `_p/<slug>/` when one prototype owns it, else the shared `assets/`. */
export function placed(owners: string[], pattern: string, shared = false): string {
  return owners.length === 1 && !shared ? `${PROTOTYPE_DIR}/${owners[0]}/${pattern}` : `assets/${pattern}`;
}

/** A file resolved against the Vite root: Rolldown reports an asset's original files relative to it. */
export const fromRoot = (viteRoot: string) => (file: string) => resolve(viteRoot, file);

/** A path for an error message: from the project root, with no `\0` or query. */
export const relativeTo = (root: string, path: string) =>
  fileOf(path)
    .replace(`${real(root)}/`, '')
    .replace(`${root}/`, '');

/** The error for a file reaching a prototype's file, naming both: another prototype's, or (from the kit or the hub) any prototype's. */
export function crossImport(root: string, importer: string, imported: string, fromPrototype = true): string {
  const whose = fromPrototype
    ? "another prototype's file"
    : "a prototype's file, which the kit and the hub never read";
  return `${relativeTo(root, importer)} imports ${relativeTo(root, imported)}, ${whose}. A prototype imports only @kit/* and its own folder: copy the file into this prototype, or move it into kit/.`;
}

/** Who owns a built file's content: a prototype's slug, or null for the hub, the kit or a package. */
export type Owner = string | null;
/**
 * One source of a built asset's content: a file, or for a stylesheet a CSS
 * module it holds. `writer` is the owner of the chunk that wrote a
 * stylesheet, whose name Vite took from that chunk.
 */
export type Source = { owner: Owner; file: string; writer?: Owner };
/** Where one owner's copy of an asset lives. */
export type Placement = { owner: Owner; fileName: string };

/** Files the build names on purpose: never moved, copied, renamed or read for references. */
export const isFixed = (fileName: string) =>
  fileName === ALL_FILE ||
  !fileName.includes('/') ||
  fileName.startsWith('_gate/') ||
  (fileName.startsWith(`${PROTOTYPE_DIR}/`) && fileName.endsWith('/entry.js'));

const folderOf = (owner: Owner) => (owner === null ? 'assets' : `${PROTOTYPE_DIR}/${owner}`);
const HASH_TAIL = /-[\w-]{8}$/;
/** A built name without its hash: `logo-Fji5aE1.png` is `logo`. */
const stemOf = (base: string) => posix.basename(base, extname(base)).replace(HASH_TAIL, '');

/** What Rolldown makes of a name: the characters a URL or a file system would trip on become `_`. */
// biome-ignore lint/suspicious/noControlCharactersInRegex: the control characters are what it replaces
const sanitize = (name: string) => name.replace(/[\u0000-\u001F"#$%&*+,:;<=>?[\]^`{|}\u007F]/g, '_');

/**
 * The name one owner's copy takes. The built name, which Rolldown has
 * already made safe, while every source of the file, and the chunk that
 * wrote it, is that owner's; else from that owner's own source (file or CSS
 * module), made safe the same way. So a copy never carries a name from
 * another owner's file: not another prototype's, and in `assets/` never a
 * prototype's at all.
 */
function nameFor(base: string, owner: Owner, sources: Source[], slugs: readonly string[], hash: string) {
  const ext = extname(base);
  const elsewhere = sources.some((s) => s.owner !== owner || (s.writer !== undefined && s.writer !== owner));
  const foreign = slugs.some((s) => s !== owner && stemOf(base).includes(s));
  if (!elsewhere && !foreign) return base;
  const own = sources.find((s) => s.owner === owner);
  const stem = own ? sanitize(posix.basename(own.file, extname(own.file))) : (owner ?? 'asset');
  return stemOf(base) === stem ? base : `${stem}-${hash}${ext}`;
}

/**
 * Where an asset must be, one file per owner of its content: `_p/<slug>/`
 * for a prototype, `assets/` for the hub or the kit. Null when it is already
 * there or nothing shows where its content comes from.
 */
export function placementsOf(
  fileName: string,
  sources: Source[] | null,
  slugs: readonly string[],
  hash: string,
): Placement[] | null {
  if (!sources?.length || isFixed(fileName)) return null;
  const owners = [...new Set(sources.map((s) => s.owner))].sort((a, b) => String(a).localeCompare(String(b)));
  const base = posix.basename(fileName);
  const places = owners.map((owner) => ({
    owner,
    fileName: `${folderOf(owner)}/${nameFor(base, owner, sources, slugs, hash)}`,
  }));
  return places.length === 1 && places[0].fileName === fileName ? null : places;
}

/**
 * What a reader gets for a file it reads: its own owner's copy, else the
 * hub's (anyone may read the kit), else nothing, which the build refuses.
 */
export function copyFor(places: Placement[], reader: Owner): Placement | null {
  return places.find((p) => p.owner === reader) ?? places.find((p) => p.owner === null) ?? null;
}

/** The error for a file that reads what another prototype owns, naming reader and source. */
export const readsAcross = (reader: string, source: Source) =>
  `${reader} reads ${source.file}, which belongs to prototypes/${source.owner}/. A prototype's files are read only by that prototype: copy the file into the one that reads it, or move it into kit/.`;

/** The error for a reach into `prototypes/` outside any prototype's folder. */
export const looseFile = (root: string, importer: string, file: string) =>
  `${relativeTo(root, importer)} imports ${relativeTo(root, file)}, which is in prototypes/ but in no prototype's folder. Nothing in prototypes/ is shared: shared code belongs in kit/.`;

/** A stylesheet language whose own `@import` and `@use` resolve inside its preprocessor. */
export const PREPROCESSED = /\.(scss|sass|less|styl|stylus)$/;

/** The error for a prototype or the project's kit/ importing Sass, Less or Stylus. */
export const preprocessed = (root: string, importer: string, file: string) =>
  `${relativeTo(root, importer)} imports ${relativeTo(root, file)}. Sass, Less and Stylus are refused in prototypes and kit/: they resolve their own @import and @use inside the preprocessor, where the build cannot check them for reaches into a prototype's folder. Use plain CSS or .pcss.`;

/** The error for a stylesheet the build cannot read. */
export const unreadable = (root: string, file: string, line: number, column: number, reason: string) =>
  `${relativeTo(root, file)}:${line}:${column}: this stylesheet does not parse (${reason}). Fix the stylesheet: the build reads every stylesheet for reaches into a prototype's folder and refuses one it cannot read.`;

type Expr = {
  type: string;
  start: number;
  value?: unknown;
  quasis?: { value: { cooked: string | null } }[];
  expressions?: unknown[];
  object?: { type: string };
  property?: { name?: string };
};

/** The path a `new URL(…)` argument names, when it is a literal: a string, or a template with no `${…}`. */
function literalPath(arg: Expr): string | null {
  if (arg.type === 'Literal' && typeof arg.value === 'string') return arg.value;
  if (arg.type === 'TemplateLiteral' && !arg.expressions?.length)
    return arg.quasis?.[0]?.value.cooked ?? null;
  return null;
}

const isImportMetaUrl = (arg: Expr | undefined) =>
  arg?.type === 'MemberExpression' && arg.object?.type === 'MetaProperty' && arg.property?.name === 'url';

/**
 * The paths a module names with `new URL('…', import.meta.url)`, found with
 * the parser Vite itself uses (oxc, through `parseSync`), on the code Vite's
 * own `new URL` plugin sees: TypeScript and JSX already compiled. So a quote
 * in a regex literal, in JSX text, in a string or in a comment never hides
 * one or fakes one. A template with `${…}` becomes an import.meta.glob, which
 * the resolver sees; a data URL and one marked `@vite-ignore` are skipped, as
 * Vite skips them. The query stays: `?inline` is a reach too. Null when the
 * code does not parse (Vite then reports the error itself).
 */
export function newUrlTargets(code: string, file: string): string[] | null {
  const parsed = parseSync(`${file.replace(/\?.*$/, '')}.js`, code, { lang: 'js', sourceType: 'module' });
  if (parsed.errors.length) return null;
  const found: string[] = [];
  new Visitor({
    NewExpression(node) {
      const callee = node.callee as Expr & { name?: string };
      const [url, base] = node.arguments as unknown as Expr[];
      if (callee.type !== 'Identifier' || callee.name !== 'URL' || !url || !isImportMetaUrl(base)) return;
      const ignored = parsed.comments.some(
        (c) => c.start >= node.start && c.end <= url.start && c.value.includes('@vite-ignore'),
      );
      const path = literalPath(url);
      if (path !== null && !ignored && !path.startsWith('data:')) found.push(path);
    },
  }).visit(parsed.program);
  return found;
}

/** The error for a built file with no record of where its content comes from. */
export const unrecorded = (fileName: string) =>
  `${fileName} was written with no record of where its content comes from, so the build cannot tell who may read it. Only the hub's fixed files and a worker built from the kit may be written that way.`;

/** The error for a worker that reaches a prototype's folder. */
export const workerRefused = (root: string, file: string) =>
  `${relativeTo(root, file)} is in a web worker. A worker cannot use a prototype's files: Vite builds it as a file of its own that the build cannot place in the prototype's folder. Run the work on the main thread, or build the worker from kit/ files only.`;

/**
 * A file's text with every reference to `from` pointed at `to`: the whole
 * path, and the path relative to the referring file when that differs.
 */
export function repointText(text: string, referrer: string, from: string, to: string): string {
  let out = text.split(from).join(to);
  const rel = posix.relative(posix.dirname(referrer), from);
  if (rel.includes('/') && rel !== from)
    out = out.split(rel).join(posix.relative(posix.dirname(referrer), to));
  return out;
}

/** A chunk where its modules say: `_p/<slug>/` for one prototype's, never two. */
export function chunkProblems(fileName: string, owners: string[]): string[] {
  if (owners.length > 1)
    return [`${fileName} holds files of ${owners.map((o) => `prototypes/${o}/`).join(' and ')}`];
  const [slug] = owners;
  return slug && !fileName.startsWith(`${PROTOTYPE_DIR}/${slug}/`)
    ? [`${fileName} holds files of prototypes/${slug}/ but is not under ${PROTOTYPE_DIR}/${slug}/`]
    : [];
}
