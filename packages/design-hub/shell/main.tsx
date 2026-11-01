import { setGuide } from '@kit/dials';
import '@kit/tokens.css';
import '@kit/base.css';
import './system.css';
import { attachLapse } from '@kit/prefs';
import { lazy, type ReactNode, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { guideHref } from '../core/feature';
import { Index } from './Index';
import { Prototype } from './Prototype';
import { findEntry, guides } from './registry';

const params = new URLSearchParams(location.search);

// Lapse patches the clocks, so it lands before any prototype (and Motion) loads.
if (import.meta.env.DEV && params.has('lapse')) {
  // Opaque specifier: the package is optional and absent on Vercel, so Rollup must not resolve it.
  const panel = '@aiforui/lapse/panel';
  const { mountLapse } = await import(/* @vite-ignore */ panel);
  attachLapse(mountLapse({ position: 'bottom-left' }));
}

if (import.meta.env.DEV && params.get('a11y') !== '0') {
  import('./a11y').then((m) => m.watchA11y());
}

// /<slug>/ is a prototype; /guide/<feature>/ is that feature's walkthrough.
// The slug `guide` belongs to the shell (new.ts refuses it).
const [slug, sub] = location.pathname.split('/').filter(Boolean);
const Guide = lazy(() => import('./Guide'));

let page: ReactNode;
// Hub pages wear the neutral system look; a prototype keeps the project's tokens.
if (!slug || slug === 'guide') document.documentElement.classList.add('sys');
if (slug === 'guide') {
  page = (
    <Suspense fallback={null}>
      <Guide feature={sub} />
    </Suspense>
  );
} else if (slug) {
  const entry = findEntry(slug);
  if (entry?.feature && guides.has(entry.feature)) setGuide(guideHref(entry.feature));
  page = <Prototype slug={slug} entry={entry} />;
  if (entry) {
    const { mountReview } = await import('./review/mount');
    mountReview({ prototype: slug, feature: entry.feature, states: (entry.states ?? []).map((s) => s.name) });
  }
} else {
  page = <Index />;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
