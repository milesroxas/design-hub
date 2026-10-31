// One client for TypeSafe's Jev (System One), on plain fetch, so the same
// code runs in the scripts and in the Vercel server code with no SDK to
// install. API: https://docs.typesafe.ai/api/system-one.md
//
// It never throws and never retries. Every caller treats a failure the same
// way, fail open: a check is never the reason the user is blocked, and a
// retry would only spend the latency budget the caller set.

const JEV_URL = 'https://api.typesafe.ai/v1/systemone';

export type Question =
  | { type: 'noul'; instructions: string }
  | { type: 'choice'; instructions: string; criteria: Record<string, string | null> };

export type Answer =
  | { type: 'noul'; noul: number }
  | { type: 'choice'; choice: string; confidence: number; probabilities: Record<string, number> };

/** An image the state or a question refers to by its key. Experimental on TypeSafe's side. */
export type ImageAsset = { type: 'image'; format: 'png' | 'jpg' | 'jpeg'; data_base64: string };

export type JevRequest = {
  model: string;
  state: unknown;
  questions: Record<string, Question>;
  assets?: Record<string, ImageAsset>;
};

export type JevResult =
  | { ok: true; model: string; answers: Record<string, Answer>; ms: number }
  | { ok: false; error: string; ms: number };

type Options = { timeoutMs: number; fetch?: typeof fetch };

export async function askJev(apiKey: string, request: JevRequest, options: Options): Promise<JevResult> {
  const started = Date.now();
  const ms = () => Date.now() - started;
  const headers: Record<string, string> = {
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
    accept: 'application/json',
  };
  // Images sit behind TypeSafe's "danger zone" header; without it the request is a 400.
  if (request.assets && Object.keys(request.assets).length) headers['typesafe-danger-zone-images'] = 'true';
  try {
    const response = await (options.fetch ?? fetch)(JEV_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    if (!response.ok) {
      const id = response.headers.get('x-typesafe-request-id');
      const body = (await response.text()).slice(0, 300);
      return { ok: false, error: `${response.status}${id ? ` (${id})` : ''}: ${body}`, ms: ms() };
    }
    const json = (await response.json()) as { model?: string; answers?: Record<string, Answer> };
    if (!json.answers) return { ok: false, error: 'response had no answers', ms: ms() };
    return { ok: true, model: json.model ?? request.model, answers: json.answers, ms: ms() };
  } catch (error) {
    const name = error instanceof Error ? error.name : '';
    const error_ = name === 'TimeoutError' ? `timeout after ${options.timeoutMs}ms` : String(error);
    return { ok: false, error: error_, ms: ms() };
  }
}

/** The yes-probability of a Noul answer, or null when it is missing or another type. */
export const noulOf = (answers: Record<string, Answer>, key: string): number | null => {
  const a = answers[key];
  return a?.type === 'noul' && typeof a.noul === 'number' ? a.noul : null;
};

/** A Choice answer, or null when it is missing or another type. */
export const choiceOf = (answers: Record<string, Answer>, key: string) => {
  const a = answers[key];
  return a?.type === 'choice' ? a : null;
};
