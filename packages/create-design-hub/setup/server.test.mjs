// The server's guard rails, against the real process: it runs commands on this
// machine, so only its own page may reach the actions.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { request } from 'node:http';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';

let server;
let base;
let token;

before(async () => {
  server = spawn(process.execPath, [fileURLToPath(new URL('server.mjs', import.meta.url)), '--no-open']);
  base = await new Promise((resolve, reject) => {
    let out = '';
    server.stdout.on('data', (d) => {
      out += d;
      const url = out.match(/http:\/\/127\.0\.0\.1:\d+\//)?.[0];
      if (url) resolve(url);
    });
    server.on('exit', () => reject(new Error(`server exited: ${out}`)));
  });
  token = (await (await fetch(base)).text()).match(/const TOKEN = '([0-9a-f]{32})'/)?.[1];
});

after(() => server.kill('SIGTERM'));

const post = (path, body = {}, headers = { 'x-setup-token': token }) =>
  fetch(new URL(path, base), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  });

test('the page carries a fresh token and shares the naming rule', async () => {
  assert.match(token, /^[0-9a-f]{32}$/);
  const slug = await fetch(new URL('slug.mjs', base));
  assert.match(slug.headers.get('content-type'), /javascript/);
  assert.match(await slug.text(), /export function slugify/);
});

test('another host name is refused, so a rebound DNS name reaches nothing', async () => {
  const { port } = new URL(base);
  const status = await new Promise((resolve, reject) => {
    request({ host: '127.0.0.1', port, path: '/', headers: { host: `evil.example:${port}` } }, (res) => {
      res.resume();
      resolve(res.statusCode);
    })
      .on('error', reject)
      .end();
  });
  assert.equal(status, 403);
});

test('actions need the token and a POST', async () => {
  assert.equal((await post('/api/state', {}, {})).status, 403);
  assert.equal((await post('/api/state', {}, { 'x-setup-token': 'nope' })).status, 403);
  assert.equal((await fetch(new URL('/api/state', base))).status, 403);
  assert.equal((await post('/api/nothing')).status, 404);
});

test('state describes this machine', async () => {
  const state = await (await post('/api/state')).json();
  assert.equal(state.mode, 'create');
  assert.match(state.defaults.parent, /\/Design$/);
  assert.equal(typeof state.tools.git, 'boolean');
});

test('the name check uses the same rule as create', async () => {
  const empty = await (await post('/api/path', { name: '---', parent: '/tmp' })).json();
  assert.deepEqual(empty, { ok: false, error: 'Use at least one letter or number in the name.' });
  const relative = await (await post('/api/path', { name: 'x', parent: 'Design' })).json();
  assert.equal(relative.ok, false);
});

test('project actions refuse a folder this server did not create', async () => {
  for (const action of ['start', 'stop', 'reveal', 'claude']) {
    const res = await (await post(`/api/${action}`, { path: '/etc' })).json();
    assert.deepEqual(res, { ok: false, message: 'Unknown project.' }, action);
  }
});

test('a bad create request is answered by field, before anything runs', async () => {
  const res = await post('/api/create', {
    name: 'x',
    parent: '/tmp',
    visibility: 'everyone',
    owner: '-bad',
  });
  const events = (await res.text())
    .trim()
    .split('\n')
    .map((line) => JSON.parse(line));
  assert.equal(events.length, 1);
  assert.equal(events[0].step, 'invalid');
  assert.ok(events[0].errors.visibility);
  assert.ok(events[0].errors.owner);
});
