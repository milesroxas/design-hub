#!/usr/bin/env node
// The setup app's local server. `Design Hub.command` starts it; it opens the
// page in the browser and runs the same scripts an agent would (create.mjs,
// bootstrap), so the mechanics live in one place. Plain JavaScript with no
// dependencies, because it runs before anything is installed.
//
// It runs commands on this machine, so it listens on 127.0.0.1 only, accepts
// only its own Host name (no DNS rebinding), and every POST must carry the
// token printed into the page (no other site can send one).
import { spawn, spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:http';
import { homedir, platform } from 'node:os';
import { basename, delimiter, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  bootstrapArgs,
  createArgs,
  defaultParent,
  explain,
  FALLBACK_FIX,
  folderMode,
  hostAllowed,
  parseDeviceCode,
  projectPath,
  readPort,
  TEMPLATE_REPO,
  tildify,
  validateCreate,
} from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = dirname(HERE);
const HOME = homedir();
const MAC = platform() === 'darwin';
const TOKEN = randomBytes(16).toString('hex');
const CREATE = join(REPO, '.claude', 'skills', 'miles-design-hub', 'scripts', 'create.mjs');
// The pnpm major this template's lockfile is installed with.
const PNPM = 'pnpm@12';

/** Projects this server may start or reveal: its own folder and the ones it made. */
const known = new Set([REPO]);
/** Dev servers this launcher started, by project path. */
const servers = new Map();
let githubLogin = null;

// ---------- machine ----------

const has = (cmd, args = ['--version']) => spawnSync(cmd, args, { encoding: 'utf8' }).status === 0;

/** pnpm, or a shim that fetches it through npx, so nobody installs it by hand. */
function ensurePnpm() {
  if (has('pnpm')) return;
  const config = process.env.XDG_CONFIG_HOME || join(HOME, '.config');
  const bin = join(config, 'design-hub', 'bin');
  mkdirSync(bin, { recursive: true });
  const shim = join(bin, 'pnpm');
  writeFileSync(shim, `#!/bin/sh\nexec npx --yes ${PNPM} "$@"\n`);
  chmodSync(shim, 0o755);
  process.env.PATH = `${bin}${delimiter}${process.env.PATH}`;
}

/** The signed-in GitHub account, or null. */
function githubUser() {
  if (!has('gh', ['auth', 'status'])) return null;
  return (
    spawnSync('gh', ['api', 'user', '--jq', '.login'], { encoding: 'utf8' }).stdout.trim() || 'signed in'
  );
}

function tools() {
  // On a Mac without Apple's developer tools, `git` is a stub that opens an install dialog.
  const devtools = !MAC || has('xcode-select', ['-p']);
  const gh = has('gh');
  return { git: devtools && has('git'), gh: { installed: gh, login: gh ? githubUser() : null } };
}

/** Opens a URL or folder in its default app. `args` go before the target, for example `-R` to select a file in Finder. */
function openExternal(target, args = []) {
  spawn(MAC ? 'open' : 'xdg-open', [...(MAC ? args : []), target], {
    stdio: 'ignore',
    detached: true,
  }).unref();
}

/** The pid listening on a port, or null. */
function listener(port) {
  if (!port) return null;
  const out = spawnSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], { encoding: 'utf8' });
  const pid = Number(out.stdout?.trim().split('\n')[0]);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

// ---------- projects ----------

/** The port a project's prototypes/.env claims, or null before setup. */
function portOf(path) {
  const env = join(path, 'prototypes', '.env');
  return existsSync(env) ? readPort(readFileSync(env, 'utf8')) : null;
}

function project(path) {
  const port = portOf(path);
  return {
    name: basename(path),
    path,
    display: tildify(path, HOME),
    port,
    running: listener(port) !== null,
    url: port ? `http://localhost:${port}/` : null,
  };
}

function mode() {
  return folderMode({
    hasPort: portOf(REPO) !== null,
    hasModules: existsSync(join(REPO, 'prototypes', 'node_modules')),
    hasGit: existsSync(join(REPO, '.git')),
  });
}

/** Whether a new project can go at `path`: a missing or empty folder only. */
function isFree(path) {
  return !existsSync(path) || readdirSync(path).length === 0;
}

/** Runs a script that prints one JSON object; resolves with it, never rejects. */
function runJson(cmd, args, cwd) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, env: process.env });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', (e) => resolve({ ok: false, error: `${cmd} is not installed.`, stderr: e.message }));
    child.on('close', (code) => {
      try {
        resolve(JSON.parse(out));
      } catch {
        resolve({
          ok: code === 0,
          error: code === 0 ? undefined : `${cmd} failed.`,
          stderr: (err || out).slice(-1200),
        });
      }
    });
  });
}

/** Sends a step's running, then done or error; resolves with the result, or null when it failed. */
async function step(send, name, run) {
  send({ step: name, status: 'running' });
  const result = await run();
  send(result.ok ? { step: name, status: 'done' } : { step: name, status: 'error', ...explain(result) });
  return result.ok ? result : null;
}

/** The template copy, for a ZIP download only: a clone is set up where it is. */
async function copyTemplate(mode, value, send) {
  if (mode !== 'copy') {
    send({ step: 'copy', status: 'skipped' });
    return REPO;
  }
  mkdirSync(dirname(value.path), { recursive: true });
  const made = await step(send, 'copy', () =>
    runJson(process.execPath, [CREATE, ...createArgs(value)], HOME),
  );
  if (!made) return null;
  known.add(value.path);
  return value.path;
}

/** Checks the request and copies the template when needed; resolves with the project path, or null. */
async function prepare(body, send) {
  const m = mode();
  const checked = validateCreate(body, { mode: m, home: HOME });
  if (!checked.ok) {
    send({ step: 'invalid', status: 'error', errors: checked.errors });
    return null;
  }
  const path = await copyTemplate(m, checked.value, send);
  return path && { path, value: checked.value };
}

async function create(body, send) {
  const ready = await prepare(body, send);
  if (!ready) return;
  const app = join(ready.path, 'prototypes');
  const bootstrap = join(app, '_scripts', 'bootstrap.ts');
  const run = (args) => () => runJson(process.execPath, [bootstrap, ...args], app);
  const first = await step(send, 'port', run(bootstrapArgs(ready.value)));
  if (!first) return;
  // The second run keeps the port and does the install, the slow part.
  const second = await step(send, 'install', run([]));
  if (!second) return;
  const warnings = [...new Set([first, second].flatMap((r) => r.warnings ?? []))];
  send({ step: 'ready', status: 'done', project: project(ready.path), warnings });
}

async function reachable(url, ms) {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    try {
      await fetch(url, { signal: AbortSignal.timeout(1500) });
      return true;
    } catch {
      await new Promise((r) => setTimeout(r, 400));
    }
  }
  return false;
}

/** Runs `pnpm dev` in its own process group, so Stop ends pnpm and the Vite process under it together. */
function launch(path) {
  const logDir = join(path, '.design-hub');
  mkdirSync(logDir, { recursive: true });
  const logFile = join(logDir, 'dev.log');
  const log = openSync(logFile, 'w');
  const child = spawn('pnpm', ['dev'], {
    cwd: join(path, 'prototypes'),
    detached: true,
    stdio: ['ignore', log, log],
  });
  servers.set(path, child);
  return {
    exited: new Promise((r) => child.on('exit', () => r(false))),
    tail: () => (existsSync(logFile) ? readFileSync(logFile, 'utf8').slice(-1200) : ''),
  };
}

async function start(path) {
  const p = project(path);
  if (!p.port) return { ok: false, message: 'This project is not set up yet.', fix: 'Run setup first.' };
  if (p.running) return { ok: true, project: p };
  const { exited, tail } = launch(path);
  if (await Promise.race([reachable(p.url, 45_000), exited])) return { ok: true, project: project(path) };
  stop(path);
  return { ok: false, message: 'Design Hub did not start.', fix: FALLBACK_FIX, detail: tail() };
}

function kill(pid) {
  if (!pid) return;
  try {
    process.kill(pid, 'SIGTERM');
  } catch {
    // Already gone.
  }
}

/** Stops the hub: the process group this server started, or else whatever serves the project's port. */
function stop(path) {
  const own = servers.get(path)?.pid;
  servers.delete(path);
  kill(own ? -own : listener(portOf(path)));
}

function githubSignIn() {
  return new Promise((resolve) => {
    if (githubLogin) return resolve(githubLogin.device ?? { pending: true });
    // Without a terminal, gh prints the code and the URL, then waits for the browser.
    const child = spawn(
      'gh',
      ['auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https', '--skip-ssh-key'],
      { stdio: ['ignore', 'pipe', 'pipe'] },
    );
    githubLogin = { child, device: null };
    let text = '';
    const timer = setTimeout(() => resolve({ error: 'GitHub did not answer. Try again.' }), 15_000);
    const read = (d) => {
      text += d;
      const device = parseDeviceCode(text);
      if (device && !githubLogin.device) {
        githubLogin.device = device;
        clearTimeout(timer);
        openExternal(device.url);
        resolve(device);
      }
    };
    child.stdout.on('data', read);
    child.stderr.on('data', read);
    child.on('error', () => resolve({ error: 'The GitHub CLI is not installed.' }));
    child.on('close', () => {
      githubLogin = null;
      clearTimeout(timer);
      resolve({ error: 'Sign-in stopped. Try again.' });
    });
  });
}

function pickFolder() {
  if (!MAC) return {};
  const out = spawnSync(
    'osascript',
    [
      '-e',
      'activate',
      '-e',
      'POSIX path of (choose folder with prompt "Where should Design Hub save the project?")',
    ],
    { encoding: 'utf8' },
  );
  if (out.status !== 0) return { cancelled: true };
  const path = out.stdout.trim().replace(/\/$/, '');
  return { path, display: tildify(path, HOME) };
}

// ---------- http ----------

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

async function readBody(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 64_000) throw new Error('too large');
  }
  return raw ? JSON.parse(raw) : {};
}

function state() {
  const parent = defaultParent(HOME);
  return {
    mode: mode(),
    defaults: { parent, parentDisplay: tildify(parent, HOME), template: TEMPLATE_REPO },
    here: project(REPO),
    tools: tools(),
  };
}

/** Copies the path for pasting into Claude Code and opens the Claude app; false when the app is missing. */
function openClaude(path) {
  const copied = MAC && spawnSync('pbcopy', { input: path }).status === 0;
  if (copied && has('open', ['-a', 'Claude'])) return true;
  openExternal('https://claude.ai/download');
  return false;
}

/** Shows the project's own launcher in Finder, so people see what to double-click next time. */
function reveal(path) {
  const launcher = join(path, 'Design Hub.command');
  if (existsSync(launcher)) openExternal(launcher, ['-R']);
  else openExternal(path);
}

/** Actions on a project take only one this server owns: its own folder or one it created. */
const onProject = (action) => (b) =>
  known.has(b.path) ? action(b.path) : { ok: false, message: 'Unknown project.' };

/** Every action is a POST with the page's token. */
const routes = {
  '/api/state': () => state(),
  // Step 1's check: the same rule create uses, so the page never guesses.
  '/api/path': (b) => {
    const target = projectPath(b, HOME);
    if (target.errors) return { ok: false, error: target.errors.name ?? target.errors.parent };
    if (!isFree(target.path))
      return { ok: false, error: 'A folder with that name already has files in it. Try another name.' };
    return { ok: true };
  },
  '/api/pick-folder': () => pickFolder(),
  '/api/devtools': () => {
    if (MAC) spawn('xcode-select', ['--install'], { stdio: 'ignore', detached: true }).unref();
    return { ok: true };
  },
  '/api/github': () => githubSignIn(),
  '/api/start': onProject(start),
  '/api/stop': onProject((path) => {
    stop(path);
    // The port can stay bound for a moment after the signal, so don't ask lsof yet.
    return { ok: true, project: { ...project(path), running: false } };
  }),
  '/api/reveal': onProject((path) => {
    reveal(path);
    return { ok: true };
  }),
  '/api/claude': onProject((path) => ({ ok: true, app: openClaude(path) })),
};

/** Files the page loads. slug.mjs is the naming rule, shared with the server. */
const files = {
  '/': ['app.html', 'text/html; charset=utf-8'],
  '/slug.mjs': ['slug.mjs', 'text/javascript; charset=utf-8'],
};

function serveFile(res, [name, type]) {
  const body = readFileSync(join(HERE, name), 'utf8').replace('__TOKEN__', TOKEN);
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store', 'x-frame-options': 'DENY' });
  res.end(body);
}

/** One JSON object per line, one per step, so the page shows progress as it happens. */
async function streamCreate(req, res) {
  const body = await readBody(req);
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' });
  await create(body, (event) => res.write(`${JSON.stringify(event)}\n`));
  res.end();
}

async function handle(req, res) {
  if (!hostAllowed(req.headers.host, server.address().port)) return json(res, 403, { error: 'Wrong host.' });
  const { pathname } = new URL(req.url, 'http://localhost');
  if (req.method === 'GET' && files[pathname]) return serveFile(res, files[pathname]);
  if (req.method !== 'POST' || req.headers['x-setup-token'] !== TOKEN)
    return json(res, 403, { error: 'Bad token.' });
  if (pathname === '/api/create') return streamCreate(req, res);
  const route = routes[pathname];
  if (!route) return json(res, 404, { error: 'Not found.' });
  json(res, 200, await route(await readBody(req)));
}

const server = createServer((req, res) =>
  handle(req, res).catch((error) => {
    if (res.headersSent) res.end();
    else json(res, 500, { error: error.message });
  }),
);

function shutdown() {
  for (const path of servers.keys()) stop(path);
  githubLogin?.child.kill();
  process.exit(0);
}
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) process.on(signal, shutdown);

ensurePnpm();
server.listen(0, '127.0.0.1', () => {
  const url = `http://127.0.0.1:${server.address().port}/`;
  console.log(
    `\n  Design Hub is open in your browser.\n  If it did not open, go to ${url}\n\n  Keep this window open while you work. Close it to stop Design Hub.\n`,
  );
  if (!process.argv.includes('--no-open')) openExternal(url);
});
