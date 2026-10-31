// Mounts the review layer in its own root beside the prototype, so a
// prototype that throws never takes the comments down with it, and the
// review code loads only on prototype pages.
import { createRoot } from 'react-dom/client';
import { Review } from './Review';

export function mountReview(props: { prototype: string; feature: string; states: string[] }) {
  const host = document.createElement('div');
  host.dataset.harness = 'review-root';
  document.body.append(host);
  createRoot(host).render(<Review {...props} />);
}
