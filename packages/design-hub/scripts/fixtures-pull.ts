#!/usr/bin/env node
/// <reference types="node" />
// Writes a prototype's `real` fixtures from the project's CMS, with only the
// fields the component renders, so a pull spends nothing on fields nobody
// reads. The source follows the website platform in .design-hub/project.json
// (Webflow, Payload, WordPress) or --source; EmDash, and any CMS without one
// of those APIs, comes in as a JSON file (--from). Every other key in
// fixtures.json is kept. Run with no --map to list the fields. core/cms.ts
// holds each source's requests and responses.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import {
  type Env,
  fieldPaths,
  fieldRoot,
  type Item,
  itemsInFile,
  missingEnv,
  NEEDS,
  pageRequest,
  readPage,
  SOURCES,
  type Source,
  valueAt,
} from '../core/cms.ts';
import { contactsInJson } from '../core/contacts.ts';
import { readEnv } from '../server/env.ts';
import { PROTOTYPES, ROOT } from '../server/paths.ts';
import { readProject } from '../server/project.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';

export const spec = {
  name: 'fixtures-pull',
  summary:
    "Write a prototype's real fixtures from the project's CMS: Webflow, Payload, WordPress, or a JSON file.",
  positionals: [{ name: 'prototype', description: 'The prototype folder, e.g. sample-page', required: true }],
  flags: {
    collection: {
      type: 'string',
      description:
        'The collection: a Webflow collection id, a Payload collection slug, or a WordPress REST base (posts, pages).',
    },
    from: {
      type: 'string',
      description:
        'A JSON file of items instead of an API. EmDash: npx emdash content list <collection> --json > items.json.',
    },
    source: {
      type: 'string',
      choices: SOURCES,
      description:
        'Default: the website platform in .design-hub/project.json, else webflow; file with --from.',
    },
    map: {
      type: 'list',
      description:
        'key=field.path: the fixture key and the path it comes from (title.rendered). Omit to list fields.',
    },
    limit: { type: 'number', default: 20, description: 'How many items to keep.' },
    staged: { type: 'boolean', description: 'Read drafts too, not only published items.' },
  },
  output: '{ ok, source, file, items, contacts } or, without --map, { ok: false, fields }',
} as const satisfies CommandSpec;

const TIMEOUT_MS = 15_000;
const SAMPLE_ITEMS = 1;

export type FieldMap = { key: string; path: string[] };

export function parseMap(raw: string): FieldMap {
  const at = raw.indexOf('=');
  const key = at > 0 ? raw.slice(0, at).trim() : '';
  const path = at > 0 ? raw.slice(at + 1).trim() : '';
  if (!/^[A-Za-z_][\w]*$/.test(key) || !path)
    throw new CliError(`--map ${raw}: write it as key=field.path.`, { example: '--map cover=thumbnail.url' });
  return { key, path: path.split('.') };
}

/** One fixture item: the source's id, then each mapped field; a path that is not there is null. */
export function pick(source: Source, item: Item, maps: FieldMap[]): Record<string, unknown> {
  const root = fieldRoot(source, item);
  const out: Record<string, unknown> = { id: String(item.id ?? root.id ?? '') };
  for (const { key, path } of maps) out[key] = valueAt(root, path) ?? null;
  return out;
}

/** The source: --from means a file; else the flag, else the website platform, else Webflow. */
export function sourceFor(
  flag: string | undefined,
  from: string | undefined,
  platform: string | undefined,
): Source {
  if (from) return 'file';
  if (flag) return flag as Source;
  if (platform === 'payload' || platform === 'wordpress') return platform;
  if (platform === 'emdash')
    throw new CliError('EmDash has no pull API here; read it from a file.', {
      fix: 'npx emdash content list <collection> --json > items.json, then --from items.json.',
    });
  return 'webflow';
}

async function get(source: Exclude<Source, 'file'>, url: string, headers: Record<string, string>) {
  const response = await fetch(url, { headers, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!response.ok)
    throw new CliError(`${source} answered ${response.status} for ${url}.`, {
      body: (await response.text()).slice(0, 300),
      fix: response.status === 401 || response.status === 403 ? NEEDS[source].fix : undefined,
    });
  return { body: (await response.json()) as unknown, totalPages: response.headers.get('x-wp-totalpages') };
}

/** Pages through the collection until `limit` items are in, or it runs out. */
async function pullApi(
  source: Exclude<Source, 'file'>,
  env: Env,
  collection: string,
  limit: number,
  staged: boolean,
) {
  const items: Item[] = [];
  for (let page = 1; items.length < limit; page++) {
    const { url, headers } = pageRequest(source, env, collection, page, staged);
    const { body, totalPages } = await get(source, url, headers);
    const read = readPage(source, body, page, totalPages);
    items.push(...read.items);
    if (!read.more) break;
  }
  return items.slice(0, limit);
}

function readFile(path: string): Item[] {
  const file = resolve(ROOT, path);
  if (!existsSync(file)) throw new CliError(`${path} does not exist.`);
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new CliError(`${path} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  const items = itemsInFile(json);
  if (!items)
    throw new CliError(`${path} has no array of items at the top or under items, entries, docs or data.`);
  return items;
}

/** Replaces `real` and keeps every other set, adding an empty `missing` for the hand-written cases. */
function writeReal(file: string, real: Record<string, unknown>[]): void {
  const current = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(file, `${JSON.stringify({ ...current, real, missing: current.missing ?? [] }, null, 2)}\n`);
}

async function items(source: Source, flags: Args<typeof spec>['flags'], limit: number): Promise<Item[]> {
  if (source === 'file') return readFile(flags.from ?? '').slice(0, limit);
  const env = readEnv(ROOT);
  const missing = missingEnv(source, env);
  if (missing.length) throw new CliError(`${missing.join(' and ')} not in .env.`, { fix: NEEDS[source].fix });
  if (!flags.collection) throw new CliError(`--collection names the ${source} collection.`);
  return pullApi(source, env, flags.collection, limit, flags.staged);
}

export async function main({ positionals: [slug], flags }: Args<typeof spec>) {
  const dir = join(PROTOTYPES, slug);
  if (!existsSync(join(dir, 'README.md'))) throw new CliError(`No prototype called ${slug}.`);
  if (!Number.isInteger(flags.limit) || flags.limit < 1)
    throw new CliError('--limit takes a whole number above 0.');
  const source = sourceFor(flags.source, flags.from, readProject().project?.website?.platform);
  if (!flags.map.length) {
    const [first] = await items(source, flags, SAMPLE_ITEMS);
    return {
      ok: false,
      source,
      error: 'Name the fields the component renders with --map key=path, from these paths.',
      fields: first ? fieldPaths(fieldRoot(source, first)) : [],
    };
  }
  const maps = flags.map.map(parseMap);
  const real = (await items(source, flags, flags.limit)).map((i) => pick(source, i, maps));
  const file = join(dir, 'fixtures.json');
  writeReal(file, real);
  const contacts = contactsInJson(real).length;
  return {
    source,
    file: relative(ROOT, file),
    items: real.length,
    contacts,
    next: contacts
      ? `${contacts} email or phone values came in; design-hub preflight stops on them until each is confirmed or replaced.`
      : 'Write the missing set by hand (miles-get-hostile).',
  };
}
