import { type ReactNode, useEffect } from 'react';
import './site-shell.css';
import { useHashRoute } from '@kit/hooks';
import { Icon } from '@kit/Icon';
import { BRAND, SITE, type SiteLink } from '@kit/shell';
import { installPressFeedback } from '@kit/ui/layer';
import { OverlayHost } from '@kit/ui/Overlay';
import { Toaster } from '@kit/ui/Toast';
import { ViewTools } from '@kit/ViewTools';

type Props = {
  active?: string;
  nav?: SiteLink[];
  preFooter?: ReactNode;
  children: ReactNode;
};

// The disposable website shell: a site header and footer around a page, with
// a pre-footer slot for anything the design treats as a global (a newsletter
// band, a call to action). Reads kit/shell.ts like AppShell does.
export function SiteShell({ active, nav = SITE.nav, preFooter, children }: Props) {
  const route = useHashRoute();
  const path = active ?? route.path;

  useEffect(installPressFeedback, []);

  return (
    <>
      <div className="site">
        <header className="site-head">
          <a className="site-brand" href="#/" aria-label={BRAND.name}>
            <Icon name={BRAND.glyph} size={24} />
            <span>{BRAND.name}</span>
          </a>
          <nav className="site-nav" aria-label="Primary">
            {nav.map((n) => {
              const on = n.href === '#/' ? path === '#/' : path.startsWith(n.href);
              return (
                <a key={n.href} href={n.href} aria-current={on ? 'page' : undefined}>
                  {n.label}
                </a>
              );
            })}
          </nav>
        </header>
        <main className="site-main" id="main">
          {children}
        </main>
        {preFooter ? <section className="site-prefoot">{preFooter}</section> : null}
        <footer className="site-foot">
          <div className="site-foot-grid">
            <div className="site-foot-brand">
              <Icon name={BRAND.glyph} size={20} />
              <span>{BRAND.name}</span>
            </div>
            {SITE.footer.columns.map((c) => (
              <nav key={c.title} className="site-foot-col" aria-label={c.title}>
                <p className="site-foot-title">{c.title}</p>
                {c.links.map((l) => (
                  <a key={l.href} href={l.href}>
                    {l.label}
                  </a>
                ))}
              </nav>
            ))}
          </div>
          <p className="site-foot-note">{SITE.footer.note}</p>
        </footer>
      </div>
      <OverlayHost />
      <Toaster />
      <ViewTools />
    </>
  );
}
