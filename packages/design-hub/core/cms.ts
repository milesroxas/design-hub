// Where real fixtures come from: a CMS's own API, read page by page, or a
// JSON file another tool wrote. Pure: this module builds each request and
// reads each response; the caller fetches and passes the environment in, so
// every source is tested without a network.
//
// Webflow: Data API v2, https://developers.webflow.com/data/reference/cms/collection-items
// Payload: REST, GET <url>/api/<collection>, `Authorization: <auth collection> API-Key <key>`
// WordPress: REST, GET <url>/wp-json/wp/v2/<rest base>, application passwords for drafts
// File: any JSON with an array of items (EmDash: `npx emdash content list <collection> --json`)

export const SOURCES = ['webflow', 'payload', 'wordpress', 'file'] as const;
export type Source = (typeof SOURCES)[number];

export type Item = Record<string, unknown>;
export type Request = { url: string; headers: Record<string, string> };
export type Page = { items: Item[]; more: boolean };
export type Env = Record<string, string | undefined>;

/** The env a source needs, as `.env` lines, and why. */
export const NEEDS: Record<Exclude<Source, 'file'>, { keys: string[]; fix: string }> = {
  webflow: {
    keys: ['WEBFLOW_TOKEN'],
    fix: 'Create a site token with cms:read in Webflow (Site settings, Apps & integrations) and add WEBFLOW_TOKEN=<token> to .env.',
  },
  payload: {
    keys: ['PAYLOAD_URL', 'PAYLOAD_API_KEY'],
    fix: 'Add PAYLOAD_URL=<site origin> and PAYLOAD_API_KEY=<key> to .env. The key comes from a user in an auth collection with useAPIKey on; set PAYLOAD_AUTH_COLLECTION when that collection is not users.',
  },
  wordpress: {
    keys: ['WORDPRESS_URL'],
    fix: 'Add WORDPRESS_URL=<site origin> to .env. For drafts (--staged), add WORDPRESS_USER and WORDPRESS_APP_PASSWORD (Users, Profile, Application Passwords).',
  },
};

const PAGE_SIZE = 100;

/** The env keys a source still lacks. */
export const missingEnv = (source: Exclude<Source, 'file'>, env: Env) =>
  NEEDS[source].keys.filter((k) => !env[k]);

const origin = (url: string) => url.replace(/\/+$/, '');

/** The request for one page (`page` counts from 1) of a collection. */
export function pageRequest(
  source: Exclude<Source, 'file'>,
  env: Env,
  collection: string,
  page: number,
  staged: boolean,
): Request {
  const c = encodeURIComponent(collection);
  if (source === 'webflow') {
    const listing = staged ? 'items' : 'items/live';
    return {
      url: `https://api.webflow.com/v2/collections/${c}/${listing}?offset=${(page - 1) * PAGE_SIZE}&limit=${PAGE_SIZE}`,
      headers: { authorization: `Bearer ${env.WEBFLOW_TOKEN}`, accept: 'application/json' },
    };
  }
  if (source === 'payload') {
    const auth = env.PAYLOAD_AUTH_COLLECTION || 'users';
    return {
      url: `${origin(env.PAYLOAD_URL ?? '')}/api/${c}?limit=${PAGE_SIZE}&page=${page}&depth=1${staged ? '&draft=true' : ''}`,
      headers: { authorization: `${auth} API-Key ${env.PAYLOAD_API_KEY}`, accept: 'application/json' },
    };
  }
  const headers: Record<string, string> = { accept: 'application/json' };
  if (env.WORDPRESS_USER && env.WORDPRESS_APP_PASSWORD)
    headers.authorization = `Basic ${btoa(`${env.WORDPRESS_USER}:${env.WORDPRESS_APP_PASSWORD}`)}`;
  return {
    url: `${origin(env.WORDPRESS_URL ?? '')}/wp-json/wp/v2/${c}?per_page=${PAGE_SIZE}&page=${page}&_embed=1${staged ? '&status=any' : ''}`,
    headers,
  };
}

type WebflowPage = {
  items: (Item & { isArchived?: boolean })[];
  pagination: { total: number; offset: number };
};
type PayloadPage = { docs: Item[]; hasNextPage: boolean };

/**
 * One page's items and whether another follows. Webflow's archived items
 * are dropped, since they are not on the site. WordPress answers with a bare
 * array and puts the page count in X-WP-TotalPages.
 */
export function readPage(
  source: Exclude<Source, 'file'>,
  body: unknown,
  page: number,
  totalPages?: string | null,
): Page {
  if (source === 'webflow') {
    const { items, pagination } = body as WebflowPage;
    return {
      items: items.filter((i) => !i.isArchived),
      more: items.length > 0 && pagination.offset + PAGE_SIZE < pagination.total,
    };
  }
  if (source === 'payload') {
    const { docs, hasNextPage } = body as PayloadPage;
    return { items: docs, more: hasNextPage };
  }
  const items = body as Item[];
  return { items, more: items.length > 0 && page < Number(totalPages ?? 1) };
}

/** Where a file keeps its items: a bare array, or the first array under a common key. */
export function itemsInFile(json: unknown): Item[] | null {
  if (Array.isArray(json)) return json as Item[];
  if (!json || typeof json !== 'object') return null;
  for (const key of ['items', 'entries', 'docs', 'data', 'results']) {
    const value = (json as Record<string, unknown>)[key];
    if (Array.isArray(value)) return value as Item[];
    if (value && typeof value === 'object') {
      const nested = itemsInFile(value);
      if (nested) return nested;
    }
  }
  return null;
}

/** Where an item's fields start: Webflow nests them under fieldData; every other source maps from the item itself. */
export const fieldRoot = (source: Source, item: Item): Item =>
  source === 'webflow' ? ((item.fieldData as Item | undefined) ?? {}) : item;

/** The named entities CMS output carries in practice; anything else is left as written. */
const NAMED: Record<string, string> = {
  quot: '"',
  apos: "'",
  lt: '<',
  gt: '>',
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  lsquo: '‘',
  rsquo: '’',
  ldquo: '“',
  rdquo: '”',
  eacute: 'é',
  copy: '©',
  reg: '®',
  trade: '™',
  amp: '&',
};

const decode = (s: string) =>
  s
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([\da-f]+);/gi, (_, n) => String.fromCodePoint(Number.parseInt(n, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => NAMED[name.toLowerCase()] ?? match);

/** WordPress's `rendered` fields are HTML; a fixture holds the text a reader sees. */
export const plainText = (html: string) =>
  decode(html.replace(/<[^>]*>/g, ''))
    .replace(/\s+/g, ' ')
    .trim();

/** The value at a dotted path (`title.rendered`, `_embedded.wp:featuredmedia.0.source_url`); undefined when it is not there. */
export function valueAt(root: unknown, path: string[]): unknown {
  let value = root;
  for (const part of path)
    value = value && typeof value === 'object' ? (value as Record<string, unknown>)[part] : undefined;
  if (typeof value === 'string' && path.at(-1) === 'rendered') return plainText(value);
  return value;
}

const MAX_DEPTH = 3;

/** Every leaf path in an item, with a short sample, so the user can pick what to map. */
export function fieldPaths(item: unknown, prefix = '', depth = 0): { path: string; sample: string }[] {
  if (!item || typeof item !== 'object' || depth > MAX_DEPTH)
    return prefix ? [{ path: prefix, sample: JSON.stringify(item ?? null).slice(0, 60) }] : [];
  const entries = Array.isArray(item)
    ? item.slice(0, 1).map((v, i) => [String(i), v] as const)
    : Object.entries(item);
  return entries.flatMap(([key, value]) => fieldPaths(value, prefix ? `${prefix}.${key}` : key, depth + 1));
}
