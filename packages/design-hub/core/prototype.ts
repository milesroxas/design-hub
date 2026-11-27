// What a prototype's slug may be, and where the files built from it live.
// One rule for the registry's scan, `design-hub new` and the gate, so a
// folder the hub lists is always a path the gate knows how to refuse.
import { SLUG } from './feature.ts';

/**
 * First path segments the hub owns, never a prototype: the walkthroughs,
 * the review API, and the shared bundle.
 */
export const RESERVED = ['guide', 'api', 'assets'] as const;

/**
 * Everything built from `prototypes/<slug>/` lands under `/_p/<slug>/`, and
 * Studio's list of every slug at `/_p/all.js`. `_p` can never be a slug: SLUG
 * has no underscore.
 */
export const PROTOTYPE_DIR = '_p';
export const ALL_FILE = `${PROTOTYPE_DIR}/all.js`;
export const entryFile = (slug: string) => `${PROTOTYPE_DIR}/${slug}/entry.js`;

/** Whether `name` can be a prototype's folder: kebab-case and not one of the hub's own paths. */
export const isPrototypeSlug = (name: unknown): name is string =>
  typeof name === 'string' && SLUG.test(name) && !(RESERVED as readonly string[]).includes(name);

/**
 * A path's segments as a file server might read them, or null when the path
 * could mean more than one file: it does not decode, still holds a `%` after
 * decoding (`%255F`), holds a backslash, a `.` or `..` segment, or an empty
 * segment other than the last. The gate refuses those to a Client rather than
 * guess how the server resolves them. An encoded space or letter decodes and passes.
 */
function segments(pathname: string): string[] | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (/[%\\]/.test(decoded)) return null;
  const parts = decoded.split('/').slice(1);
  if (parts.at(-1) === '') parts.pop();
  return parts.some((p) => p === '' || p === '.' || p === '..') ? null : parts;
}

/**
 * The first path segments that are the hub's own, for anyone signed in: the
 * reserved routes, the gate's font folder, and the files the hub serves at
 * the top (shell/index.html, shell/public/favicon.svg).
 */
const HUB_ROOT: readonly string[] = [...RESERVED, '_gate', 'index.html', 'favicon.svg'];

/**
 * Which prototype a request path belongs to, for the gate: the name a
 * prototype path carries, or null for a hub path (`/`, or a first segment in
 * HUB_ROOT). The first segment, decoded, must be one of those, `_p`, or a
 * prototype slug; anything else (`_P`, `_p;x`, `_p.`, a full-width `＿p`)
 * belongs to `''`, refused like an internal prototype. A path under `/_p/`
 * always belongs to one, so its name may be no slug at all (`all.js`), which
 * no audience makes client-facing. A path that could mean more than one file
 * belongs to `''` too.
 */
export function prototypeOfPath(pathname: string): string | null {
  const parts = segments(pathname);
  if (!parts) return '';
  const [first, second] = parts;
  if (first === undefined || HUB_ROOT.includes(first)) return null;
  if (first === PROTOTYPE_DIR) return second ?? '';
  return isPrototypeSlug(first) ? first : '';
}

/**
 * Whether a built prototype's entry is there for this person, asked with a
 * HEAD before it is imported. Not there: a 404 (the gate's answer for a
 * prototype this person may not open, or none at all), or a 200 that is not
 * JavaScript (the host's page for an entry that was never built). Any other
 * answer (401, 500, 503) is an error, never "not there", so an outage never
 * reads as nothing shared.
 */
export async function probeEntry(path: string, fetcher: typeof fetch): Promise<boolean> {
  const head = await fetcher(path, { method: 'HEAD', credentials: 'same-origin' });
  if (head.status === 404) return false;
  if (head.status !== 200) throw new Error(`${path} answered ${head.status}.`);
  return /javascript/.test(head.headers.get('content-type') ?? '');
}
