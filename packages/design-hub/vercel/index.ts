// What a project's two Vercel entry files import. Each is one line:
//
//   api/review.ts   export default reviewFunction(checks)   with its .design-hub/checks.json
//   proxy.ts        export default createProxy({ siteName: 'Prototypes' })
import { loadChecks } from '../core/checks.ts';
import { deployedHandler } from '../server/api.ts';

export { createProxy, GATE_FONT, gatePreview } from './proxy.ts';

/** The /api/review function. `checks` is the project's checks.json, so triage runs on the project's thresholds. */
export function reviewFunction(checks: unknown = null) {
  const loaded = loadChecks(checks).checks;
  return { fetch: (request: Request) => deployedHandler(request, loaded) };
}
