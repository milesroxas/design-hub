// The signed session cookie for the deployed prototypes, on Web Crypto only,
// so the gate (proxy.ts), the review function (api/review.ts) and their tests
// share one implementation. There is one session: a person who used their
// one-time link. It names the person and their epoch, which a sign out
// everywhere or a revoke bumps, so either ends every session they hold. It
// lasts until their access ends, at most 400 days (the longest a browser
// keeps a cookie). HMAC-SHA256 with GATE_SECRET.
//
// It also carries the person's kind, the client it was signed to, and when
// the store last said yes (checkedAt). For CHECK_SECONDS
// after that the gate trusts the signature; then it asks the store again and
// issues a fresh cookie, so a revoke, a sign out everywhere or a changed
// access end reaches every request within CHECK_SECONDS, whatever it claims to be.
// Every function that reads the clock takes `at`, so tests need not wait.

import { base64url } from '../core/bytes.ts';
import { SLUG } from '../core/feature.ts';
import { PERSON_KINDS, type PersonKind, type Scope } from '../core/review/model.ts';

export const PERSON_COOKIE = '__Host-hub_person';
const MAX_SESSION_SECONDS = 60 * 60 * 24 * 400;
/** How long the store's last yes is trusted before the gate asks again. */
export const CHECK_SECONDS = 5 * 60;

/**
 * The one client and project a site serves until sites are routed by host:
 * the gate signs every token to this client, and the API, the gate and the
 * CLI act in this scope.
 */
export const SITE_SCOPE: Scope = { client: 'site', project: 'site' };

/**
 * `site` is the review store's URL. It is signed into every token, so two
 * projects that share one GATE_SECRET (a copied folder keeps its .env) never
 * accept each other's cookies. Empty without a store, when nobody can sign in anyway.
 * `client` is the client this gate serves, or `studio` for the studio's own
 * host: a token is signed to it and verifies only where it is the same.
 */
export type Gate = { secret: string; site: string; client: string | 'studio' };

/** The gate's settings, or null when GATE_SECRET is missing or short (the gate then fails closed). */
export function readGate(env: Record<string, string | undefined>): Gate | null {
  const secret = env.GATE_SECRET ?? '';
  const site = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/$/, '');
  return secret.length >= 32 ? { secret, site, client: SITE_SCOPE.client } : null;
}

const encoder = new TextEncoder();

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(message))));
}

// Runs over every byte whatever the input, so a mismatch costs the same time
// wherever it falls. Callers pass equal-length digests, so length is not a leak.
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ (b[i % b.length] ?? 0);
  return diff === 0;
}

const sameText = (a: string, b: string) => timingSafeEqual(encoder.encode(a), encoder.encode(b));
const seconds = (at: Date) => Math.floor(at.getTime() / 1000);

/**
 * How long a session started at `at` lasts, in seconds: to the access end,
 * capped at 400 days, and 0 for an access end that has passed or does not parse.
 */
export function sessionSeconds(endsAt: string | null, at = new Date()): number {
  if (endsAt === null) return MAX_SESSION_SECONDS;
  const left = Math.floor(Date.parse(endsAt) / 1000) - seconds(at);
  return Number.isFinite(left) ? Math.max(0, Math.min(MAX_SESSION_SECONDS, left)) : 0;
}

// A person session token: p5.<id>.<epoch>.<kind>.<client>.<expires>.<checkedAt>.<sig>.
// The kind (studio or client) is signed in, so the gate tells a Client's
// request from Studio's without asking the store while the stamp is fresh.
// The client is the Gate's it was issued by, signed in and compared, so a
// token made for one client never opens another's, whoever holds it.
// The version is in the token and in the signed message, so a token of any
// other shape or version (`p4` and every one before it) never verifies.
export type PersonClaim = { id: string; epoch: number; kind: PersonKind };
export type SessionClaim = PersonClaim & { checkedAt: number };

const VERSION = 'p5';
// The site is signed, never written into the token; a newline cannot occur in a URL, so the parts cannot run together.
const signed = (site: string, text: string) => `${VERSION}\n${site}\n${text}`;
const tokenText = (claim: PersonClaim, client: string, expires: number, checkedAt: number) =>
  `${claim.id}.${claim.epoch}.${claim.kind}.${client}.${expires}.${checkedAt}`;

/** A token for someone the store said yes to at `at`, signed to the gate's client, lasting to their access end. */
export async function issuePersonToken(
  gate: Gate,
  claim: PersonClaim,
  endsAt: string | null,
  at = new Date(),
): Promise<string> {
  const checkedAt = seconds(at);
  const text = tokenText(claim, gate.client, checkedAt + sessionSeconds(endsAt, at), checkedAt);
  return `${VERSION}.${text}.${await hmac(gate.secret, signed(gate.site, text))}`;
}

const isCount = (n: number) => Number.isInteger(n) && n >= 0;
const isKind = (k: string | undefined): k is PersonKind => PERSON_KINDS.includes(k as PersonKind);

/** The person a token names when its version, client, signature and expiry hold; the caller decides whether to ask the store. */
export async function readPersonToken(
  gate: Gate,
  token: string | undefined,
  at = new Date(),
): Promise<SessionClaim | null> {
  const [version, id, epoch, kind, client, expires, checkedAt, sig, extra] = (token ?? '').split('.');
  if (version !== VERSION || !/^[a-z0-9]+$/.test(id ?? '') || !isKind(kind) || !sig || extra !== undefined)
    return null;
  if (!SLUG.test(client ?? '') || client !== gate.client) return null;
  if (![epoch, expires, checkedAt].every((n) => isCount(Number(n))) || Number(expires) <= seconds(at))
    return null;
  const claim = { id, epoch: Number(epoch), kind, checkedAt: Number(checkedAt) };
  const text = tokenText(claim, client, Number(expires), claim.checkedAt);
  return sameText(sig, await hmac(gate.secret, signed(gate.site, text))) ? claim : null;
}

/** Whether the store's yes in this claim is recent enough to trust without asking again. */
export function isFresh(claim: SessionClaim, at = new Date()): boolean {
  const age = seconds(at) - claim.checkedAt;
  return age >= 0 && age < CHECK_SECONDS;
}

export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq > 0 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return undefined;
}

/** A session cookie that lasts `seconds`: sessionSeconds of the same access end as its token. */
export const sessionCookie = (name: string, value: string, seconds: number) =>
  `${name}=${value}; Path=/; Max-Age=${seconds}; HttpOnly; Secure; SameSite=Lax`;
export const clearedCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Same-origin check for a state-changing request. Sec-Fetch-Site is the
// browser's own verdict; Origin backs it up for browsers without it. Host
// comes from the forwarded header, since request.url carries the deployment
// host behind a custom domain. A browser sends "Origin: null" on a navigation
// from a no-referrer document, so null is accepted only with a same-origin verdict.
// A request with neither header is not from a browser that could be tricked
// into it (every current browser sends Origin on a POST), so it passes: it
// holds whatever it sends, and a forged request needs a victim's browser.
export function sameOrigin(request: Request): boolean {
  const site = request.headers.get('sec-fetch-site');
  if (site && site !== 'same-origin') return false;
  const origin = request.headers.get('origin');
  if (!origin) return true;
  if (origin === 'null') return site === 'same-origin';
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? new URL(request.url).host;
  try {
    const o = new URL(origin);
    return (o.protocol === 'https:' || o.hostname === 'localhost') && o.host === host;
  } catch {
    return false;
  }
}
