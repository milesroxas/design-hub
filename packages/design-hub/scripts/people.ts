#!/usr/bin/env node
/// <reference types="node" />
// The people who comment on the deployed prototypes. The first editor is
// invited from here; after that, editors invite from the People tab.
import { ROLES } from '../core/review/model.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { cliActor, cliReview } from './lib/review.ts';

export const spec = {
  name: 'people',
  summary: 'List, invite, reissue or revoke the people who comment on the deployed prototypes.',
  positionals: [
    {
      name: 'action',
      description:
        'list (default): everyone who may comment. invite: a new person and their link. reissue <id>: a new link; the old one and every session stop. revoke <id>.',
    },
    { name: 'id', description: 'The person, for reissue and revoke' },
  ],
  flags: {
    name: { type: 'string', description: 'For invite: their name as it shows on comments.' },
    team: { type: 'string', description: "For invite: the studio, or the client's company." },
    role: {
      type: 'string',
      default: 'reviewer',
      choices: ROLES,
      description: 'reviewer comments; editor also resolves, sorts and invites.',
    },
    site: { type: 'string', description: 'The deployed URL, so the invite link prints whole.' },
    local: {
      type: 'boolean',
      description: 'Use the local dev store even when the deployed one is configured.',
    },
  },
  output: '{ ok, store, people } or { ok, store, person, link }',
} as const satisfies CommandSpec;

const linkFor = (token: string, site?: string) => {
  const path = `/invite/${token}`;
  if (!site) return { link: path, next: 'Prefix the link with the deployed URL, or pass --site <url>.' };
  try {
    return { link: new URL(path, site).href };
  } catch {
    throw new CliError('--site takes a URL.', { got: site });
  }
};

export async function main({ positionals: [action = 'list', id], flags }: Args<typeof spec>) {
  const { review, store } = cliReview(flags.local);
  const actor = cliActor();
  const strip = <T extends { epoch: number }>({ epoch: _e, ...rest }: T) => rest;
  switch (action) {
    case 'list':
      return { store, people: (await review.listPeople(actor)).map(strip) };
    case 'invite': {
      const { person, token } = await review.invite(actor, {
        name: flags.name,
        team: flags.team,
        role: flags.role,
      });
      return { store, person: strip(person), ...linkFor(token, flags.site) };
    }
    case 'reissue':
    case 'revoke': {
      if (!id)
        throw new CliError(`Name the person: pnpm people ${action} <id>.`, { fix: 'pnpm people lists ids.' });
      if (action === 'revoke') return { store, person: strip(await review.revoke(actor, id)) };
      const { person, token } = await review.reissue(actor, id);
      return { store, person: strip(person), ...linkFor(token, flags.site) };
    }
    default:
      throw new CliError(`Unknown action ${action}.`, { fix: 'list, invite, reissue or revoke' });
  }
}
