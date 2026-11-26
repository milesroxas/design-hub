// The signed session cookie for the deployed prototypes, on Web Crypto only,
// so the gate (proxy.ts), the review function (api/review.ts) and their tests
// share one implementation. There is one session: a person who used their
// one-time link. It names the person and their epoch, which a sign out
// everywhere or a revoke bumps, so either ends every session they hold. It
// lasts until their access ends, at most 400 days (the longest a browser
// keeps a cookie). HMAC-SHA256 with GATE_SECRET.
//
// It also carries when the store last said yes (checkedAt). For CHECK_SECONDS
// after that the gate trusts the signature; then it asks the store again and
// issues a fresh cookie, so a revoke, a sign out everywhere or a changed
// access end reaches every request within CHECK_SECONDS, whatever it claims to be.
// Every function that reads the clock takes `at`, so tests need not wait.

import { base64url } from '../core/bytes.ts';

export const PERSON_COOKIE = '__Host-hub_person';
const MAX_SESSION_SECONDS = 60 * 60 * 24 * 400;
/** How long the store's last yes is trusted before the gate asks again. */
export const CHECK_SECONDS = 5 * 60;

/**
 * `site` is the review store's URL. It is signed into every token, so two
 * projects that share one GATE_SECRET (a copied folder keeps its .env) never
 * accept each other's cookies. Empty without a store, when nobody can sign in anyway.
 */
export type Gate = { secret: string; site: string };

/** The gate's settings, or null when GATE_SECRET is missing or short (the gate then fails closed). */
export function readGate(env: Record<string, string | undefined>): Gate | null {
  const secret = env.GATE_SECRET ?? '';
  const site = (env.KV_REST_API_URL ?? env.UPSTASH_REDIS_REST_URL ?? '').replace(/\/$/, '');
  return secret.length >= 32 ? { secret, site } : null;
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

// A person session token: p3.<id>.<epoch>.<expires>.<checkedAt>.<sig>. The
// version is in the token and in the signed message, so a token of any other
// shape or version (0.6's `p1`, the unstamped `p2`) never verifies.
export type PersonClaim = { id: string; epoch: number };
export type SessionClaim = PersonClaim & { checkedAt: number };

const VERSION = 'p3';
// The site is signed, never written into the token; a newline cannot occur in a URL, so the parts cannot run together.
const personMessage = (site: string, id: string, epoch: number, expires: number, checkedAt: number) =>
  `${VERSION}\n${site}\n${id}.${epoch}.${expires}.${checkedAt}`;
const tokenText = (id: string, epoch: number, expires: number, checkedAt: number) =>
  `${VERSION}.${id}.${epoch}.${expires}.${checkedAt}`;

/** A token for someone the store said yes to at `at`, lasting to their access end. */
export async function issuePersonToken(
  gate: Gate,
  claim: PersonClaim,
  endsAt: string | null,
  at = new Date(),
): Promise<string> {
  const checkedAt = seconds(at);
  const expires = checkedAt + sessionSeconds(endsAt, at);
  const message = personMessage(gate.site, claim.id, claim.epoch, expires, checkedAt);
  return `${tokenText(claim.id, claim.epoch, expires, checkedAt)}.${await hmac(gate.secret, message)}`;
}

const isCount = (n: number) => Number.isInteger(n) && n >= 0;

const wellFormed = (parts: string[]) => {
  const [version, id, epoch, expires, checkedAt, sig, extra] = parts;
  return (
    version === VERSION &&
    /^[a-z0-9]+$/.test(id ?? '') &&
    [epoch, expires, checkedAt].every((n) => isCount(Number(n))) &&
    !!sig &&
    extra === undefined
  );
};

/** The person a token names when its signature and expiry hold; the caller decides whether to ask the store. */
export async function readPersonToken(
  gate: Gate,
  token: string | undefined,
  at = new Date(),
): Promise<SessionClaim | null> {
  const parts = (token ?? '').split('.');
  if (!wellFormed(parts)) return null;
  const [, id, epoch, expires, checkedAt, sig] = parts;
  if (Number(expires) <= seconds(at)) return null;
  const message = personMessage(gate.site, id, Number(epoch), Number(expires), Number(checkedAt));
  return sameText(sig, await hmac(gate.secret, message))
    ? { id, epoch: Number(epoch), checkedAt: Number(checkedAt) }
    : null;
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
