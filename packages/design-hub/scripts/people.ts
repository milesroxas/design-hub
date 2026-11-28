#!/usr/bin/env node
/// <reference types="node" />
// The people who comment on the deployed prototypes. The first Studio person
// is added from here; after that, Studio adds people from the People tab.
// Each person signs in with a one-time link: it signs in one device, then
// stops working, so a second device needs a new link.
import { ACCESS, PERSON_KINDS, type Person } from '../core/review/model.ts';
import type { Review } from '../core/review/service.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { cliActor, cliReview, cliScope } from './lib/review.ts';

export const spec = {
  name: 'people',
  summary:
    'List or add the people who comment on the deployed prototypes, give them sign-in links, sign them out, revoke them, and set how long they keep access.',
  positionals: [
    {
      name: 'action',
      description:
        'list (default): everyone. add: a new person and their link. link <id>: another one-time link, for another device. sign-out <id>: ends every session and unused link, and gives one new link. revoke <id>: ends their access everywhere. access [id]: with an id and --access, sets that person’s access from now; without an id, reads the project default, or sets it with --access.',
    },
    { name: 'id', description: 'The person, for link, sign-out, revoke and access' },
  ],
  flags: {
    name: { type: 'string', description: 'For add: their name as it shows on comments.' },
    team: { type: 'string', description: "For add: the studio, or the client's company." },
    kind: {
      type: 'string',
      default: 'client',
      choices: PERSON_KINDS,
      description:
        'client comments, replies and resolves any thread; studio also deletes any comment, sorts and manages people.',
    },
    access: {
      type: 'string',
      choices: ACCESS,
      description:
        'How long they keep access: 3m, 6m or open. For add, absent means the project default for a client and open for studio.',
    },
    site: { type: 'string', description: 'The deployed URL, so the link prints whole.' },
    local: {
      type: 'boolean',
      description: 'Use the local dev store even when the deployed one is configured.',
    },
  },
  output:
    '{ ok, store, people } or { ok, store, person, link } or { ok, store, person } or { ok, store, access }',
} as const satisfies CommandSpec;

type Flags = Args<typeof spec>['flags'];
type Context = { review: Review; actor: Person; flags: Flags; id: string | undefined };

const linkFor = (token: string, site?: string) => {
  const path = `/invite/${token}`;
  if (!site) return { link: path, next: 'Prefix the link with the deployed URL, or pass --site <url>.' };
  try {
    return { link: new URL(path, site).href };
  } catch {
    throw new CliError('--site takes a URL.', { got: site });
  }
};

const strip = <T extends { epoch: number }>({ epoch: _e, ...rest }: T) => rest;

function needId(action: string, id: string | undefined): string {
  if (!id)
    throw new CliError(`Name the person: pnpm people ${action} <id>.`, { fix: 'pnpm people lists ids.' });
  return id;
}

const withLink = (r: { person: Person; token: string }, site?: string) => ({
  person: strip(r.person),
  ...linkFor(r.token, site),
});

/** One person's access with an id, else the project default: read it, or set it with --access. */
async function access({ review, actor, flags, id }: Context) {
  if (id) {
    if (!flags.access) throw new CliError('Say how long: pnpm people access <id> --access 3m|6m|open.');
    return { person: strip(await review.setAccess(cliScope, actor, id, flags.access)) };
  }
  return {
    access: flags.access
      ? await review.setDefaultAccess(cliScope, actor, flags.access)
      : await review.defaultAccess(cliScope, actor),
  };
}

const ACTIONS: Record<string, (c: Context) => Promise<Record<string, unknown>>> = {
  list: async ({ review, actor }) => ({ people: (await review.listPeople(cliScope, actor)).map(strip) }),
  add: async ({ review, actor, flags }) =>
    withLink(
      await review.addPerson(cliScope, actor, {
        name: flags.name,
        team: flags.team,
        kind: flags.kind,
        access: flags.access,
      }),
      flags.site,
    ),
  link: async ({ review, actor, flags, id }) =>
    withLink(await review.newLink(cliScope, actor, needId('link', id)), flags.site),
  'sign-out': async ({ review, actor, flags, id }) =>
    withLink(await review.signOutEverywhere(cliScope, actor, needId('sign-out', id)), flags.site),
  revoke: async ({ review, actor, id }) => ({
    person: strip(await review.revoke(cliScope, actor, needId('revoke', id))),
  }),
  access,
};

export async function main({ positionals: [action = 'list', id], flags }: Args<typeof spec>) {
  const run = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!run)
    throw new CliError(`Unknown action ${action}.`, { fix: 'list, add, link, sign-out, revoke or access' });
  if (flags.local && flags.site)
    throw new CliError(
      '--local and --site do not go together: a local link opens nothing on the deployed site.',
      {
        fix: 'Drop --site for a local link, or drop --local to use the deployed store.',
      },
    );
  const { review, store } = cliReview(flags.local);
  // A link made in the local store opens nothing on the deployed site, so never print one under its URL.
  if (flags.site && store === 'local')
    throw new CliError('--site names the deployed site, but its store is not configured here.', {
      fix: 'KV_REST_API_URL and KV_REST_API_TOKEN are missing from .env: pnpm bootstrap --vercel <project> --review puts them there. For a local link, pass --local without --site.',
    });
  return { store, ...(await run({ review, actor: cliActor(), flags, id })) };
}
