import assert from 'node:assert/strict';
import { test } from 'node:test';
import { makeProject, needsPlatform, parseProject, samplesOutside, trackFor, websiteFor } from './project.ts';

test('a platform fixes or asks for its front end', () => {
  assert.deepEqual(websiteFor('webflow'), { website: { platform: 'webflow', host: 'webflow' } });
  assert.deepEqual(websiteFor('emdash'), {
    website: { platform: 'emdash', frontend: 'astro', host: 'cloudflare' },
  });
  assert.deepEqual(websiteFor('payload', 'next'), { website: { platform: 'payload', frontend: 'next' } });
  assert.match((websiteFor('wordpress') as { problem: string }).problem, /needs a front end/);
  assert.match((websiteFor('payload', 'vue') as { problem: string }).problem, /front end is one of/);
  assert.match((websiteFor('emdash', 'next') as { problem: string }).problem, /always uses astro/);
  assert.match((websiteFor('webflow', 'astro') as { problem: string }).problem, /renders its own pages/);
  assert.match((websiteFor('squarespace') as { problem: string }).problem, /platform is one of/);
});

test('tracks come back in order, once each, with the website only on the website track', () => {
  assert.deepEqual(makeProject(['brand', 'product', 'brand']), { project: { tracks: ['product', 'brand'] } });
  assert.deepEqual(makeProject(['website'], { platform: 'emdash' }), {
    project: { tracks: ['website'], website: { platform: 'emdash', frontend: 'astro', host: 'cloudflare' } },
  });
  assert.deepEqual(makeProject(['website']), { project: { tracks: ['website'] } });
  assert.match(
    (makeProject(['product'], { platform: 'webflow' }) as { problems: string[] }).problems[0],
    /needs the website track/,
  );
  assert.match((makeProject([]) as { problems: string[] }).problems[0], /at least one track/);
  assert.match((makeProject(['app']) as { problems: string[] }).problems[0], /Unknown track: app/);
  assert.match(
    (makeProject(['website'], { platform: 'payload' }) as { problems: string[] }).problems[0],
    /needs a front end/,
  );
});

test('project.json is read through the same rules', () => {
  assert.deepEqual(
    parseProject({ tracks: ['website'], website: { platform: 'payload', frontend: 'astro' } }),
    {
      project: { tracks: ['website'], website: { platform: 'payload', frontend: 'astro' } },
    },
  );
  assert.match((parseProject(null) as { problems: string[] }).problems[0], /not an object/);
  assert.match((parseProject({}) as { problems: string[] }).problems[0], /no tracks list/);
});

test('the website track without a platform still needs one', () => {
  assert.equal(needsPlatform({ tracks: ['website'] }), true);
  assert.equal(needsPlatform({ tracks: ['website'], website: { platform: 'webflow' } }), false);
  assert.equal(needsPlatform({ tracks: ['product'] }), false);
});

test("a new prototype takes the project's only track, or the one named", () => {
  const one = { tracks: ['website' as const] };
  const many = { tracks: ['product' as const, 'brand' as const] };
  assert.deepEqual(trackFor(one), { track: 'website' });
  assert.deepEqual(trackFor(many, 'brand'), { track: 'brand' });
  assert.match((trackFor(many) as { problem: string }).problem, /several tracks/);
  assert.match((trackFor(one, 'brand') as { problem: string }).problem, /no brand track/);
  assert.match((trackFor(one, 'app') as { problem: string }).problem, /--track is one of/);
  assert.deepEqual(trackFor(null), { track: '' });
  assert.deepEqual(trackFor(null, 'product'), { track: 'product' });
});

test('the samples outside the kept tracks', () => {
  assert.deepEqual(
    samplesOutside(['website']).map((s) => s.slug),
    ['sample-list', 'sample-social'],
  );
  assert.deepEqual(samplesOutside(['product', 'website', 'brand']), []);
});
