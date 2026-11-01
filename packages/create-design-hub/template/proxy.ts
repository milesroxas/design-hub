// The password gate in front of every deployed path (vercel.json, proxy.entrypoint).
import { createProxy } from 'design-hub/vercel';

export default createProxy({ siteName: 'Prototypes' });
