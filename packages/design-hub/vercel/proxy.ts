// Vercel Routing Middleware (the project's proxy.ts, named in vercel.json as
// proxy.entrypoint): the gate in front of every path of the deployed
// prototypes, the review API included. There is one way in, a one-time link
// that Studio makes for one named person:
//
//   GET  /invite/<token>   shows who the link is for, and uses nothing up, so
//                          a mail or chat preview that opens it costs nothing
//   POST /invite/<token>   uses the link up, sets the person's signed cookie
//                          (server/session.ts) and goes to the hub
//
// A used, expired or unknown link is 404. Every other path needs the cookie.
// It carries when the store last said yes; after CHECK_SECONDS (5 minutes)
// the gate asks the store again on the next request of any kind, so a revoke,
// a sign out everywhere or a changed access end reaches every request within
// minutes. A store that does not answer is 503, never a sign out. A Client
// asking for a prototype that is not client-facing, its page or any file
// built from it under /_p/<slug>/, gets 404. Without a session a
// page gets the sign-in page (401), which says what to do and has no form,
// and anything else a plain-text 401. Without GATE_SECRET the gate fails
// closed (503). Every store call runs in the site's one scope (SITE_SCOPE),
// and a cookie verifies only for the client it was signed to.
import { next } from '@vercel/functions';
import { base64, sha256 } from '../core/bytes.ts';
import { escapeHtml } from '../core/html.ts';
import { isPrototypeSlug, prototypeOfPath } from '../core/prototype.ts';
import type { Person } from '../core/review/model.ts';
import type { Review } from '../core/review/service.ts';
import { deployedReview } from '../server/api.ts';
import {
  clearedCookie,
  type Gate,
  isFresh,
  issuePersonToken,
  PERSON_COOKIE,
  readCookie,
  readGate,
  readPersonToken,
  type SessionClaim,
  SITE_SCOPE,
  sameOrigin,
  sessionCookie,
  sessionSeconds,
} from '../server/session.ts';

const DEFAULT_SITE_NAME = 'Prototypes';
const LINK_PATH = /^\/invite\/([\w-]{20,100})\/?$/;
// What the gate pages load before sign-in: the hub's face (the Vite plugin
// emits it at this fixed path) and the favicon. Nothing else.
export const GATE_FONT = '/_gate/geist.woff2';
const GATE_ASSETS = new Set([GATE_FONT, '/favicon.svg']);

// The gate pages. The CSS is a constant so its CSP hash is computed once and
// the pages carry no 'unsafe-inline', and they run no script at all. The gate
// is hub chrome, so it wears the hub's neutral system look (shell/system.css)
// inlined, never the project's brand. Geist (latin, variable) is the one
// font, preloaded so the first paint is already in it.
const CSS = `
@font-face{font-family:Geist;src:url(${GATE_FONT}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
:root{color-scheme:light;--bg:oklch(.985 0 0);--surface:oklch(1 0 0);--ink:oklch(.205 0 0);--ink-3:oklch(.46 0 0);--brand:oklch(.205 0 0);--brand-hover:oklch(.3 0 0);--on-brand:oklch(.985 0 0);--ring:0 0 0 2px oklch(1 0 0),0 0 0 4px oklch(.556 0 0);--shadow:0 1px 2px 0 oklch(0 0 0/.05);--raised:0 0 0 1px oklch(0 0 0/.06),0 1px 2px oklch(0 0 0/.05),0 12px 24px -8px oklch(0 0 0/.1);--ease-out:cubic-bezier(.23,1,.32,1);--ease-press:cubic-bezier(.33,1,.68,1);--ease-hover:cubic-bezier(.25,.46,.45,.94)}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:oklch(.145 0 0);--surface:oklch(.175 0 0);--ink:oklch(.985 0 0);--ink-3:oklch(.72 0 0);--brand:oklch(.985 0 0);--brand-hover:oklch(.87 0 0);--on-brand:oklch(.205 0 0);--ring:0 0 0 2px oklch(.175 0 0),0 0 0 4px oklch(.708 0 0);--shadow:0 0 #0000;--raised:0 0 0 1px oklch(1 0 0/.09)}}
*{box-sizing:border-box}
html{height:100%;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100%;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:var(--bg);color:var(--ink);font:14px/20px Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-optical-sizing:auto;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
.gate{width:100%;max-width:360px;padding:32px;background:var(--surface);border-radius:12px;box-shadow:var(--raised);transition:opacity 240ms var(--ease-out),transform 240ms var(--ease-out)}
@starting-style{.gate{opacity:0;transform:translateY(6px)}}
h1{margin:0 0 4px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
p{margin:0;color:var(--ink-3);text-wrap:pretty}
p+p{margin-top:8px}
strong{font-weight:500;color:var(--ink)}
form{margin:0}
.go{display:block;width:100%;height:44px;margin-top:24px;padding:0;border:0;border-radius:6px;background:var(--brand);color:var(--on-brand);font:inherit;font-weight:500;line-height:44px;text-align:center;text-decoration:none;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;box-shadow:var(--shadow);transition:background-color 120ms var(--ease-hover),transform 160ms var(--ease-press)}
.go:focus-visible{outline:2px solid transparent;outline-offset:2px;box-shadow:var(--ring)}
.go:active{transform:scale(.97)}
@media(hover:hover) and (pointer:fine){.go:hover{background:var(--brand-hover)}}
@media(max-width:400px){.gate{padding:24px}}
@media(prefers-reduced-motion:reduce){.gate{transition:opacity 240ms var(--ease-out)}@starting-style{.gate{transform:none}}.go:active{transform:none}}
`;

/** Which gate page this is, on its main element, so `design-hub share` can tell the sign-in page from anything else. */
type GatePage = 'sign-in' | 'link' | 'used';

function shell(siteName: string, page: GatePage, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${escapeHtml(siteName)}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preload" href="${GATE_FONT}" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
<main class="gate" data-gate="${page}">
<h1>${escapeHtml(siteName)}</h1>
${body}
</main>
</body>
</html>
`;
}

const signInPage = (siteName: string) =>
  shell(
    siteName,
    'sign-in',
    `<p>To sign in, open the link the studio sent you. Each link signs in one device, then stops working.</p>
<p>For another device, or if your link has stopped working, ask the studio for a new one.</p>`,
  );

// A GET shows who the link is for and a POST signs them in, so a mail
// scanner that opens every link never uses it up.
const linkPage = (siteName: string, person: { name: string; team: string }) =>
  shell(
    siteName,
    'link',
    `<p>This link signs in <strong>${escapeHtml(person.name)}</strong>, ${escapeHtml(person.team)}, on this device.</p>
<p>It works once. For another device, ask the studio for a new link.</p>
<form method="post"><button class="go" type="submit" autofocus>Continue</button></form>`,
  );

// Someone who opens their link again on a device it already signed in gets
// here too, so the page offers the way in as well.
const usedPage = (siteName: string) =>
  shell(
    siteName,
    'used',
    `<p>This link has been used, has expired or was removed. Each link signs in one device, then stops working.</p>
<p>Ask the studio for a new one. If this device is already signed in, open the prototypes.</p>
<a class="go" href="/">Open the prototypes</a>`,
  );

const SIGNED_OUT = 'Sign in with the link the studio sent you.';
const USED = 'This link has been used, has expired or was removed.';
const OPEN_IN_BROWSER = 'Open this link in a browser to sign in.';

const PREVIEWS: Record<GatePage, (siteName: string) => string> = {
  'sign-in': signInPage,
  link: (siteName) => linkPage(siteName, { name: 'Rae Chen', team: 'Acme' }),
  used: usedPage,
};

// `design-hub dev` has no gate; the Vite plugin serves this at /_gate/ (?page=link or ?page=used) so the pages can be reviewed.
export async function gatePreview(
  page: string | null,
  siteName = DEFAULT_SITE_NAME,
): Promise<{ html: string; csp: string }> {
  // hasOwn, so ?page=__proto__ or toString never reaches Object.prototype.
  const render = page !== null && Object.hasOwn(PREVIEWS, page) ? PREVIEWS[page as GatePage] : signInPage;
  return { html: render(siteName), csp: await csp() };
}

let cspPromise: Promise<string> | undefined;
function csp() {
  cspPromise ??= sha256(CSS).then(
    (css) =>
      `default-src 'none'; style-src 'sha256-${base64(css)}'; script-src 'none'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`,
  );
  return cspPromise;
}

const NO_STORE = 'no-store, max-age=0';

function wantsHtml(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document' || dest === 'iframe';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

const isRead = (request: Request) => request.method === 'GET' || request.method === 'HEAD';

type Extra = {
  cookie?: string;
  allow?: string;
  referrer?: 'no-referrer' | 'same-origin';
  /** Seconds, on a 503 that passes (a store that did not answer), so the review panel retries instead of switching off. */
  retryAfter?: number;
};

/**
 * Every answer the gate makes itself carries these: never cached, never
 * indexed, no referrer. The link page alone sends a same-origin referrer, so
 * its Continue POST carries a real Origin: with no-referrer a browser sends
 * `Origin: null`, which sameOrigin trusts only beside Sec-Fetch-Site, and
 * older Safari sends no Sec-Fetch-Site.
 */
function gateHeaders(type: string, { cookie, allow, referrer = 'no-referrer', retryAfter }: Extra): Headers {
  const headers = new Headers({
    'cache-control': NO_STORE,
    'content-type': type,
    'x-robots-tag': 'noindex, nofollow',
    'referrer-policy': referrer,
  });
  if (cookie) headers.append('set-cookie', cookie);
  if (allow) headers.set('allow', allow);
  if (retryAfter) headers.set('retry-after', String(retryAfter));
  return headers;
}

const plain = (request: Request, status: number, text: string, extra: Extra = {}) =>
  new Response(request.method === 'HEAD' ? null : text, {
    status,
    headers: gateHeaders('text/plain; charset=utf-8', extra),
  });

/** A gate page for a browser, or `text` for anything else (a fetch, an asset, a preview bot). */
async function page(request: Request, status: number, html: string, text: string, extra: Extra = {}) {
  if (!wantsHtml(request)) return plain(request, status, text, extra);
  const headers = gateHeaders('text/html; charset=utf-8', extra);
  headers.set('content-security-policy', await csp());
  return new Response(request.method === 'HEAD' ? null : html, { status, headers });
}

const unavailable = (request: Request, error: string) => plain(request, 503, error);
/** One answer for a prototype a Client may not have, whether it is internal or not there at all. */
const notFound = (request: Request) => plain(request, 404, NOT_FOUND);
const NOT_FOUND = 'Not found.';
/** The store did not answer: a 503 that passes, so it says when to try again. */
const storeDown = (request: Request) => plain(request, 503, STORE_DOWN, { retryAfter: 30 });
const STORE_DOWN = 'The review store did not answer. Try again in a minute.';
const NO_STORE_YET = 'Review is not set up on this site: pnpm bootstrap --vercel <project> --review.';

/** One request at one moment: `at` is the gate's clock, so freshness is tested without waiting. */
type Ctx = { siteName: string; request: Request; at: Date };

/**
 * A store call that can fail without signing anyone out: `undefined` when the
 * store did not answer, so the caller answers 503 and leaves the cookie alone.
 */
async function ask<T>(run: () => Promise<T>): Promise<T | undefined> {
  try {
    return await run();
  } catch (error) {
    console.error('[gate]', error);
    return undefined;
  }
}

async function showLink(ctx: Ctx, token: string): Promise<Response> {
  const { siteName, request } = ctx;
  const setup = deployedReview(process.env, null, () => ctx.at);
  if ('error' in setup) return unavailable(request, setup.error);
  const person = await ask(() => setup.review.peekLink(SITE_SCOPE, token));
  if (person === undefined) return storeDown(request);
  return person
    ? page(request, 200, linkPage(siteName, person), OPEN_IN_BROWSER, { referrer: 'same-origin' })
    : page(request, 404, usedPage(siteName), USED);
}

/** The cookie for someone the store just said yes to, lasting to their access end. */
async function sessionFor(gate: Gate, person: Person, at: Date): Promise<string> {
  const claim = { id: person.id, epoch: person.epoch, kind: person.kind };
  const token = await issuePersonToken(gate, claim, person.accessEndsAt, at);
  return sessionCookie(PERSON_COOKIE, token, sessionSeconds(person.accessEndsAt, at));
}

async function signInWithLink(ctx: Ctx, token: string): Promise<Response> {
  const { siteName, request, at } = ctx;
  if (!sameOrigin(request)) return plain(request, 403, 'Forbidden');
  const setup = deployedReview(process.env, null, () => ctx.at);
  if ('error' in setup) return unavailable(request, setup.error);
  const person = await ask(() => setup.review.useLink(SITE_SCOPE, token));
  if (person === undefined) return storeDown(request);
  if (!person) return page(request, 404, usedPage(siteName), USED);
  const headers = gateHeaders('text/plain; charset=utf-8', {
    cookie: await sessionFor(setup.gate, person, at),
  });
  headers.set('location', '/');
  return new Response(null, { status: 303, headers });
}

async function link(ctx: Ctx, token: string): Promise<Response> {
  if (ctx.request.method === 'POST') return signInWithLink(ctx, token);
  if (isRead(ctx.request)) return showLink(ctx, token);
  return plain(ctx.request, 405, 'Method not allowed', { allow: 'GET, HEAD, POST' });
}

/**
 * No session. A page gets the sign-in page, and anything else (an asset, a
 * fetch, a POST to any path but a link) a plain 401: there is nothing to
 * sign in with here. A cookie that was sent but does not hold is cleared.
 */
function signedOut({ siteName, request }: Ctx, staleCookie: boolean): Promise<Response> | Response {
  const extra = staleCookie ? { cookie: clearedCookie(PERSON_COOKIE) } : {};
  if (!isRead(request)) return plain(request, 401, SIGNED_OUT, extra);
  return page(request, 401, signInPage(siteName), SIGNED_OUT, extra);
}

const pass = (cookie?: string) =>
  next({ headers: { 'cache-control': 'private, no-store', ...(cookie ? { 'set-cookie': cookie } : {}) } });

/**
 * The prototype boundary, for a Client only: a path that belongs to a
 * prototype (its page, or a file under /_p/<slug>/) passes when that
 * prototype is client-facing, asked of the store on every request. Anything
 * else is the same 404, for an internal prototype, one that does not exist and
 * /_p/all.js alike, so the answer says nothing about what is there. A store
 * that does not answer is 503. Hub paths pass with no store read.
 */
async function clientMay(ctx: Ctx, review: Review, slug: string): Promise<Response | null> {
  if (!isPrototypeSlug(slug)) return notFound(ctx.request);
  const audience = await ask(() => review.audienceOf(SITE_SCOPE, slug));
  if (audience === undefined) return storeDown(ctx.request);
  return audience === 'client' ? null : notFound(ctx.request);
}

/** Asks the store whether a stale session still holds: the person, or the answer that ends the request. */
async function recheck(ctx: Ctx, review: Review, claim: SessionClaim): Promise<Person | Response> {
  const current = await ask(() => review.sessionPerson(SITE_SCOPE, claim.id, claim.epoch));
  if (current === undefined) return storeDown(ctx.request);
  return current ?? (await signedOut(ctx, true));
}

/**
 * A signed session. While the store's last yes is fresh the signature is
 * enough. Once it is stale the store is asked, whatever the request says it
 * is (its headers are the client's to choose): yes passes with a fresh cookie
 * whose expiry follows the person's current access end; no signs out and
 * clears the cookie; no answer is 503 and the cookie stays. Then, for
 * anyone but Studio, the prototype boundary on a prototype's path.
 */
async function personSession(ctx: Ctx, gate: Gate, claim: SessionClaim): Promise<Response> {
  const slug = prototypeOfPath(new URL(ctx.request.url).pathname);
  const fresh = isFresh(claim, ctx.at);
  if (fresh && (claim.kind === 'studio' || slug === null)) return pass();
  const setup = deployedReview(process.env, null, () => ctx.at);
  if ('error' in setup) return unavailable(ctx.request, setup.error);
  const current = fresh ? null : await recheck(ctx, setup.review, claim);
  if (current instanceof Response) return current;
  const kind = current ? current.kind : claim.kind;
  const refused = kind !== 'studio' && slug !== null ? await clientMay(ctx, setup.review, slug) : null;
  return refused ?? pass(current ? await sessionFor(gate, current, ctx.at) : undefined);
}

export type ProxyOptions = {
  /** The gate pages' title: the project's name as reviewers know it. */
  siteName?: string;
  /** The gate's clock; tests move it instead of waiting. */
  now?: () => Date;
};

/** The middleware a project's proxy.ts default-exports. */
export function createProxy({ siteName = DEFAULT_SITE_NAME, now = () => new Date() }: ProxyOptions = {}) {
  return async function proxy(request: Request): Promise<Response> {
    const gate = readGate(process.env);
    if (!gate) return unavailable(request, 'The prototype gate is not configured.');
    const ctx: Ctx = { siteName, request, at: now() };
    const url = new URL(request.url);
    const linked = url.pathname.match(LINK_PATH);
    if (linked) return link(ctx, linked[1]);
    if (GATE_ASSETS.has(url.pathname) && isRead(request)) return next();
    const cookie = readCookie(request, PERSON_COOKIE);
    const claim = await readPersonToken(gate, cookie, ctx.at);
    if (claim) return personSession(ctx, gate, claim);
    // Tokens are signed to the store's URL, so without one none verifies. Clearing cookies then
    // would turn a missing env var into everyone locked out, since links work once: answer 503 instead.
    if (cookie !== undefined && gate.site === '') return unavailable(request, NO_STORE_YET);
    return signedOut(ctx, cookie !== undefined);
  };
}
