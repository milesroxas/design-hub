import { setGuide } from '@kit/dials';
import '@kit/tokens.css';
import '@kit/base.css';
import './system.css';
import { attachLapse, isClientView, setClientView } from '@kit/prefs';
import { lazy, type ReactNode, StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import { guideHref } from '../core/feature';
import { hiddenFor } from './audience';
import { ClientViewNote, PrototypeClientView } from './ClientViewNote';
import { exportControls, loadControls } from './controls';
import { readHub } from './hub';
import { Index } from './Index';
import { Notice } from './Notice';
import { Prototype } from './Prototype';
import { getEntry, guides } from './registry';

const params = new URLSearchParams(location.search);
// `design-hub export` opens a prototype with ?export: its artboards alone, no
// review panel, no dials, no accessibility overlay (kit/Artboard.tsx).
const exporting = params.has('export');
if (exporting) document.documentElement.dataset.export = '';

// Lapse patches the clocks, so it lands before any prototype (and Motion) loads.
// The module is empty unless the project installed @aiforui/lapse (vite/lapse.ts).
if (import.meta.env.DEV && params.has('lapse')) {
  const { mountLapse } = await import('virtual:design-hub/lapse');
  if (mountLapse) attachLapse(mountLapse({ position: 'bottom-left' }));
  else console.warn('[design-hub] ?lapse needs Lapse in the project: pnpm add -D @aiforui/lapse');
}

if (import.meta.env.DEV && !exporting && params.get('a11y') !== '0') {
  import('./a11y').then((m) => m.watchA11y());
}

// /<slug>/ is a prototype; /guide/<feature>/ is that feature's walkthrough.
// `invite`, `api`, `_gate`, `_p`, `assets`, `guide`, `index.html` and `favicon.svg`
// belong to the hub (RESERVED in core/prototype.ts; new.ts refuses them).
const [slug, sub] = location.pathname.split('/').filter(Boolean);
const Guide = lazy(() => import('./Guide'));

/**
 * The prototype a page opens, or none, and whether Studio's Client view is
 * what hides it: one a client cannot open reads as missing there, as it does
 * for them (the gate refuses it to a Client).
 */
async function pageEntry(name: string) {
  const entry = await getEntry(name);
  if (!entry || !isClientView()) return { entry, hidden: false };
  const answer = await readHub('client').catch(() => null);
  const hidden = hiddenFor(answer, name) && answer?.me?.kind === 'studio';
  return { entry: hidden ? undefined : entry, hidden };
}

/** Studio in Client view on a prototype a client cannot open: the missing page, with the way back. */
function HiddenInClientView({ name }: { name: string }) {
  const leave = () => {
    setClientView(false);
    location.reload();
  };
  return (
    <>
      <Notice
        title={`No prototype called “${name}”`}
        body="Check the link, or open one from all prototypes."
      />
      <ClientViewNote onLeave={leave} />
    </>
  );
}

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
  // The controls' audience is read beside the entry, so the first render already has it.
  const [{ entry, hidden }] = await Promise.all([
    pageEntry(slug),
    exporting ? exportControls() : loadControls(slug),
  ]);
  if (entry?.feature && guides.has(entry.feature)) setGuide(guideHref(entry.feature));
  page = hidden ? (
    <HiddenInClientView name={slug} />
  ) : (
    <>
      <Prototype slug={slug} entry={entry} />
      {exporting ? null : <PrototypeClientView />}
    </>
  );
  if (entry && !exporting) {
    const { mountReview } = await import('./review/mount');
    mountReview({ prototype: slug, feature: entry.feature, states: (entry.states ?? []).map((s) => s.name) });
  }
} else {
  page = <Index />;
}

createRoot(document.getElementById('root')!).render(<StrictMode>{page}</StrictMode>);
