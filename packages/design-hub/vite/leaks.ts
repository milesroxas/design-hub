/// <reference types="node" />
// The output-side check, a backstop for whole-file inlining and nothing
// more: after the bundle is settled (vite/settle.ts), no built file outside
// `_p/<slug>/` may be a whole file of `prototypes/<slug>/`, however it got
// there. The input checks (vite/registry.ts, vite/css-boundary.ts) refuse
// each way of reaching a prototype's file that someone has thought of; this
// one reads what was written, for the forms Vite 8.3.5 writes a whole file in
// (`vite:asset`; the Vite range is pinned for this):
//
// - the built file is byte for byte the source: an asset copy (`?url`, an
//   emitted file);
// - a `data:` URI in a built file decodes to exactly the source: base64
//   (`assetToDataURL`), or the URL-encoded SVG form (`svgToDataURL`, which
//   Vite does not export: its six replacements are repeated here, and the
//   LEAKS row for it fails if Vite changes them);
// - a string in a built script is exactly the source's whole text (`?raw`, an
//   inlined text): every string read with the parser Vite exports
//   (`parseSync`), so escaping and quote style never hide it.
//
// Nothing else counts: a line, a CSS rule or any other part of a file is
// never looked for, so two prototypes that share a sentence, a rule or an SVG
// path build. A match is legitimate when the reader's owner (the hub and the
// kit, for a file outside `_p/`; that prototype, for one under `_p/<slug>/`)
// has a source with the same whole content: the image in `kit/` and in two
// prototypes, the prototype font that is byte for byte Geist.
//
// Sources: every file under each prototype's folder on its real path
// (symlinks are skipped: a symlink's target is checked as its real owner's),
// except a prototype's own node_modules, of which only the files the build
// read count; and every file the build read from outside `prototypes/`, for
// the hub's and the kit's own content.
//
// It is linear: each built file is read once, for its hash, the hash of each
// data URI it holds and the hash of each string over MIN in a script; each
// source is hashed once, by a streamed read, and only when its size is one a
// built form has (most sources are never opened). Two rules keep a file it
// cannot use from failing the build with a wrong message: a source it cannot
// open (no permission) is skipped, since Vite could not have read it either;
// a source larger than LARGE is compared only against whole built files, as
// Vite inlines a file into a script or a data URI only by reading it into
// memory.
import { createHash } from 'node:crypto';
import {
  closeSync,
  type Dirent,
  existsSync,
  openSync,
  readdirSync,
  readFileSync,
  readSync,
  statSync,
} from 'node:fs';
import { join } from 'node:path';
import { parseSync, Visitor } from 'vite';
import { PROTOTYPE_DIR } from '../core/prototype.ts';
import { real, relativeTo } from './boundary.ts';

/**
 * The smallest source that counts, in bytes: a shorter file (an empty
 * `.gitkeep`, `{"a":1}`) is never looked for, as it matches a short string
 * by chance.
 */
export const MIN = 40;
/** A source larger than this, in bytes, is only ever compared with whole built files. */
const LARGE = 64 * 1024 * 1024;

type Owner = string | null;
type Form = 'bytes' | 'base64' | 'svg' | 'string';
/** One form of a built file: what it is, and the hash and size of the whole content it holds. */
type Found = { form: Form; hash: string; size: number };

const FORMS: Record<Form, string> = {
  bytes: 'as a copy of its bytes',
  base64: 'as a base64 data URI',
  svg: 'as a URL-encoded SVG data URI',
  string: 'as a string',
};

const hash = (data: string | Buffer) => createHash('sha256').update(data).digest('hex');
const decoder = new TextDecoder('utf-8', { fatal: true });
/** A file's text, or null when it is not UTF-8 text. */
function textOf(bytes: Buffer): string | null {
  if (bytes.includes(0)) return null;
  try {
    return decoder.decode(bytes);
  } catch {
    return null;
  }
}

/** What Vite writes for an SVG it inlines as text (`svgToDataURL`), or null when it writes base64 instead. */
export function svgDataUrlPayload(text: string): string | null {
  if (text.includes('<text') || text.includes('<foreignObject') || /"[^"']*'[^"]*"|'[^'"]*"[^']*'/.test(text))
    return null;
  return text
    .trim()
    .replaceAll(/>\s+</g, '><')
    .replaceAll('"', "'")
    .replaceAll('%', '%25')
    .replaceAll('#', '%23')
    .replaceAll('<', '%3c')
    .replaceAll('>', '%3e')
    .replaceAll(/\s+/g, '%20');
}

const SVG_HEAD = 'image/svg+xml';

/** The whole content a `data:` URI holds: its decoded bytes, or the payload of Vite's URL-encoded SVG form. */
export function dataUriForms(uri: string): Found[] {
  const comma = uri.indexOf(',');
  if (!uri.startsWith('data:') || comma < 0) return [];
  const head = uri.slice(5, comma);
  const payload = uri.slice(comma + 1);
  if (head.endsWith(';base64')) {
    const bytes = Buffer.from(payload, 'base64');
    return [{ form: 'base64', hash: hash(bytes), size: bytes.length }];
  }
  return head === SVG_HEAD ? [{ form: 'svg', hash: hash(payload), size: payload.length }] : [];
}

/** Every `data:` URI in a text (a stylesheet, or one string of a script): up to its closing quote, or without one up to `)` or a space. */
export function dataUrisIn(text: string): string[] {
  const found: string[] = [];
  for (let at = text.indexOf('data:'); at >= 0; at = text.indexOf('data:', at + 5)) {
    const quote = text[at - 1];
    const rest = text.slice(at);
    const end = quote === '"' || quote === "'" ? rest.indexOf(quote) : rest.search(/[)\s"']/);
    found.push(end < 0 ? rest : rest.slice(0, end));
  }
  return found;
}

/** Every string a script holds, decoded, at least MIN bytes long: literals and template parts. Null when it does not parse. */
function stringsOf(code: string, fileName: string): string[] | null {
  const parsed = parseSync(fileName, code, { lang: 'js', sourceType: 'module' });
  if (parsed.errors.length) return null;
  const found: string[] = [];
  const keep = (s: string | null | undefined) => {
    if (s && Buffer.byteLength(s) >= MIN) found.push(s);
  };
  new Visitor({
    Literal(node) {
      if (typeof node.value === 'string') keep(node.value);
    },
    TemplateElement(node) {
      keep(node.value.cooked);
    },
  }).visit(parsed.program);
  return found;
}

export type Written = { fileName: string; source: string | Uint8Array };

/** The owner of a built file by where it was written: `_p/<slug>/` is that prototype's, anything else the hub's. */
const ownerAt = (fileName: string): Owner => {
  const [top, slug, ...rest] = fileName.split('/');
  return top === PROTOTYPE_DIR && rest.length ? slug : null;
};

/** One built file as the check reads it: its owner, and every whole content it holds. Read once. */
type Read = { fileName: string; owner: Owner; found: Found[] };

const unparsed = (fileName: string) =>
  `${fileName} does not parse, so the build cannot read it for a prototype's content.`;

function read({ fileName, source }: Written): Read | string {
  const bytes = Buffer.from(source);
  const found: Found[] = [{ form: 'bytes', hash: hash(bytes), size: bytes.length }];
  const text = typeof source === 'string' ? source : textOf(bytes);
  if (text === null) return { fileName, owner: ownerAt(fileName), found };
  const script = /\.[cm]?js$/.test(fileName);
  if (!script && text.includes('data:')) found.push(...dataUrisIn(text).flatMap(dataUriForms));
  if (script) {
    const strings = stringsOf(text, fileName);
    if (strings === null) return unparsed(fileName);
    for (const s of strings) {
      const utf8 = Buffer.from(s);
      // The whole string as a data URI (an SVG one holds quotes), and one anywhere inside it: `?inline`
      // CSS holds one in a longer string.
      const uris = new Set([...(s.startsWith('data:') ? [s] : []), ...dataUrisIn(s)]);
      found.push({ form: 'string', hash: hash(utf8), size: utf8.length }, ...[...uris].flatMap(dataUriForms));
    }
  }
  return { fileName, owner: ownerAt(fileName), found };
}

/** Every file under a folder, symlinks and node_modules skipped, and a folder it cannot list (no permission) skipped too. */
function walk(dir: string): string[] {
  let entries: Dirent[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries.flatMap((d) => {
    const path = join(dir, d.name);
    if (d.isSymbolicLink() || d.name === 'node_modules') return [];
    return d.isDirectory() ? walk(path) : d.isFile() ? [path] : [];
  });
}

/** A file's size, or null when it is not a file that can be stat'ed. */
function sizeOf(file: string): number | null {
  try {
    const s = statSync(file);
    return s.isFile() ? s.size : null;
  } catch {
    return null;
  }
}

const CHUNK = 1024 * 1024;
/** A file's hash, read in chunks so a large file is never held whole; null when it cannot be read. */
function streamedHash(file: string): string | null {
  let fd: number;
  try {
    fd = openSync(file, 'r');
  } catch {
    return null;
  }
  try {
    const h = createHash('sha256');
    const buffer = Buffer.allocUnsafe(CHUNK);
    for (let n = readSync(fd, buffer); n > 0; n = readSync(fd, buffer)) h.update(buffer.subarray(0, n));
    return h.digest('hex');
  } catch {
    return null;
  } finally {
    closeSync(fd);
  }
}

/** The payload Vite would write for an SVG source, or null when it writes base64 or the file cannot be read. */
function svgPayloadOf(file: string): string | null {
  try {
    const text = textOf(readFileSync(file));
    return text === null ? null : svgDataUrlPayload(text);
  } catch {
    return null;
  }
}

/** Every source by real path, with its owner: each prototype folder's files, and the files the build read (`read`). */
function sourcesOf(prototypes: string, owner: (id: string) => Owner, inputs: readonly string[]) {
  const walked = existsSync(prototypes) ? walk(prototypes).map(real) : [];
  const read = new Set(inputs.map((id) => real(id.replace(/^\0/, '').replace(/\?.*$/, ''))));
  const sources = new Map<string, Owner>();
  for (const file of [...walked, ...read]) if (!sources.has(file)) sources.set(file, owner(file));
  return { sources, read };
}

/** Who holds each whole content among the sources: for each key (form-agnostic content, or SVG payload), owner to file. */
type Holders = Map<string, Map<Owner, string>>;
const contentKey = (h: string) => `c:${h}`;
const svgKey = (h: string) => `s:${h}`;
/** The content of a source the build read: the only sources a string is compared with. */
const readKey = (h: string) => `r:${h}`;
const keyOf = (f: Found) => (f.form === 'svg' ? svgKey(f.hash) : contentKey(f.hash));
/**
 * The key a built form names its source by. A string only names a source the
 * build read: equal text in a file nothing reads (a sentence in alpha's
 * tagline.txt and in beta's JSX) is a coincidence, not a leak. A data URI or
 * a copy names any source, since Vite inlines some files without a hook seeing them.
 */
const sourceKeyOf = (f: Found) => (f.form === 'string' ? readKey(f.hash) : keyOf(f));

/** The sizes the built forms have: whole built files, and what is inlined (a data URI's bytes, a string); and whether any SVG data URI is there. */
function sizesOf(reads: Read[]) {
  const copies = new Set<number>();
  const inlined = new Set<number>();
  let svg = false;
  for (const f of reads.flatMap((r) => r.found))
    if (f.form === 'bytes') copies.add(f.size);
    else if (f.form === 'svg') svg = true;
    else inlined.add(f.size);
  return { copies, inlined, svg };
}

/** The keys one source holds, read only when a built form could be it: its content's hash, and its SVG payload's. */
function keysOf(file: string, size: number, sizes: ReturnType<typeof sizesOf>): string[] {
  const keys: string[] = [];
  const small = size <= LARGE;
  if (sizes.copies.has(size) || (small && sizes.inlined.has(size))) {
    const h = streamedHash(file);
    if (h) keys.push(contentKey(h));
  }
  const payload = sizes.svg && small && file.endsWith('.svg') ? svgPayloadOf(file) : null;
  if (payload) keys.push(svgKey(hash(payload)));
  return keys;
}

function holdersOf(sources: Map<string, Owner>, read: ReadonlySet<string>, reads: Read[]): Holders {
  const sizes = sizesOf(reads);
  const holders: Holders = new Map();
  for (const [file, o] of sources) {
    const size = sizeOf(file);
    if (size === null || size < MIN) continue;
    const keys = keysOf(file, size, sizes);
    if (read.has(file)) keys.push(...keys.filter((k) => k.startsWith('c:')).map((k) => readKey(k.slice(2))));
    for (const key of keys) {
      const by = holders.get(key) ?? new Map<Owner, string>();
      if (!by.has(o)) by.set(o, file);
      holders.set(key, by);
    }
  }
  return holders;
}

/** The error for a built file that holds a prototype's file whole outside its folder. */
export const leaked = (fileName: string, file: string, slug: string, form: Form) =>
  `${fileName} holds ${file} ${FORMS[form]}, which belongs to prototypes/${slug}/ and may be written only under ${PROTOTYPE_DIR}/${slug}/. A prototype's files are read only by that prototype: copy the file into the one that reads it, or move it into kit/.`;

/**
 * Every built file that holds a whole file of a prototype other than its own
 * owner (for a file outside `_p/`, any prototype's), as problems naming the
 * built file and the source, unless its owner has a source with the same
 * content. `inputs` is every file the bundle read (every prototype file
 * the build loaded, every chunk's modules, every asset's original files),
 * recorded before settle moved anything; a string is compared only with
 * those. A built script that does not parse is a problem, never skipped.
 */
export function leaks(
  root: string,
  prototypes: string,
  owner: (id: string) => Owner,
  inputs: readonly string[],
  written: readonly Written[],
): string[] {
  const all = written.map(read);
  const problems = all.filter((r): r is string => typeof r === 'string');
  const reads = all.filter((r): r is Read => typeof r !== 'string');
  const { sources, read: readByBuild } = sourcesOf(prototypes, owner, inputs);
  const holders = holdersOf(sources, readByBuild, reads);
  for (const r of reads) problems.push(...leaksIn(root, r, holders));
  return problems;
}

/** What one built file holds of another owner: each source named once. */
function leaksIn(root: string, r: Read, holders: Holders): string[] {
  const problems: string[] = [];
  const named = new Set<string>();
  for (const f of r.found) {
    // Legitimate when the reader's owner holds the content in any source, read or not.
    const by = holders.get(keyOf(f));
    if (!by || by.has(r.owner) || by.has(null)) continue;
    for (const [slug, file] of holders.get(sourceKeyOf(f)) ?? []) {
      if (slug === null || named.has(file)) continue;
      named.add(file);
      problems.push(leaked(r.fileName, relativeTo(root, file), slug, f.form));
    }
  }
  return problems;
}
