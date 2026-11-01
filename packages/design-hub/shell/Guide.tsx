import { Icon } from '@kit/Icon';
import '@kit/ui/ui.css';
import { Suspense, use, useEffect, useState } from 'react';
import { featureTitle, guideHref } from '../core/feature';
import type { Doc } from './doc';
import { Boundary, Notice } from './Notice';
import { featureEntry, guides } from './registry';
import './guide.css';

const fmtDate = (iso: string) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : '';

// One promise per guide, so a suspended render retries against the same load;
// a failed load leaves the cache, so the next render asks again.
const docs = new Map<string, Promise<Doc>>();
function docOf(feature: string) {
  let doc = docs.get(feature);
  if (!doc) {
    doc = guides.get(feature)!();
    docs.set(feature, doc);
    doc.catch(() => docs.delete(feature));
  }
  return doc;
}

// /guide/<feature>/ renders docs/sprints/<feature>/guide.md. /guide/ alone
// opens the only guide when there is one, and lists them otherwise.
export default function Guide({ feature }: { feature?: string }) {
  const key = feature ?? (guides.size === 1 ? guides.keys().next().value : undefined);
  if (!key || !guides.has(key))
    return feature ? (
      <Notice title={`No walkthrough for “${feature}”`} body="Add one at docs/sprints/<feature>/guide.md." />
    ) : (
      <GuideList />
    );
  return (
    <Boundary name={`The ${featureTitle(key)} walkthrough`}>
      <Suspense fallback={null}>
        <GuidePage feature={key} />
      </Suspense>
    </Boundary>
  );
}

function GuideList() {
  return (
    <main className="shell-notice">
      <h1>Walkthroughs</h1>
      {guides.size ? (
        <ul>
          {[...guides.keys()].map((f) => (
            <li key={f}>
              <a href={guideHref(f)}>{featureTitle(f)}</a>
            </li>
          ))}
        </ul>
      ) : (
        <p>No walkthrough yet. Start one with pnpm new:guide &lt;feature&gt;.</p>
      )}
      <a href="/">All prototypes</a>
    </main>
  );
}

// The Markdown is the source; this page is how a reviewer without the repo reads it.
function GuidePage({ feature }: { feature: string }) {
  const { html, meta, title, toc } = use(docOf(feature));
  const prototype = featureEntry(feature);
  const [current, setCurrent] = useState<string | null>(null);

  useEffect(() => {
    document.title = `${title} · Prototypes`;
    if (location.hash)
      document.getElementById(location.hash.slice(1))?.scrollIntoView({ behavior: 'instant' });
  }, [title]);

  // The contents follow the reader: the last heading above the top third of
  // the viewport is the current one.
  useEffect(() => {
    const heads = Array.from(document.querySelectorAll<HTMLElement>('.doc-body :is(h2, h3)'));
    if (!heads.length) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const line = innerHeight / 3;
      let found: string | null = null;
      for (const h of heads) {
        if (h.getBoundingClientRect().top <= line) found = h.id;
        else break;
      }
      setCurrent(found);
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    addEventListener('scroll', onScroll, { passive: true });
    addEventListener('resize', onScroll);
    return () => {
      removeEventListener('scroll', onScroll);
      removeEventListener('resize', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <main className="doc">
      <div className="doc-layout">
        <header className="doc-head">
          <a className="doc-back" href="/">
            <Icon name="arrow-left" size={16} />
            Prototypes
          </a>
          <div className="doc-head-row">
            <div className="doc-head-text">
              <p className="doc-kicker">
                {featureTitle(feature)} · Walkthrough · <time dateTime={meta.date}>{fmtDate(meta.date)}</time>
              </p>
              <h1 className="doc-title">{title}</h1>
            </div>
            {prototype ? (
              <a
                className="btn btn-primary btn-md"
                href={`/${prototype.slug}/`}
                target="_blank"
                rel="noreferrer"
              >
                <span className="btn-label">Open the prototype</span>
                <Icon name="arrow-up-right" size={16} />
              </a>
            ) : null}
          </div>
        </header>
        <nav className="doc-toc" aria-label="Contents">
          <p className="doc-toc-label">Contents</p>
          <ol>
            {toc.map((h) => (
              <li key={h.id} className={h.depth === 3 ? 'is-sub' : undefined}>
                <a href={`#${h.id}`} aria-current={current === h.id ? 'location' : undefined}>
                  {h.text}
                </a>
              </li>
            ))}
          </ol>
        </nav>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: compiled at build time from a Markdown file in this repo */}
        <article className="doc-body" dangerouslySetInnerHTML={{ __html: html }} />
        <footer className="doc-foot">
          <a href="/">All prototypes</a>
        </footer>
      </div>
    </main>
  );
}
