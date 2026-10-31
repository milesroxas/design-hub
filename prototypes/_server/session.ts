// Signed cookies for the deployed prototypes, on Web Crypto only, so the
// gate (proxy.ts), the review function (api/review.ts) and their tests share
// one implementation. Two sessions:
//
//   gate     the shared password was typed: view everything, comment on nothing.
//            The signature covers the password, so rotating it signs everyone out.
//   person   an invite link was opened: view everything, and comment as that
//            person. The signature covers the person's epoch, which a reissue
//            or revoke bumps, so either ends every session they hold.
//
// Both are HMAC-SHA256 with GATE_SECRET and last 30 days.

import { base64url, sha256 } from '../_core/bytes.ts';

export const GATE_COOKIE = '__Host-hub_gate';
export const PERSON_COOKIE = '__Host-hub_person';
const SESSION_SECONDS = 60 * 60 * 24 * 30;

export type Gate = { password: string; secret: string };

/** The gate's settings, or null when either is missing (the gate then fails closed). */
export function readGate(env: Record<string, string | undefined>): Gate | null {
  const password = env.GATE_PASSWORD ?? '';
  const secret = env.GATE_SECRET ?? '';
  return password.length > 0 && secret.length >= 32 ? { password, secret } : null;
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
const nowSeconds = () => Math.floor(Date.now() / 1000);
const live = (expires: number) => Number.isInteger(expires) && expires > nowSeconds();

export async function passwordMatches(gate: Gate, submitted: string): Promise<boolean> {
  const [a, b] = await Promise.all([sha256(submitted), sha256(gate.password)]);
  return timingSafeEqual(a, b);
}

// A gate session token: <expires>.<sig>
async function gateSignature(gate: Gate, expires: number): Promise<string> {
  return hmac(gate.secret, `v1.${expires}.${base64url(await sha256(gate.password))}`);
}

export async function issueGateToken(gate: Gate): Promise<string> {
  const expires = nowSeconds() + SESSION_SECONDS;
  return `${expires}.${await gateSignature(gate, expires)}`;
}

export async function gateTokenIsValid(gate: Gate, token: string | undefined): Promise<boolean> {
  const [expires, sig, extra] = (token ?? '').split('.');
  if (!sig || extra !== undefined || !live(Number(expires))) return false;
  return sameText(sig, await gateSignature(gate, Number(expires)));
}

// A person session token: <id>.<epoch>.<expires>.<sig>
export type PersonClaim = { id: string; epoch: number };

const personMessage = (id: string, epoch: number, expires: number) => `p1.${id}.${epoch}.${expires}`;

export async function issuePersonToken(gate: Gate, claim: PersonClaim): Promise<string> {
  const expires = nowSeconds() + SESSION_SECONDS;
  return `${claim.id}.${claim.epoch}.${expires}.${await hmac(gate.secret, personMessage(claim.id, claim.epoch, expires))}`;
}

/** The person a token names when its signature and expiry hold; the caller still checks the store. */
export async function readPersonToken(gate: Gate, token: string | undefined): Promise<PersonClaim | null> {
  const [id, epochText, expiresText, sig, extra] = (token ?? '').split('.');
  const epoch = Number(epochText);
  const expires = Number(expiresText);
  if (
    !id ||
    !sig ||
    extra !== undefined ||
    !/^[a-z0-9]+$/.test(id) ||
    !Number.isInteger(epoch) ||
    !live(expires)
  )
    return null;
  return sameText(sig, await hmac(gate.secret, personMessage(id, epoch, expires))) ? { id, epoch } : null;
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

export const sessionCookie = (name: string, value: string) =>
  `${name}=${value}; Path=/; Max-Age=${SESSION_SECONDS}; HttpOnly; Secure; SameSite=Lax`;
export const clearedCookie = (name: string) => `${name}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;

// Same-origin check for a state-changing request. Sec-Fetch-Site is the
// browser's own verdict; Origin backs it up for browsers without it. Host
// comes from the forwarded header, since request.url carries the deployment
// host behind a custom domain. A browser sends "Origin: null" on a navigation
// from a no-referrer document, so null is accepted only with a same-origin verdict.
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
