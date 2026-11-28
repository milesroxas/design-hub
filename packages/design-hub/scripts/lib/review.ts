/// <reference types="node" />
// The review service from the command line: the deployed store when its
// credentials are in .env (`design-hub bootstrap --review` puts them there), else
// the local one the dev server uses. The CLI acts as Studio, because
// whoever holds the store's credentials can already do anything to it.
import { createReview, type Review } from '../../core/review/service.ts';
import { jevTriager } from '../../core/review/triage.ts';
import { checks } from '../../server/checks.ts';
import { readEnv } from '../../server/env.ts';
import { fileKV } from '../../server/file-kv.ts';
import { LOCAL_STORE, localStudio } from '../../server/local.ts';
import { ROOT } from '../../server/paths.ts';
import { SITE_SCOPE } from '../../server/session.ts';
import { storeConfig, upstashKV } from '../../server/upstash.ts';

export type CliReview = { review: Review; store: 'deployed' | 'local' };

export function cliReview(local: boolean): CliReview {
  const env = readEnv(ROOT);
  const config = local ? null : storeConfig(env);
  const triage = jevTriager(env.TYPESAFE_API_KEY ?? '', checks);
  return config
    ? { review: createReview(upstashKV(config), { triage }), store: 'deployed' }
    : { review: createReview(fileKV(LOCAL_STORE), { triage }), store: 'local' };
}

export const cliActor = () => localStudio('cli', 'CLI');

/** The CLI acts in the site's one scope, as the deployed API does, so both read and write the same records. */
export const cliScope = SITE_SCOPE;
