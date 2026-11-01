/// <reference types="node" />
// The review API in `design-hub dev`: the same handler as on Vercel, over a local
// store at .design-hub/review.json, with no gate. Whoever runs the dev
// server is a local editor (named from git config), so the whole review UI,
// people panel included, works offline and needs no account.
import type { ServerResponse } from 'node:http';
import type { Connect, Plugin } from 'vite';
import { createReview } from '../core/review/service.ts';
import { KEY } from '../core/review/store.ts';
import { jevTriager } from '../core/review/triage.ts';
import { API_PATH, handleReview } from './api.ts';
import { checks } from './checks.ts';
import { readEnv } from './env.ts';
import { fileKV } from './file-kv.ts';
import { LOCAL_STORE, localEditor } from './local.ts';
import { ROOT } from './paths.ts';

// Connect strips the mount path from req.url; originalUrl keeps the query the handler reads.
async function toRequest(req: Connect.IncomingMessage): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  return new Request(`http://${req.headers.host ?? 'localhost'}${req.originalUrl ?? req.url}`, {
    method: req.method,
    headers,
    body: req.method === 'GET' || req.method === 'HEAD' ? undefined : body,
  });
}

async function send(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    res.setHeader(key, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

export function devReview(): Plugin {
  return {
    name: 'dev-review',
    apply: 'serve',
    configureServer(server) {
      const kv = fileKV(LOCAL_STORE);
      // The project's .env only, never the shell: TypeSafe is on only where the project opted in.
      const review = createReview(kv, {
        triage: jevTriager(readEnv(ROOT).TYPESAFE_API_KEY ?? '', checks),
      });
      const actor = localEditor();
      // The local editor is in the people list like anyone else, so the people panel shows them.
      void kv.hset(KEY.people, actor.id, JSON.stringify(actor));
      server.middlewares.use(API_PATH, (req, res, nextMiddleware) => {
        toRequest(req)
          .then((request) => handleReview(request, { review, actor }))
          .then((response) => send(res, response))
          .catch(nextMiddleware);
      });
    },
  };
}
