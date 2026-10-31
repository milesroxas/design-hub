#!/usr/bin/env node
/// <reference types="node" />
// Writes a prototype's `real` fixtures from a Webflow CMS collection, with
// only the fields the component renders, so a pull spends nothing on fields
// nobody reads. Pages through the Data API (100 items a request) for any
// --limit. Every other key in fixtures.json is kept. Run with no --map to
// list the collection's fields. Needs WEBFLOW_TOKEN (cms:read) in .env.
// API: https://developers.webflow.com/data/reference/cms/collection-items
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { contactsInJson } from '../_core/contacts.ts';
import { readEnv } from '../_server/env.ts';
import { PROTOTYPES, REPO } from '../_server/paths.ts';
import { type Args, CliError, type CommandSpec, isMain, runCommand } from './lib/cli.ts';

export const spec = {
  name: 'fixtures:pull',
  summary: "Write a prototype's real fixtures from a Webflow CMS collection.",
  positionals: [{ name: 'prototype', description: 'The prototype folder, e.g. sample-list', required: true }],
  flags: {
    collection: { type: 'string', required: true, description: 'The Webflow collection id.' },
    map: {
      type: 'list',
      description:
        'key=field.path: the fixture key and the fieldData path it comes from (thumbnail.url). Omit to list fields.',
    },
    limit: { type: 'number', default: 20, description: 'How many items to keep.' },
    staged: {
      type: 'boolean',
      description: 'Read staged items (drafts included) instead of published ones.',
    },
  },
  output: '{ ok, file, items, contacts } or, without --map, { ok: false, fields }',
} as const satisfies CommandSpec;

const API = 'https://api.webflow.com/v2';
const PAGE = 100;
const TIMEOUT_MS = 15_000;

type Item = { id: string; isDraft?: boolean; isArchived?: boolean; fieldData: Record<string, unknown> };
export type FieldMap = { key: string; path: string[] };

export function parseMap(raw: string): FieldMap {
  const at = raw.indexOf('=');
  const key = at > 0 ? raw.slice(0, at).trim() : '';
  const path = at > 0 ? raw.slice(at + 1).trim() : '';
  if (!/^[A-Za-z_][\w]*$/.test(key) || !path)
    throw new CliError(`--map ${raw}: write it as key=field.path.`, { example: '--map cover=thumbnail.url' });
  return { key, path: path.split('.') };
}

/** One fixture item: the Webflow id, then each mapped field; a path that is not there is null. */
export function pick(item: Item, maps: FieldMap[]): Record<string, unknown> {
  const out: Record<string, unknown> = { id: item.id };
  for (const { key, path } of maps) {
    let value: unknown = item.fieldData;
    for (const part of path)
      value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
    out[key] = value ?? null;
  }
  return out;
}

async function get<T>(token: string, path: string): Promise<T> {
  const response = await fetch(`${API}${path}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!response.ok)
    throw new CliError(`Webflow answered ${response.status} for ${path}.`, {
      body: (await response.text()).slice(0, 300),
      fix:
        response.status === 401 || response.status === 403
          ? 'WEBFLOW_TOKEN needs the cms:read scope.'
          : undefined,
    });
  return (await response.json()) as T;
}

type Schema = { displayName: string; fields: { slug: string; type: string; displayName: string }[] };

async function listFields(token: string, collection: string) {
  const schema = await get<Schema>(token, `/collections/${collection}`);
  return {
    ok: false,
    error: `Name the fields the component renders with --map, from ${schema.displayName}'s fields.`,
    fields: schema.fields.map(({ slug: field, type, displayName }) => ({ field, type, displayName })),
  };
}

/** Pages through the collection until `limit` unarchived items are in, or it runs out. */
async function pullItems(token: string, collection: string, limit: number, staged: boolean): Promise<Item[]> {
  const items: Item[] = [];
  const listing = staged ? 'items' : 'items/live';
  for (let offset = 0; items.length < limit; offset += PAGE) {
    const page = await get<{ items: Item[]; pagination: { total: number } }>(
      token,
      `/collections/${collection}/${listing}?offset=${offset}&limit=${PAGE}`,
    );
    items.push(...page.items.filter((i) => !i.isArchived));
    if (offset + PAGE >= page.pagination.total || !page.items.length) break;
  }
  return items.slice(0, limit);
}

/** Replaces `real` and keeps every other set, adding an empty `missing` for the hand-written cases. */
function writeReal(file: string, real: Record<string, unknown>[]): void {
  const current = existsSync(file) ? (JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>) : {};
  writeFileSync(file, `${JSON.stringify({ ...current, real, missing: current.missing ?? [] }, null, 2)}\n`);
}

export async function main({ positionals: [slug], flags }: Args<typeof spec>) {
  const token = readEnv(PROTOTYPES).WEBFLOW_TOKEN;
  if (!token)
    throw new CliError('WEBFLOW_TOKEN is not in prototypes/.env.', {
      fix: 'Create a site token with cms:read in Webflow (Site settings, Apps & integrations) and add WEBFLOW_TOKEN=<token> to .env.',
    });
  const dir = join(PROTOTYPES, slug);
  if (!existsSync(join(dir, 'README.md'))) throw new CliError(`No prototype called ${slug}.`);
  const collection = encodeURIComponent(flags.collection);
  if (!flags.map.length) return listFields(token, collection);
  const maps = flags.map.map(parseMap);
  if (!Number.isInteger(flags.limit) || flags.limit < 1)
    throw new CliError('--limit takes a whole number above 0.');
  const real = (await pullItems(token, collection, flags.limit, flags.staged)).map((i) => pick(i, maps));
  const file = join(dir, 'fixtures.json');
  writeReal(file, real);
  const contacts = contactsInJson(real).length;
  return {
    file: relative(REPO, file),
    items: real.length,
    contacts,
    next: contacts
      ? `${contacts} email or phone values came in; pnpm preflight stops on them until each is confirmed or replaced.`
      : 'Write the missing set by hand (miles-get-hostile).',
  };
}

if (isMain(import.meta.url)) await runCommand(spec, main);
