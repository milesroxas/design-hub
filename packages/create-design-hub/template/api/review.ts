// The review API on Vercel. The project's thresholds travel with it.
import { reviewFunction } from '@milesroxas/design-hub/vercel';
import checks from '../.design-hub/checks.json' with { type: 'json' };

export default reviewFunction(checks);
