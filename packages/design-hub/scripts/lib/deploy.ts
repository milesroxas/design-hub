/// <reference types="node" />
// What `design-hub signin` and `design-hub share` decide, kept apart from the
// vercel and git calls that feed them so every branch is tested: the sign-in
// link in the CLI's log, which way a deploy goes, the production URL, and
// whether the deployed site answers with the gate's sign-in page.

/** The device sign-in `vercel login` prints and then waits on. */
export function deviceLink(log: string): { url: string; code: string } | null {
  const m = log.match(/https:\/\/vercel\.com\/oauth\/device\?user_code=([A-Z0-9-]+)/);
  return m ? { url: m[0], code: m[1] } : null;
}

/** The parts of `GET /v9/projects/<name>` a deploy reads. */
export type ProjectInfo = {
  link?: { type?: string; repo?: string; org?: string; productionBranch?: string } | null;
  targets?: { production?: { alias?: string[] } | null } | null;
};

export const gitConnected = (info: ProjectInfo | null): boolean => Boolean(info?.link?.repo);

/** The address a reviewer is sent: the first production alias (a custom domain when there is one). */
export function productionUrl(info: ProjectInfo | null, project: string): string {
  const alias =
    info?.targets?.production?.alias?.find((a) => !a.includes('-git-')) ?? `${project}.vercel.app`;
  return `https://${alias}`;
}

export type Repo = { connected: boolean; branch: string | null; productionBranch: string; dirty: string[] };

export type Plan =
  | { via: 'git'; branch: string }
  | { via: 'cli'; reason: string }
  | { error: string; fix: string; detail?: unknown };

/**
 * A project connected to its repo deploys by pushing the production branch, so
 * the deployment matches a commit; otherwise the CLI uploads the folder.
 * Pushing is refused from another branch or with uncommitted changes, since
 * neither would deploy what is on disk.
 */
export function plan(repo: Repo, forceCli: boolean): Plan {
  if (forceCli) return { via: 'cli', reason: '--cli' };
  if (!repo.connected) return { via: 'cli', reason: 'the Vercel project is not connected to a Git repo' };
  if (repo.branch !== repo.productionBranch)
    return {
      error: `On ${repo.branch ?? 'a detached HEAD'}; production deploys from ${repo.productionBranch}.`,
      fix: `Merge into ${repo.productionBranch} and run this from there, or pass --cli to upload this folder as production.`,
    };
  if (repo.dirty.length)
    return {
      error: 'Uncommitted changes would not deploy.',
      fix: 'Commit them (ask the user first), then run this again.',
      detail: { dirty: repo.dirty.slice(0, 20) },
    };
  return { via: 'git', branch: repo.productionBranch };
}

/**
 * How `design-hub share` asks for the home page: as a browser does, signed
 * out. The gate answers a client that does not accept HTML with a plain-text
 * 401, which has no sign-in page to find.
 */
export const GATE_REQUEST = {
  redirect: 'manual',
  headers: { accept: 'text/html,application/xhtml+xml' },
} as const satisfies RequestInit;

export type Answer = { status: number; location: string | null; robots: string | null; body: string };
export type Verdict = { ok: true } | { ok: false; problem: string; fix: string };

/** The hub's sign-in page carries this on its main element (vercel/proxy.ts). */
const SIGN_IN_MARKER = 'data-gate="sign-in"';
const quote = (body: string) => JSON.stringify(body.replace(/\s+/g, ' ').trim().slice(0, 80));

/** The first problem with the status alone, or null when it is the 401 the gate answers. */
function statusProblem(answer: Answer): Verdict | null {
  if (answer.status >= 300 && answer.status < 400 && /vercel\.com/.test(answer.location ?? ''))
    return {
      ok: false,
      problem: 'Visitors are sent to a Vercel login before the sign-in page.',
      fix: 'design-hub bootstrap --vercel <project> --review turns Vercel Authentication off; run it, then deploy again.',
    };
  if (answer.status === 503)
    return {
      ok: false,
      problem: 'The gate answers 503: GATE_SECRET is missing on the deployment.',
      fix: 'design-hub bootstrap --vercel <project> --review, then deploy again so the env reaches the site.',
    };
  if (answer.status !== 401)
    return {
      ok: false,
      problem: `Expected the sign-in page (401), got ${answer.status}.`,
      fix: 'Check that proxy.ts and vercel.json are the template’s, then deploy again.',
    };
  return null;
}

/** Whether the production URL answers a signed-out visitor with the hub's sign-in page. */
export function gateVerdict(answer: Answer): Verdict {
  const status = statusProblem(answer);
  if (status) return status;
  if (/name="password"/.test(answer.body))
    return {
      ok: false,
      problem: 'The site still asks for a password: it runs a hub from before one-time links.',
      fix: 'Commit the updated @milesroxas/design-hub (package.json and pnpm-lock.yaml), then deploy again.',
    };
  if (!answer.body.includes(SIGN_IN_MARKER))
    return {
      ok: false,
      problem: `The site answered 401, but the body was not the sign-in page: ${quote(answer.body)}.`,
      fix: 'Something other than the hub’s gate answered. Check that Vercel’s Password Protection is off and that proxy.ts and vercel.json are the template’s, then deploy again.',
    };
  if (!/noindex/.test(answer.robots ?? ''))
    return {
      ok: false,
      problem: 'X-Robots-Tag: noindex is missing.',
      fix: 'Restore vercel.json from the template.',
    };
  return { ok: true };
}

/**
 * A link no store holds, asked for as a browser does once the sign-in page
 * passed: it proves the review store is wired, since people sign in only with
 * links it keeps. 43 characters, the length of a real token.
 */
export const PROBE_LINK = `/invite/${'x'.repeat(43)}`;

/** Whether the probe link's answer shows a review store behind the gate: 404 means it looked and found nothing. */
export function storeVerdict(status: number): Verdict {
  if (status === 404) return { ok: true };
  return {
    ok: false,
    problem:
      status === 503
        ? 'The site has no review store, so nobody can sign in: people sign in with links it keeps.'
        : `A sign-in link answered ${status}, not 404, so the review store could not be checked.`,
    fix: 'pnpm bootstrap --vercel <project> --review, then deploy again so the store reaches the site.',
  };
}

export type Seen = { url: string; state: string } | null;
export type Next = { done: string } | { wait: true } | { error: string; fix: string; deployment?: string };

const APPEAR_MS = 2 * 60_000;
const BUILD_MS = 10 * 60_000;

/** One look at the deployment Vercel started for a pushed commit: done, keep waiting, or stop. */
export function nextStep(seen: Seen, sha: string, waitedMs: number): Next {
  const deployment = seen ? `https://${seen.url}` : undefined;
  if (seen?.state === 'READY') return { done: `https://${seen.url}` };
  if (seen && ['ERROR', 'CANCELED'].includes(seen.state))
    return {
      error: `The deployment of ${sha.slice(0, 7)} ended ${seen.state}.`,
      fix: `vercel inspect ${deployment} --logs shows the build log.`,
      deployment,
    };
  if (!seen && waitedMs > APPEAR_MS)
    return {
      error: `Vercel started no deployment for ${sha.slice(0, 7)}.`,
      fix: 'Check the Git connection under Project Settings, Git, or run design-hub share --cli.',
    };
  if (waitedMs > BUILD_MS)
    return {
      error: 'The build is still running after 10 minutes.',
      fix: 'Run design-hub share again once it finishes; nothing is pushed twice.',
      deployment,
    };
  return { wait: true };
}

/**
 * Where the user accepts the Upstash Marketplace terms for one team: the link the
 * CLI printed when it has one, else that team's accept-terms page, else the
 * product page. The page can list several Upstash products; the store is the one
 * named here, and the rerun creates it, so nothing is created in the browser.
 */
export function upstashTerms(stderr: string, team: string | undefined): { url: string; say: string } {
  const printed = stderr.match(/https:\/\/vercel\.com\/\S*accept-terms\S*/)?.[0];
  const url =
    printed ??
    (team
      ? `https://vercel.com/${team}/~/integrations/accept-terms/upstash?source=cli`
      : 'https://vercel.com/marketplace/upstash');
  return {
    url,
    say:
      `Open ${url}${team ? ` for the ${team} team` : ''} and accept the Upstash terms. ` +
      'If it lists Upstash products, choose Install on Upstash for Redis (Redis Compatible Database), the only one Design Hub uses. ' +
      'Stop once the terms are accepted: close any step that offers to create a database, because the rerun creates the store and connects it to this project.',
  };
}

/**
 * `vercel link` appends `.vercel` and `.env*` to .gitignore. The template already
 * ignores both, and `.env*` would hide `.env.example` and leave the tree dirty, so
 * the file goes back as it was, adding only `.vercel/` when it was missing.
 */
export function restoreGitignore(before: string, after: string): string | null {
  if (after === before) return null;
  if (/^\/?\.vercel\/?$/m.test(before)) return before;
  return `${before}${before.endsWith('\n') || !before ? '' : '\n'}.vercel/\n`;
}
