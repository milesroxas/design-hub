/// <reference types="node" />
// The review service from the command line: the deployed store when its
// credentials are in .env (`pnpm bootstrap --review` puts them there), else
// the local one the dev server uses. The CLI acts as an editor, because
// whoever holds the store's credentials can already do anything to it.
import { createReview, type Review } from '../../_core/review/service.ts';
import { jevTriager } from '../../_core/review/triage.ts';
import { readEnv } from '../../_server/env.ts';
import { fileKV } from '../../_server/file-kv.ts';
import { LOCAL_STORE, localEditor } from '../../_server/local.ts';
import { PROTOTYPES } from '../../_server/paths.ts';
import { storeConfig, upstashKV } from '../../_server/upstash.ts';

export type CliReview = { review: Review; store: 'deployed' | 'local' };

export function cliReview(local: boolean): CliReview {
  const env = readEnv(PROTOTYPES);
  const config = local ? null : storeConfig(env);
  const triage = jevTriager(env.TYPESAFE_API_KEY ?? '');
  return config
    ? { review: createReview(upstashKV(config), { triage }), store: 'deployed' }
    : { review: createReview(fileKV(LOCAL_STORE), { triage }), store: 'local' };
}

export const cliActor = () => localEditor('cli', 'CLI');
