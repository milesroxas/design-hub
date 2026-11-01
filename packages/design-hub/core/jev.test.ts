import assert from 'node:assert/strict';
import { test } from 'node:test';
import { askJev, choiceOf, noulOf } from './jev.ts';

const request = {
  model: 'jev-1.14.0',
  state: { a: 1 },
  questions: { q: { type: 'noul', instructions: 'Is a 1?' } },
} as const;
const reply = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  (async () => new Response(JSON.stringify(body), { status, headers })) as unknown as typeof fetch;

test('returns the answers and the model that gave them', async () => {
  const r = await askJev('k', request, {
    timeoutMs: 1000,
    fetch: reply(200, { model: 'jev-1.14.0', answers: { q: { type: 'noul', noul: 0.9 } } }),
  });
  assert.ok(r.ok);
  assert.equal(noulOf(r.answers, 'q'), 0.9);
  assert.equal(r.model, 'jev-1.14.0');
});

test('fails open on an HTTP error, naming the status and request id', async () => {
  const r = await askJev('bad', request, {
    timeoutMs: 1000,
    fetch: reply(401, { detail: 'nope' }, { 'x-typesafe-request-id': 'req_1' }),
  });
  assert.equal(r.ok, false);
  assert.match(!r.ok ? r.error : '', /^401 \(req_1\)/);
});

test('fails open on a timeout', async () => {
  const hang = ((_: unknown, init: RequestInit) =>
    new Promise((_, reject) =>
      init.signal?.addEventListener('abort', () => reject(init.signal?.reason)),
    )) as typeof fetch;
  const r = await askJev('k', request, { timeoutMs: 20, fetch: hang });
  assert.deepEqual(r.ok ? null : r.error, 'timeout after 20ms');
});

test('sends the images header only when there are assets', async () => {
  let sent: Headers | undefined;
  const capture = (async (_: unknown, init: RequestInit) => {
    sent = new Headers(init.headers);
    return new Response(JSON.stringify({ answers: {} }));
  }) as typeof fetch;
  await askJev('k', request, { timeoutMs: 1000, fetch: capture });
  assert.equal(sent?.get('typesafe-danger-zone-images'), null);
  await askJev(
    'k',
    { ...request, assets: { img: { type: 'image', format: 'png', data_base64: 'AA==' } } },
    {
      timeoutMs: 1000,
      fetch: capture,
    },
  );
  assert.equal(sent?.get('typesafe-danger-zone-images'), 'true');
});

test('reads answers by type and ignores the wrong type', () => {
  const answers = {
    c: { type: 'choice', choice: 'bug', confidence: 0.5, probabilities: { bug: 0.7 } },
  } as const;
  assert.equal(choiceOf(answers, 'c')?.choice, 'bug');
  assert.equal(noulOf(answers, 'c'), null);
});
