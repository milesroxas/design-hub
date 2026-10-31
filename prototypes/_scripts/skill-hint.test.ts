import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Answer } from '../_core/jev.ts';
import type { judge } from './lib/judge.ts';
import { suggest } from './skill-hint.ts';

const skills = [
  { name: 'miles-prototype', description: 'Writing prototype code.' },
  { name: 'miles-deploy', description: 'Deploying and sharing.' },
];

/** A judge that answers every question with the given values. */
const answering = (nouls: Record<string, number>, choice: string) =>
  (async () => {
    const answers: Record<string, Answer> = {
      which: { type: 'choice', choice, confidence: 0.8, probabilities: { [choice]: 0.9 } },
    };
    for (const [k, noul] of Object.entries(nouls)) answers[k] = { type: 'noul', noul };
    return { answers, ids: {} };
  }) as unknown as typeof judge;

test('names the chosen skill when the prompt asks for action and the skill fits', async () => {
  const ask = answering(
    { acts: 0.9, procedure: 0.8, prose: 0.1, 'fits:miles-prototype': 0.7 },
    'miles-prototype',
  );
  const hint = await suggest('add a dial for the row height', skills, ask);
  assert.equal(hint.skill, 'miles-prototype');
  assert.ok(Math.abs((hint.gate ?? 0) - 0.8667) < 0.001);
});

test('stays quiet when the prompt only asks to explain, or the skill does not fit', async () => {
  const explain = answering(
    { acts: 0.1, procedure: 0.1, prose: 0.95, 'fits:miles-prototype': 0.9 },
    'miles-prototype',
  );
  assert.equal((await suggest('what is a dial?', skills, explain)).skill, null);
  const misfit = answering(
    { acts: 0.9, procedure: 0.9, prose: 0.1, 'fits:miles-deploy': 0.1 },
    'miles-deploy',
  );
  assert.equal((await suggest('fix the row', skills, misfit)).skill, null);
});

test('never asks for a slash command, a prompt that names a skill, or when Jev is off', async () => {
  let asked = 0;
  const counting = (async () => {
    asked++;
    return null;
  }) as unknown as typeof judge;
  await suggest('/model', skills, counting);
  await suggest('use miles-deploy to ship', skills, counting);
  assert.equal(asked, 0);
  assert.deepEqual(await suggest('ship it', skills, counting), { skill: null, gate: null, fits: null });
  assert.equal(asked, 1);
});
