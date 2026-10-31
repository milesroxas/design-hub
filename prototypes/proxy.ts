// Vercel Routing Middleware (vercel.json, proxy.entrypoint): the gate in
// front of every path of the deployed prototypes, the review API included.
// Two ways in, both signed cookies (_server/session.ts):
//
//   the shared password   view only; the form posts back to the same URL and
//                         keeps the hash through the redirect
//   an invite link        /invite/<token> signs one person in, to comment as
//                         themselves; a revoke or reissue ends it on their
//                         next page load
//
// With GATE_PASSWORD or GATE_SECRET missing the gate fails closed (503).
import { next } from '@vercel/functions';
import { base64, sha256 } from './_core/bytes.ts';
import { escapeHtml } from './_core/html.ts';
import { deployedReview } from './_server/api.ts';
import {
  clearedCookie,
  GATE_COOKIE,
  type Gate,
  gateTokenIsValid,
  issueGateToken,
  issuePersonToken,
  PERSON_COOKIE,
  type PersonClaim,
  passwordMatches,
  readCookie,
  readGate,
  readPersonToken,
  sameOrigin,
  sessionCookie,
} from './_server/session.ts';

// The gate page's title. A project names it here; the middleware does not load the kit.
const SITE_NAME = 'Prototypes';
const WRONG_PASSWORD_DELAY_MS = 800;
const MAX_PASSWORD_LENGTH = 256;
const INVITE_PATH = /^\/invite\/([\w-]{20,100})\/?$/;
// What the gate page itself loads, served before sign-in: the hub's face
// (vite.config.ts emits it at this fixed path) and the favicon. Nothing else.
export const GATE_FONT = '/_gate/geist.woff2';
const GATE_ASSETS = new Set([GATE_FONT, '/favicon.svg']);

// The gate page. CSS and JS are constants so their CSP hashes can be computed
// once and the page carries no 'unsafe-inline'. The gate is hub chrome, so it
// wears the hub's neutral system look (_shell/system.css) inlined, never the
// project's brand. Geist (latin, variable) is the one font, preloaded so the
// first paint is already in it.
const CSS = `
@font-face{font-family:Geist;src:url(${GATE_FONT}) format("woff2");font-weight:100 900;font-style:normal;font-display:swap}
:root{color-scheme:light;--bg:oklch(.985 0 0);--surface:oklch(1 0 0);--ink:oklch(.205 0 0);--ink-2:oklch(.371 0 0);--ink-3:oklch(.46 0 0);--ink-4:oklch(.54 0 0);--line:oklch(.87 0 0);--fill-hover:oklch(.97 0 0);--brand:oklch(.205 0 0);--brand-hover:oklch(.3 0 0);--on-brand:oklch(.985 0 0);--error:oklch(.505 .213 27.518);--error-line:oklch(.637 .237 25.331);--ring:0 0 0 2px oklch(1 0 0),0 0 0 4px oklch(.556 0 0);--ring-error:0 0 0 2px oklch(1 0 0),0 0 0 4px oklch(.637 .237 25.331);--shadow:0 1px 2px 0 oklch(0 0 0/.05);--raised:0 0 0 1px oklch(0 0 0/.06),0 1px 2px oklch(0 0 0/.05),0 12px 24px -8px oklch(0 0 0/.1);--ease-out:cubic-bezier(.23,1,.32,1);--ease-press:cubic-bezier(.33,1,.68,1);--ease-hover:cubic-bezier(.25,.46,.45,.94)}
@media(prefers-color-scheme:dark){:root{color-scheme:dark;--bg:oklch(.145 0 0);--surface:oklch(.175 0 0);--ink:oklch(.985 0 0);--ink-2:oklch(.87 0 0);--ink-3:oklch(.72 0 0);--ink-4:oklch(.66 0 0);--line:oklch(.32 0 0);--fill-hover:oklch(.215 0 0);--brand:oklch(.985 0 0);--brand-hover:oklch(.87 0 0);--on-brand:oklch(.205 0 0);--error:oklch(.704 .191 22.216);--error-line:oklch(.704 .191 22.216);--ring:0 0 0 2px oklch(.175 0 0),0 0 0 4px oklch(.708 0 0);--ring-error:0 0 0 2px oklch(.175 0 0),0 0 0 4px oklch(.704 .191 22.216);--shadow:0 0 #0000;--raised:0 0 0 1px oklch(1 0 0/.09)}}
*{box-sizing:border-box}
html{height:100%;-webkit-text-size-adjust:100%;-webkit-tap-highlight-color:transparent}
body{margin:0;min-height:100%;display:grid;place-items:center;padding:max(24px,env(safe-area-inset-top)) max(16px,env(safe-area-inset-right)) max(24px,env(safe-area-inset-bottom)) max(16px,env(safe-area-inset-left));background:var(--bg);color:var(--ink);font:14px/20px Geist,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;font-optical-sizing:auto;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale;text-rendering:optimizeLegibility}
[hidden]{display:none!important}
.gate{width:100%;max-width:360px;padding:32px;background:var(--surface);border-radius:12px;box-shadow:var(--raised);transition:opacity 240ms var(--ease-out),transform 240ms var(--ease-out)}
@starting-style{.gate{opacity:0;transform:translateY(6px)}}
h1{margin:0 0 4px;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.02em;text-wrap:balance}
.hint{margin:0 0 24px;color:var(--ink-3);text-wrap:pretty}
.hint strong{font-weight:500;color:var(--ink)}
label{display:block;margin-bottom:6px;font-weight:500;color:var(--ink-2)}
.field{position:relative}
input{display:block;width:100%;height:40px;padding:0 44px 0 12px;border:1px solid var(--line);border-radius:6px;background:var(--surface);color:var(--ink);box-shadow:var(--shadow);font:inherit;transition:border-color 120ms var(--ease-hover),box-shadow 120ms var(--ease-hover)}
input:focus-visible{outline:2px solid transparent;outline-offset:2px;box-shadow:var(--ring),var(--shadow)}
input[aria-invalid=true]{border-color:var(--error-line)}
input[aria-invalid=true]:focus-visible{box-shadow:var(--ring-error),var(--shadow)}
.toggle{position:absolute;top:4px;right:4px;width:32px;height:32px;display:grid;place-items:center;margin:0;padding:0;border:0;border-radius:2px;background:transparent;color:var(--ink-4);cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;transition:color 120ms var(--ease-hover),background-color 120ms var(--ease-hover)}
.toggle::before{content:"";position:absolute;inset:-4px}
.toggle svg{display:block}
.toggle:focus-visible{outline:2px solid transparent;box-shadow:var(--ring)}
.toggle:active{color:var(--ink-2)}
.toggle[aria-pressed=true] .show,.toggle[aria-pressed=false] .hide{display:none}
@media(hover:hover) and (pointer:fine){.toggle:hover{color:var(--ink-2);background:var(--fill-hover)}}
.note{margin:8px 0 0;color:var(--ink-3)}
.error{color:var(--error)}
.go{display:block;width:100%;height:44px;margin-top:20px;border:0;border-radius:6px;background:var(--brand);color:var(--on-brand);font:inherit;font-weight:500;cursor:pointer;touch-action:manipulation;-webkit-user-select:none;user-select:none;box-shadow:var(--shadow);transition:background-color 120ms var(--ease-hover),transform 160ms var(--ease-press),opacity 120ms var(--ease-hover)}
.go:focus-visible{outline:2px solid transparent;outline-offset:2px;box-shadow:var(--ring)}
.go:active{transform:scale(.97)}
form[data-busy] .go{opacity:.7;pointer-events:none}
@media(hover:hover) and (pointer:fine){.go:hover{background:var(--brand-hover)}}
@media(pointer:coarse){input{height:44px;font-size:16px}.toggle{width:36px;height:36px}}
@media(max-width:400px){.gate{padding:24px}}
@media(prefers-reduced-motion:reduce){.gate{transition:opacity 240ms var(--ease-out)}@starting-style{.gate{transform:none}}.go:active{transform:none}}
`;

// Keeps the hash route the visitor asked for (a form posts to its action
// without the fragment), shows the password on request, and says when Caps
// Lock is on. The toggle swallows pointerdown so the caret stays in the field.
const JS = `var f=document.forms[0],p=document.getElementById('password'),t=document.getElementById('toggle'),c=document.getElementById('caps');
if(location.hash){f.action=location.pathname+location.search+location.hash}
t.addEventListener('pointerdown',function(e){e.preventDefault()});
t.addEventListener('click',function(){var s=p.type==='password';p.type=s?'text':'password';t.setAttribute('aria-pressed',s);t.setAttribute('aria-label',s?'Hide password':'Show password')});
function caps(e){if(e.getModifierState){c.hidden=!e.getModifierState('CapsLock')}}
p.addEventListener('keydown',caps);p.addEventListener('keyup',caps);p.addEventListener('blur',function(){c.hidden=true});
f.addEventListener('submit',function(){f.setAttribute('data-busy','')});
addEventListener('pageshow',function(){f.removeAttribute('data-busy')});`;

const EYE =
  '<svg class="show" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.42 12.713c-.136-.215-.204-.323-.242-.49a1.173 1.173 0 0 1 0-.446c.038-.167.106-.274.242-.49C3.546 9.505 6.895 5 12 5s8.455 4.505 9.58 6.287c.137.215.205.323.243.49.029.125.029.322 0 .446-.038.167-.106.274-.242.49C20.454 14.495 17.105 19 12 19S3.545 14.495 2.42 12.713Z"/><path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z"/></svg>' +
  '<svg class="hide" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.743 5.092C11.149 5.032 11.569 5 12 5c5.105 0 8.455 4.505 9.58 6.287.137.215.205.323.243.49.029.125.029.322 0 .446-.038.167-.107.275-.244.492-.3.474-.757 1.141-1.363 1.865M6.724 6.715c-2.162 1.467-3.63 3.504-4.303 4.57-.137.216-.205.324-.243.49a1.173 1.173 0 0 0 0 .446c.038.167.106.274.242.49C3.546 14.495 6.895 19 12 19c2.059 0 3.832-.732 5.289-1.723M3 3l18 18M9.879 9.879a3 3 0 1 0 4.243 4.243"/></svg>';

function shell(body: string, script: boolean): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="color-scheme" content="light dark">
<title>${SITE_NAME}</title>
<link rel="icon" type="image/svg+xml" href="/favicon.svg">
<link rel="preload" href="${GATE_FONT}" as="font" type="font/woff2" crossorigin>
<style>${CSS}</style>
</head>
<body>
<main class="gate">
<h1>${SITE_NAME}</h1>
${body}
</main>
${script ? `<script>${JS}</script>` : ''}
</body>
</html>
`;
}

function passwordPage(failed: boolean): string {
  const error = failed
    ? `<p id="err" class="note error" role="alert">That password didn’t match. Try again.</p>`
    : '';
  const invalid = failed ? ' aria-invalid="true" aria-describedby="err"' : '';
  return shell(
    `<p class="hint">Use the password from the message that shared this link.</p>
<form method="post" novalidate>
<label for="password">Password</label>
<div class="field">
<input id="password" name="password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" required autofocus maxlength="${MAX_PASSWORD_LENGTH}"${invalid}>
<button id="toggle" class="toggle" type="button" aria-pressed="false" aria-label="Show password" aria-controls="password">${EYE}</button>
</div>
<p id="caps" class="note" aria-live="polite" hidden>Caps Lock is on.</p>
${error}
<button class="go" type="submit">Open prototypes</button>
</form>`,
    true,
  );
}

// A GET shows who the link is for and a POST signs them in, so a mail
// scanner that opens every link never uses the invite.
function invitePage(person: { name: string; team: string } | null): string {
  if (!person)
    return shell(
      `<p class="hint">This invite link has expired or was revoked. Ask whoever sent it for a new one.</p>`,
      false,
    );
  return shell(
    `<p class="hint">You’re invited to review as <strong>${escapeHtml(person.name)}</strong>, ${escapeHtml(person.team)}.</p>
<form method="post"><button class="go" type="submit" autofocus>Continue</button></form>`,
    false,
  );
}

// `pnpm dev` has no gate; vite.config.ts serves this at /_gate/ so the page can be reviewed.
export async function gatePreview(failed: boolean): Promise<{ html: string; csp: string }> {
  return { html: passwordPage(failed), csp: (await csp()).withScript };
}

let cspPromise: Promise<{ withScript: string; noScript: string }> | undefined;
function csp() {
  cspPromise ??= Promise.all([sha256(CSS), sha256(JS)]).then(([css, js]) => {
    const base = `default-src 'none'; style-src 'sha256-${base64(css)}'; font-src 'self'; img-src 'self'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'`;
    return {
      withScript: `${base}; script-src 'sha256-${base64(js)}'`,
      noScript: `${base}; script-src 'none'`,
    };
  });
  return cspPromise;
}

const NO_STORE = 'no-store, max-age=0';

function wantsHtml(request: Request): boolean {
  const dest = request.headers.get('sec-fetch-dest');
  if (dest) return dest === 'document' || dest === 'iframe';
  return (request.headers.get('accept') ?? '').includes('text/html');
}

async function htmlPage(request: Request, status: number, html: string, script: boolean, cookie?: string) {
  const headers = new Headers({ 'cache-control': NO_STORE, 'x-robots-tag': 'noindex, nofollow' });
  if (cookie) headers.append('set-cookie', cookie);
  if (!wantsHtml(request)) {
    headers.set('content-type', 'text/plain; charset=utf-8');
    return new Response(request.method === 'HEAD' ? null : 'Password required.', { status, headers });
  }
  const policy = await csp();
  headers.set('content-type', 'text/html; charset=utf-8');
  headers.set('content-security-policy', script ? policy.withScript : policy.noScript);
  headers.set('referrer-policy', 'no-referrer');
  return new Response(request.method === 'HEAD' ? null : html, { status, headers });
}

const plain = (status: number, text: string, extra: Record<string, string> = {}) =>
  new Response(text, {
    status,
    headers: { 'cache-control': NO_STORE, 'content-type': 'text/plain; charset=utf-8', ...extra },
  });

const redirect = (location: string, cookie: string) =>
  new Response(null, { status: 303, headers: { location, 'cache-control': NO_STORE, 'set-cookie': cookie } });

async function readPassword(request: Request): Promise<string | null> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/x-www-form-urlencoded'))
    return null;
  try {
    const value = (await request.formData()).get('password');
    return typeof value === 'string' && value.length <= MAX_PASSWORD_LENGTH ? value : null;
  } catch {
    return null;
  }
}

async function invite(request: Request, token: string): Promise<Response> {
  const setup = deployedReview(process.env);
  if ('error' in setup) return plain(503, setup.error);
  if (request.method === 'POST' && !sameOrigin(request)) return plain(403, 'Forbidden');
  const person = await setup.review.acceptInvite(token);
  if (request.method !== 'POST' || !person)
    return htmlPage(request, person ? 200 : 404, invitePage(person), false);
  const cookie = sessionCookie(
    PERSON_COOKIE,
    await issuePersonToken(setup.gate, { id: person.id, epoch: person.epoch }),
  );
  return redirect('/', cookie);
}

const pass = () => next({ headers: { 'cache-control': 'private, no-store' } });

// The signature alone admits assets; a page load also asks the store, so a
// revoke lands on the person's next navigation without a store read per asset.
async function personSession(request: Request, claim: PersonClaim): Promise<Response> {
  if (!wantsHtml(request)) return pass();
  const setup = deployedReview(process.env);
  const current =
    'error' in setup ? null : await setup.review.sessionPerson(claim.id, claim.epoch).catch(() => null);
  if (current) return pass();
  return htmlPage(request, 401, passwordPage(false), true, clearedCookie(PERSON_COOKIE));
}

async function passwordPost(request: Request, gate: Gate, url: URL): Promise<Response> {
  if (!sameOrigin(request)) return plain(403, 'Forbidden');
  const submitted = await readPassword(request);
  if (submitted === null || !(await passwordMatches(gate, submitted))) {
    await new Promise((resolve) => setTimeout(resolve, WRONG_PASSWORD_DELAY_MS));
    return htmlPage(request, 401, passwordPage(true), true);
  }
  return redirect(url.pathname + url.search, sessionCookie(GATE_COOKIE, await issueGateToken(gate)));
}

export default async function proxy(request: Request): Promise<Response> {
  const gate = readGate(process.env);
  if (!gate) return plain(503, 'The prototype gate is not configured.');
  const url = new URL(request.url);
  const invited = url.pathname.match(INVITE_PATH);
  if (invited && ['GET', 'HEAD', 'POST'].includes(request.method)) return invite(request, invited[1]);
  if (GATE_ASSETS.has(url.pathname) && (request.method === 'GET' || request.method === 'HEAD')) return next();
  if (await gateTokenIsValid(gate, readCookie(request, GATE_COOKIE))) return pass();
  const claim = await readPersonToken(gate, readCookie(request, PERSON_COOKIE));
  if (claim) return personSession(request, claim);
  if (request.method === 'GET' || request.method === 'HEAD')
    return htmlPage(request, 401, passwordPage(false), true);
  if (request.method === 'POST') return passwordPost(request, gate, url);
  return plain(405, 'Method not allowed', { allow: 'GET, HEAD, POST' });
}
