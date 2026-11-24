/// <reference types="node" />
// What `design-hub signin` and `design-hub share` decide, kept apart from the
// vercel and git calls that feed them so every branch is tested: the sign-in
// link in the CLI's log, which way a deploy goes, the production URL, and
// whether the deployed site answers with the gate.

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

export type Answer = { status: number; location: string | null; robots: string | null; body: string };
export type Verdict = { ok: true } | { ok: false; problem: string; fix: string };

/** Whether the production URL answers a signed-out visitor with the hub's password page. */
export function gateVerdict(answer: Answer): Verdict {
  if (answer.status >= 300 && answer.status < 400 && /vercel\.com/.test(answer.location ?? ''))
    return {
      ok: false,
      problem: 'Visitors are sent to a Vercel login before the password page.',
      fix: 'design-hub bootstrap --vercel <project> turns Vercel Authentication off; run it, then deploy again.',
    };
  if (answer.status === 503)
    return {
      ok: false,
      problem: 'The gate answers 503: GATE_PASSWORD or GATE_SECRET is missing on the deployment.',
      fix: 'design-hub bootstrap --vercel <project>, then deploy again so the env reaches the site.',
    };
  if (answer.status !== 401 || !/name="password"/.test(answer.body))
    return {
      ok: false,
      problem: `Expected the password page (401), got ${answer.status}.`,
      fix: 'Check that proxy.ts and vercel.json are the template’s, then deploy again.',
    };
  if (!/noindex/.test(answer.robots ?? ''))
    return {
      ok: false,
      problem: 'X-Robots-Tag: noindex is missing.',
      fix: 'Restore vercel.json from the template.',
    };
  return { ok: true };
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
