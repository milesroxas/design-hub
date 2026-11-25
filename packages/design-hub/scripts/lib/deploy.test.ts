import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  deviceLink,
  gateVerdict,
  gitConnected,
  nextStep,
  plan,
  productionUrl,
  restoreGitignore,
  upstashTerms,
} from './deploy.ts';

test('the device link is read out of the login log', () => {
  const log =
    '> NOTE: telemetry\n  Visit https://vercel.com/oauth/device?user_code=VGNB-WCBB\n\nWaiting for authentication...';
  assert.deepEqual(deviceLink(log), {
    url: 'https://vercel.com/oauth/device?user_code=VGNB-WCBB',
    code: 'VGNB-WCBB',
  });
  assert.equal(deviceLink('Vercel CLI 59.25.2'), null);
});

test('the production URL is the first alias that is not a branch alias', () => {
  const info = {
    targets: {
      production: { alias: ['acme-git-main-team.vercel.app', 'review.acme.com', 'acme.vercel.app'] },
    },
  };
  assert.equal(productionUrl(info, 'acme'), 'https://review.acme.com');
  assert.equal(productionUrl({}, 'acme'), 'https://acme.vercel.app');
  assert.equal(productionUrl(null, 'acme'), 'https://acme.vercel.app');
});

test('a project is connected when Vercel names its repo', () => {
  assert.equal(gitConnected({ link: { type: 'github', repo: 'acme' } }), true);
  assert.equal(gitConnected({ link: null }), false);
  assert.equal(gitConnected(null), false);
});

const repo = { connected: true, branch: 'main', productionBranch: 'main', dirty: [] as string[] };

test('a connected, clean production branch deploys by push', () => {
  assert.deepEqual(plan(repo, false), { via: 'git', branch: 'main' });
});

test('an unconnected project, or --cli, uploads the folder', () => {
  assert.equal((plan({ ...repo, connected: false }, false) as { via: string }).via, 'cli');
  assert.deepEqual(plan(repo, true), { via: 'cli', reason: '--cli' });
});

test('another branch or uncommitted changes refuse a push', () => {
  assert.match(
    (plan({ ...repo, branch: 'feature' }, false) as { error: string }).error,
    /production deploys from main/,
  );
  assert.match((plan({ ...repo, branch: null }, false) as { error: string }).error, /detached HEAD/);
  const dirty = plan({ ...repo, dirty: [' M prototypes/a/index.tsx'] }, false) as {
    error: string;
    detail: unknown;
  };
  assert.match(dirty.error, /Uncommitted/);
  assert.deepEqual(dirty.detail, { dirty: [' M prototypes/a/index.tsx'] });
});

const page = {
  status: 401,
  location: null,
  robots: 'noindex, nofollow',
  body: '<input id="password" name="password">',
};

test('the password page passes', () => {
  assert.deepEqual(gateVerdict(page), { ok: true });
});

test('a Vercel login in front of the gate fails with the protection fix', () => {
  const v = gateVerdict({ ...page, status: 302, location: 'https://vercel.com/login?next=x', body: '' });
  assert.equal(v.ok, false);
  assert.match((v as { problem: string }).problem, /Vercel login/);
});

test('a missing gate env, an open site, or a missing noindex each fail', () => {
  assert.match((gateVerdict({ ...page, status: 503 }) as { problem: string }).problem, /503/);
  assert.match(
    (gateVerdict({ ...page, status: 200, body: '<html>' }) as { problem: string }).problem,
    /got 200/,
  );
  assert.match((gateVerdict({ ...page, robots: null }) as { problem: string }).problem, /noindex/);
});

test('a pushed commit is followed until its deployment is ready or fails', () => {
  const sha = 'abcdef1234';
  assert.deepEqual(nextStep({ url: 'a.vercel.app', state: 'READY' }, sha, 0), {
    done: 'https://a.vercel.app',
  });
  assert.deepEqual(nextStep({ url: 'a.vercel.app', state: 'BUILDING' }, sha, 1000), { wait: true });
  assert.deepEqual(nextStep(null, sha, 1000), { wait: true });
  assert.match(
    (nextStep({ url: 'a.vercel.app', state: 'ERROR' }, sha, 0) as { error: string }).error,
    /abcdef1 ended ERROR/,
  );
  assert.match((nextStep(null, sha, 3 * 60_000) as { error: string }).error, /no deployment/);
  assert.match(
    (nextStep({ url: 'a.vercel.app', state: 'BUILDING' }, sha, 11 * 60_000) as { error: string }).error,
    /10 minutes/,
  );
});

test('the Upstash terms link is the one the CLI printed, else the team page, and names the product', () => {
  const printed = upstashTerms(
    'Error: accept at https://vercel.com/sas/~/integrations/accept-terms/upstash?source=cli now',
    'x',
  );
  assert.equal(printed.url, 'https://vercel.com/sas/~/integrations/accept-terms/upstash?source=cli');
  assert.equal(
    upstashTerms('', 'roxas').url,
    'https://vercel.com/roxas/~/integrations/accept-terms/upstash?source=cli',
  );
  assert.equal(upstashTerms('', undefined).url, 'https://vercel.com/marketplace/upstash');
  const { say } = upstashTerms('', 'roxas');
  assert.match(say, /Upstash for Redis/);
  assert.match(say, /roxas team/);
  assert.match(say, /create a database/);
});

test('vercel link leaves .gitignore as it was, adding only .vercel/ when missing', () => {
  const ours = 'node_modules/\n.vercel/\n.env\n!.env.example\n';
  assert.equal(restoreGitignore(ours, `${ours}.vercel\n.env*\n`), ours);
  assert.equal(restoreGitignore(ours, ours), null);
  assert.equal(restoreGitignore('dist/', 'dist/\n.vercel\n.env*\n'), 'dist/\n.vercel/\n');
  assert.equal(restoreGitignore('', '.vercel\n'), '.vercel/\n');
});
