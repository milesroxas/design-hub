import { lazy, Suspense, useEffect, useMemo } from 'react';
import { Boundary, Notice } from './Notice';
import type { Entry } from './registry';

export function Prototype({ slug, entry }: { slug: string; entry?: Entry }) {
  const View = useMemo(() => (entry?.load ? lazy(entry.load) : null), [entry]);

  useEffect(() => {
    document.title = `${entry?.title ?? slug} · Prototypes`;
  }, [entry, slug]);

  if (!entry)
    return (
      <Notice
        title={`No prototype called “${slug}”`}
        body="Check the folder name, or start one with pnpm new."
      />
    );
  if (!View)
    return (
      <Notice title={entry.title} body={`${slug}/index.tsx is missing. It default-exports the prototype.`} />
    );

  return (
    <Boundary name={slug}>
      <Suspense fallback={null}>
        <View />
      </Suspense>
    </Boundary>
  );
}
