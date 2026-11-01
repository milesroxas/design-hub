// The review API: one endpoint, /api/review, shaped as queries (GET ?op=)
// and commands (POST { op, ... }). One handler serves the Vercel function
// (vercel/review.ts) and the Vite dev server (server/dev.ts); only how each
// finds the store and the signed-in person differs. A single endpoint keeps
// the routing in code and out of vercel.json rewrites.
import type { Checks } from '../core/checks.ts';
import { SLUG } from '../core/feature.ts';
import type { Person } from '../core/review/model.ts';
import { createReview, type Review, ReviewError } from '../core/review/service.ts';
import { jevTriager } from '../core/review/triage.ts';
import { type Gate, PERSON_COOKIE, readCookie, readGate, readPersonToken, sameOrigin } from './session.ts';
import { storeConfig, upstashKV } from './upstash.ts';

export const API_PATH = '/api/review';
const MAX_BODY_BYTES = 64 * 1024;

const STATUS: Record<ReviewError['code'], number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  invalid: 422,
};

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

/** What the browser may see of a person: everything but the session epoch. */
const visible = ({ epoch: _epoch, ...p }: Person) => p;

const str = (v: unknown) => (typeof v === 'string' ? v : '');
function prototypeOf(v: unknown): string {
  const s = str(v);
  if (!SLUG.test(s)) throw new ReviewError('invalid', 'Name the prototype.', ['prototype: a prototype slug']);
  return s;
}

export type ApiContext = { review: Review; actor: Person | null };

async function query(op: string, params: URLSearchParams, { review, actor }: ApiContext): Promise<unknown> {
  switch (op) {
    case 'me':
      return { person: actor ? visible(actor) : null };
    case 'comments':
      return { comments: await review.listComments(actor, prototypeOf(params.get('prototype'))) };
    case 'people':
      return { people: (await review.listPeople(actor)).map(visible) };
    default:
      return undefined;
  }
}

async function command(
  op: string,
  b: Record<string, unknown>,
  { review, actor }: ApiContext,
): Promise<unknown> {
  const at = () => ({ prototype: prototypeOf(b.prototype), id: str(b.id) });
  const link = (r: { person: Person; token: string }) => ({
    person: visible(r.person),
    link: `/invite/${r.token}`,
  });
  switch (op) {
    case 'comment.add':
      return { comment: await review.add(actor, { body: b.body, anchor: b.anchor, states: b.states }) };
    case 'comment.reply':
      return {
        comment: await review.reply(actor, {
          prototype: prototypeOf(b.prototype),
          thread: str(b.thread),
          body: b.body,
        }),
      };
    case 'comment.edit':
      return { comment: await review.edit(actor, { ...at(), body: b.body }) };
    case 'comment.remove':
      return { removed: await review.remove(actor, at()) };
    case 'comment.resolve':
      return { comment: await review.resolve(actor, { ...at(), resolved: b.resolved === true }) };
    case 'comment.triage':
      return { comment: await review.retriage(actor, { ...at(), triage: b.triage, states: b.states }) };
    case 'people.invite':
      return link(await review.invite(actor, { name: b.name, team: b.team, role: b.role }));
    case 'people.reissue':
      return link(await review.reissue(actor, str(b.id)));
    case 'people.revoke':
      return { person: visible(await review.revoke(actor, str(b.id))) };
    default:
      return undefined;
  }
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!(request.headers.get('content-type') ?? '').startsWith('application/json')) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

export async function handleReview(request: Request, ctx: ApiContext): Promise<Response> {
  try {
    if (request.method === 'GET') {
      const params = new URL(request.url).searchParams;
      const result = await query(params.get('op') ?? '', params, ctx);
      return result === undefined ? json(400, { error: 'Unknown query.' }) : json(200, result);
    }
    if (request.method === 'POST') {
      // JSON only and same origin: a cross-site form cannot send JSON without a CORS preflight, which this never answers.
      if (!sameOrigin(request)) return json(403, { error: 'Cross-origin request refused.' });
      const body = await readJson(request);
      if (!body) return json(400, { error: `Send a JSON object of ${MAX_BODY_BYTES / 1024} KB or less.` });
      const result = await command(str(body.op), body, ctx);
      return result === undefined ? json(400, { error: 'Unknown command.' }) : json(200, result);
    }
    return new Response('Method not allowed', { status: 405, headers: { allow: 'GET, POST' } });
  } catch (error) {
    if (error instanceof ReviewError)
      return json(STATUS[error.code], { error: error.message, problems: error.problems });
    console.error('[review]', error);
    return json(500, { error: 'The review store did not answer. Try again.' });
  }
}

/** The person a request's signed cookie names, while they may still sign in. */
export async function actorFrom(request: Request, review: Review, gate: Gate): Promise<Person | null> {
  const claim = await readPersonToken(gate, readCookie(request, PERSON_COOKIE));
  return claim ? review.sessionPerson(claim.id, claim.epoch) : null;
}

export type Deployed = { review: Review; gate: Gate } | { error: string };

/** The review service as deployed: Upstash for the store, Jev for triage when its key is set and `checks` is given. */
export function deployedReview(
  env: Record<string, string | undefined>,
  checks: Checks | null = null,
): Deployed {
  const gate = readGate(env);
  if (!gate) return { error: 'The prototype gate is not configured.' };
  const store = storeConfig(env);
  if (!store)
    return { error: 'Review is not set up on this site: pnpm bootstrap --vercel <project> --review.' };
  return {
    gate,
    review: createReview(upstashKV(store), { triage: jevTriager(env.TYPESAFE_API_KEY ?? '', checks) }),
  };
}

/** The Vercel function's whole body; `checks` is the project's checks.json, bundled by its api/review.ts. */
export async function deployedHandler(request: Request, checks: Checks | null): Promise<Response> {
  const setup = deployedReview(process.env, checks);
  if ('error' in setup) return json(503, { error: setup.error });
  return handleReview(request, {
    review: setup.review,
    actor: await actorFrom(request, setup.review, setup.gate),
  });
}
