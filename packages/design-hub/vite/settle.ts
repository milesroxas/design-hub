/// <reference types="node" />
// The last step of a build, after Vite's own generateBundle work, so the
// preload lists Vite writes into each entry are final text. Every asset goes
// where the owners of its content are (vite/boundary.ts), each file that
// really reads it is pointed at its own owner's copy, and every read that
// crosses an owner fails the build, naming reader and source.
//
// Sources are recorded, never inferred from who reads a file: a stylesheet's
// CSS modules as each chunk's sheet is written (registry.ts, renderChunk,
// before Vite moves a CSS-only chunk's sheet onto its importers), an asset's
// original files, a worker's output as its bundle is written. A file with no
// record fails the build unless its name is fixed.
//
// A real read is one Vite records (a chunk's imports, its importedCss and
// importedAssets) or a built file's hashed name in another built file's
// text: a preload list, a stylesheet's url(), an asset URL in a chunk. Files
// with fixed names (`_p/all.js`, each `entry.js`, `_gate/*`) are never read
// for that, never moved, and prose that names them is never rewritten.
import { createHash } from 'node:crypto';
import type { Rolldown } from 'vite';
import {
  chunkProblems,
  copyFor,
  isFixed,
  type Owner,
  ownersOf,
  type Placement,
  placementsOf,
  readsAcross,
  relativeTo,
  repointText,
  type Source,
  unrecorded,
} from './boundary.ts';

type Bundle = Rolldown.OutputBundle;
type Chunk = Rolldown.OutputChunk;
type Asset = Rolldown.OutputAsset;
type File = Chunk | Asset;
/** Vite's record of what a chunk brings in. */
type Meta = { importedCss: Set<string>; importedAssets: Set<string> };
/** One chunk writing a stylesheet: the CSS modules it holds, and the owner of the chunk, whose name Vite gave the sheet. */
export type SheetWrite = { modules: readonly string[]; writer: Owner };

export type Owners = {
  owner: (id: string) => string | null;
  inRoot: (file: string) => string;
  slugs: readonly string[];
  root: string;
  /** Each written stylesheet's CSS modules and writer, one record per chunk that wrote it, recorded when the chunk was rendered. */
  css: ReadonlyMap<string, readonly SheetWrite[]>;
  /** The files worker bundles wrote: built from no prototype's file (the worker guard refuses one). */
  workers: ReadonlySet<string>;
};

const metaOf = (chunk: Chunk) => (chunk as unknown as { viteMetadata?: Meta }).viteMetadata;
const textOf = (file: File) =>
  file.type === 'chunk' ? file.code : typeof file.source === 'string' ? file.source : undefined;
const hash8 = (source: string | Uint8Array) => createHash('sha256').update(source).digest('hex').slice(0, 8);

/** A chunk's owner by its modules: one prototype's slug, or null. Two are refused by chunkProblems. */
const chunkOwner = (chunk: Chunk, o: Owners): Owner => ownersOf(o.owner, chunk.moduleIds)[0] ?? null;

/**
 * One chunk's sheet as a source: its prototype's, when any of its CSS modules
 * is a prototype's (kit CSS bundled into a prototype's chunk is that
 * prototype's content), else the kit's or the hub's. Two chunks writing the
 * same bytes are two sources.
 */
function sheetSource({ modules, writer }: SheetWrite, o: Owners): Source {
  const owner = ownersOf(o.owner, modules)[0] ?? null;
  const from = modules.find((id) => o.owner(id) === owner) ?? modules[0];
  return { owner, file: relativeTo(o.root, from), writer };
}

/**
 * Where an asset's content comes from, as recorded: a stylesheet's CSS
 * modules, a worker's bundle (the kit's), or an asset's original files.
 * Null when nothing was recorded.
 */
function sourcesOf(asset: Asset, o: Owners): Source[] | null {
  const css = o.css.get(asset.fileName);
  // A sheet with no CSS module recorded is no one's, never the hub's: it fails as unrecorded.
  if (css?.length) return css.some((w) => !w.modules.length) ? null : css.map((w) => sheetSource(w, o));
  if (o.workers.has(asset.fileName)) return [{ owner: null, file: asset.fileName }];
  if (!asset.originalFileNames.length) return null;
  return asset.originalFileNames.map((f) => {
    const abs = o.inRoot(f);
    return { owner: o.owner(abs), file: relativeTo(o.root, abs) };
  });
}

/** What a file really reads: the chunks it imports, what Vite records it brings in, and built names in its text. */
function readsOf(file: File, all: File[]): File[] {
  const text = textOf(file);
  const meta = file.type === 'chunk' ? metaOf(file) : undefined;
  const named = new Set([
    ...(file.type === 'chunk' ? [...file.imports, ...file.dynamicImports] : []),
    ...(meta ? [...meta.importedCss, ...meta.importedAssets] : []),
  ]);
  return all.filter(
    (x) =>
      x !== file && (named.has(x.fileName) || (!isFixed(x.fileName) && text?.includes(x.fileName) === true)),
  );
}

type Plan = { sources: Source[] | null; places: Placement[] | null };
/** One reader: a file as it will be written, with its owner. A split asset reads as each of its copies. */
type Reader = { file: File; owner: Owner; fileName: string };

/** The owner a kept asset reads as: its one source owner, else the hub. */
const keptOwner = (plan: Plan): Owner => {
  const owners = new Set(plan.sources?.map((s) => s.owner));
  return owners.size === 1 ? [...owners][0] : null;
};

function readersOf(file: File, plans: Map<string, Plan>, o: Owners): Reader[] {
  if (file.type === 'chunk') return [{ file, owner: chunkOwner(file, o), fileName: file.fileName }];
  const plan = plans.get(file.fileName);
  if (plan?.places) return plan.places.map((p) => ({ file, owner: p.owner, fileName: p.fileName }));
  return [{ file, owner: plan ? keptOwner(plan) : null, fileName: file.fileName }];
}

/** The copy a reader gets of a file it reads, or the problem that it may not read it. */
function resolveRead(
  reader: Reader,
  x: File,
  plans: Map<string, Plan>,
  o: Owners,
): { to?: string; problem?: string } {
  if (x.type === 'chunk') {
    const owner = chunkOwner(x, o);
    return owner && owner !== reader.owner
      ? { problem: readsAcross(reader.fileName, { owner, file: x.fileName }) }
      : {};
  }
  const plan = plans.get(x.fileName)!;
  if (!plan.sources) return {};
  // Not split: it stays where it is, for its one owner.
  const copy = copyFor(plan.places ?? [{ owner: keptOwner(plan), fileName: x.fileName }], reader.owner);
  if (!copy)
    return { problem: readsAcross(reader.fileName, plan.sources.find((s) => s.owner !== reader.owner)!) };
  return copy.fileName === x.fileName ? {} : { to: copy.fileName };
}

/** Points Vite's record of what a chunk brings in at the copies it now reads. */
function repointMeta(file: File, moved: Map<string, string>) {
  const meta = file.type === 'chunk' ? metaOf(file) : undefined;
  for (const set of meta ? [meta.importedCss, meta.importedAssets] : [])
    for (const [from, to] of moved) if (set.delete(from)) set.add(to);
}

type Edit = { reader: Reader; moved: Map<string, string> };

/** Every asset's sources and placement. */
function planAll(all: File[], o: Owners): Map<string, Plan> {
  const plans = new Map<string, Plan>();
  for (const f of all)
    if (f.type === 'asset') {
      const sources = sourcesOf(f, o);
      plans.set(f.fileName, { sources, places: placementsOf(f.fileName, sources, o.slugs, hash8(f.source)) });
    }
  return plans;
}

/** One reader's reads: where each now points, and the problems. */
function readAll(reader: Reader, all: File[], plans: Map<string, Plan>, o: Owners) {
  const moved = new Map<string, string>();
  const problems: string[] = [];
  for (const x of readsOf(reader.file, all)) {
    const r = resolveRead(reader, x, plans, o);
    if (r.problem) problems.push(r.problem);
    if (r.to) moved.set(x.fileName, r.to);
  }
  return { moved, problems };
}

/**
 * Places every asset by the owners of its content, points each real read at
 * the reader's own copy, and returns every problem: a chunk with two
 * prototypes' modules or outside its folder, a read across owners, and a
 * file with no record of its source and no fixed name.
 * Writes nothing when there is a problem.
 */
export function settle(
  bundle: Bundle,
  o: Owners,
  emit: (fileName: string, source: string | Uint8Array) => void,
) {
  const all = Object.values(bundle);
  const plans = planAll(all, o);
  const problems = all.flatMap((c) =>
    c.type === 'chunk' ? chunkProblems(c.fileName, ownersOf(o.owner, c.moduleIds)) : [],
  );
  for (const [fileName, plan] of plans)
    if (!plan.sources && !isFixed(fileName)) problems.push(unrecorded(fileName));
  const edits: Edit[] = [];
  for (const file of all)
    for (const reader of readersOf(file, plans, o)) {
      const read = readAll(reader, all, plans, o);
      problems.push(...read.problems);
      edits.push({ reader, moved: read.moved });
    }
  if (problems.length) return [...new Set(problems)];
  apply(bundle, edits, plans, emit);
  return [];
}

/** Writes the plan: each reader's text and record pointed at its copies, new copies emitted, replaced originals removed. */
function apply(
  bundle: Bundle,
  edits: Edit[],
  plans: Map<string, Plan>,
  emit: (fileName: string, source: string | Uint8Array) => void,
) {
  // Every new text from the original texts first, so a kept copy's edit never leaks into another copy.
  const written = edits.map(({ reader, moved }) => {
    let text = textOf(reader.file);
    for (const [from, to] of moved)
      if (text !== undefined) text = repointText(text, reader.fileName, from, to);
    return { reader, moved, text };
  });
  const kept = new Set<string>();
  const copies: [string, string | Uint8Array][] = [];
  for (const { reader, moved, text } of written) {
    const { file } = reader;
    if (reader.fileName !== file.fileName) {
      copies.push([reader.fileName, text ?? (file as Asset).source]);
      continue;
    }
    kept.add(file.fileName);
    repointMeta(file, moved);
    if (text === undefined) continue;
    if (file.type === 'chunk') file.code = text;
    else file.source = text;
  }
  for (const [fileName, plan] of plans) if (plan.places && !kept.has(fileName)) delete bundle[fileName];
  for (const [fileName, source] of copies) emit(fileName, source);
}
