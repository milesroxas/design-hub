// The review API on Vercel. Everything is in _server/api.ts; this file only
// gives Vercel its entry point. The password gate (proxy.ts) runs first.
import { deployedHandler } from '../_server/api.ts';

export default { fetch: deployedHandler };
