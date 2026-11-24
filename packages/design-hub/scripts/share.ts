#!/usr/bin/env node
/// <reference types="node" />
// One command from a passing project to a link that works: the pre-flight,
// the deploy (a push when the Vercel project is connected to the repo, an
// upload otherwise), the wait for the build, and a signed-out request that
// must come back as the password page. It ends with what the handover needs.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { isLive } from '../core/catalog.ts';
import { readEnv } from '../server/env.ts';
import { DOCS, ROOT } from '../server/paths.ts';
import { prototypes } from './lib/catalog.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import {
  gateVerdict,
  gitConnected,
  nextStep,
  type Plan,
  type ProjectInfo,
  plan,
  productionUrl,
  type Repo,
} from './lib/deploy.ts';
import { linkedOrg, linkedProject, projectInfo, STORE_ENV, vercel, whoami } from './lib/vercel.ts';
import * as preflight from './preflight.ts';

export const spec = {
  name: 'share',
  summary:
    'Pre-flight, deploy to production, wait for the build, and check the live URL shows the password page. Returns the share details.',
  flags: {
    skip: {
      type: 'list',
      description:
        'A pre-flight step to skip, only with the user’s word (design-hub preflight --help lists them).',
    },
    cli: {
      type: 'boolean',
      description: 'Upload this folder with the Vercel CLI even when the project deploys on push.',
    },
  },
  output:
    '{ ok, via, deployment, url, gate, share: { url, password, open: [{ title, path, guide? }] }, review, next } or { ok: false, stage, ... }',
} as const satisfies CommandSpec;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function git(args: string[]): { ok: boolean; out: string; err: string } {
  const r = spawnSync('git', ['-C', ROOT, ...args], { encoding: 'utf8' });
  return { ok: r.status === 0, out: (r.stdout ?? '').trim(), err: (r.stderr ?? '').trim() };
}

type Deployment = { url: string; state: string; meta?: Record<string, string> };

function deploymentFor(project: string, scope: string | null, sha: string): Deployment | null {
  const out = vercel(ROOT, [
    'list',
    project,
    '--json',
    '--limit',
    '1',
    '--environment',
    'production',
    '-m',
    `githubCommitSha=${sha}`,
    ...(scope ? ['--scope', scope] : []),
  ]);
  if (out?.status !== 0) return null;
  try {
    return (JSON.parse(out.stdout) as { deployments: Deployment[] }).deployments[0] ?? null;
  } catch {
    return null;
  }
}

/** Pushes the branch and follows the deployment Vercel starts for that commit. */
async function viaGit(project: string, scope: string | null, branch: string): Promise<string> {
  const sha = git(['rev-parse', 'HEAD']).out;
  const push = git(['push', 'origin', branch]);
  if (!push.ok) throw new CliError(`git push origin ${branch} failed.`, { stderr: push.err.slice(-600) });
  const start = Date.now();
  for (;;) {
    const step = nextStep(deploymentFor(project, scope, sha), sha, Date.now() - start);
    if ('done' in step) return step.done;
    if ('error' in step) throw new CliError(step.error, { fix: step.fix, deployment: step.deployment });
    await sleep(5000);
  }
}

function viaCli(): string {
  const out = vercel(ROOT, ['deploy', '--prod', '--yes']);
  if (!out) throw new CliError('The Vercel CLI is not installed.', { fix: 'npm i -g vercel' });
  const url = `${out.stdout}\n${out.stderr}`.match(/https:\/\/[\w.-]+\.vercel\.app/)?.[0];
  if (out.status !== 0 || !url)
    throw new CliError('vercel deploy --prod failed.', { stderr: out.stderr.trim().slice(-600) });
  return url;
}

/** A signed-out request for the home page, the way a reviewer first meets the link. */
async function smoke(url: string) {
  try {
    const res = await fetch(`${url}/`, { redirect: 'manual' });
    return gateVerdict({
      status: res.status,
      location: res.headers.get('location'),
      robots: res.headers.get('x-robots-tag'),
      body: await res.text(),
    });
  } catch (error) {
    return {
      ok: false as const,
      problem: `Could not reach ${url}: ${error instanceof Error ? error.message : error}`,
      fix: 'Open the URL in a private window; a new domain can take a minute to resolve.',
    };
  }
}

/** What a reviewer is sent to open: each live sprint and its walkthrough. */
function opens() {
  return prototypes()
    .filter((p) => isLive(p) && p.kind === 'sprint')
    .map((p) => ({
      title: p.title,
      path: `/${p.slug}/`,
      ...(p.feature && existsSync(join(DOCS, 'sprints', p.feature, 'guide.md'))
        ? { guide: `/guide/${p.feature}/` }
        : {}),
    }));
}

/** The signed-in CLI and the linked project, or the fix for whichever is missing. */
function target(): { project: string; scope: string | null } {
  if (!whoami(ROOT))
    throw new CliError('The Vercel CLI is not installed or not signed in.', {
      fix: 'design-hub signin, send the user its url, then run this again.',
    });
  const project = linkedProject(ROOT);
  if (!project)
    throw new CliError('This folder is not linked to a Vercel project.', {
      fix: 'design-hub bootstrap --vercel <project> --team <team>',
    });
  return { project, scope: linkedOrg(ROOT) };
}

function repo(info: ProjectInfo | null): Repo {
  const branch = git(['rev-parse', '--abbrev-ref', 'HEAD']).out;
  const status = git(['status', '--porcelain']).out;
  return {
    connected: gitConnected(info) && git(['remote', 'get-url', 'origin']).ok,
    branch: branch && branch !== 'HEAD' ? branch : null,
    productionBranch: info?.link?.productionBranch ?? 'main',
    dirty: status ? status.split('\n') : [],
  };
}

/**
 * Deploys by the route the plan chose. A push the remote already has starts no
 * build, but a deploy after an env change still needs one, so that uploads.
 */
async function deploy(route: Plan, project: string, scope: string | null) {
  if ('error' in route)
    throw new CliError(route.error, { stage: 'deploy', fix: route.fix, ...(route.detail ?? {}) });
  const head = git(['rev-parse', 'HEAD']).out;
  const remote =
    route.via === 'git' ? git(['ls-remote', 'origin', `refs/heads/${route.branch}`]).out.split(/\s/)[0] : '';
  if (route.via === 'git' && remote !== head)
    return { via: 'git' as const, deployment: await viaGit(project, scope, route.branch) };
  return { via: 'cli' as const, deployment: viaCli() };
}

function handover(url: string) {
  const env = readEnv(ROOT);
  const review = STORE_ENV.every((n) => env[n]) ? 'on' : 'off';
  return {
    share: { url, password: env.GATE_PASSWORD ?? null, open: opens() },
    review,
    next:
      review === 'on'
        ? `Send the handover (miles-deploy). First share with comments: design-hub people invite --name "<user>" --role editor --site ${url}.`
        : 'Send the handover (miles-deploy). Never send GATE_SECRET.',
  };
}

export async function main({ flags }: Args<typeof spec>) {
  const { project, scope } = target();
  const checked = await preflight.main({ flags: { skip: flags.skip, 'allow-contact': [] }, positionals: [] });
  if (!checked.ok)
    return {
      ok: false,
      stage: 'preflight',
      error: 'The pre-flight failed; nothing was deployed.',
      steps: checked.steps.filter((s) => !s.ok),
      fix: 'Fix each step (miles-deploy says how), then run this again.',
    };
  const info = projectInfo(ROOT, project, scope);
  const { via, deployment } = await deploy(plan(repo(info), flags.cli), project, scope);
  const url = productionUrl(projectInfo(ROOT, project, scope) ?? info, project);
  const gate = await smoke(url);
  if (!gate.ok) return { ok: false, stage: 'gate', via, deployment, url, error: gate.problem, fix: gate.fix };
  return { via, deployment, url, gate: 'ok', ...handover(url) };
}
