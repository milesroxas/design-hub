import { type ReactNode, useEffect } from 'react';
import './app-shell.css';
import { parkDials } from '@kit/dials';
import { useHashRoute } from '@kit/hooks';
import { Icon } from '@kit/Icon';
import { BRAND, type NavItem, PRODUCT, type User, type Workspace } from '@kit/shell';
import { Button } from '@kit/ui/Button';
import { installPressFeedback } from '@kit/ui/layer';
import { useMenu } from '@kit/ui/Menu';
import { OverlayHost } from '@kit/ui/Overlay';
import { Toaster, toast } from '@kit/ui/Toast';
import { ViewTools } from '@kit/ViewTools';

parkDials();

type Props = {
  active?: string;
  role?: string;
  nav?: NavItem[];
  navFoot?: NavItem[];
  workspace?: Workspace;
  user?: User;
  children: ReactNode;
};

// The disposable product shell: a sidebar around a page, plus the dialog,
// sheet and toast hosts and the View dials. The brand, the navigation and
// the people come from kit/shell.ts; a prototype overrides them by prop
// only when its question is about them. Nav items are hash routes.
// Product chrome only: prototype controls belong in DialKit, never in the sidebar.
export function AppShell({
  active,
  role = 'Owner',
  nav = PRODUCT.nav,
  navFoot = PRODUCT.navFoot,
  workspace = PRODUCT.workspace,
  user = PRODUCT.user,
  children,
}: Props) {
  const route = useHashRoute();
  const path = active ?? route.path;

  const workspaceMenu = useMenu({
    items: [
      { label: workspace.name, desc: role, value: 'current' },
      { label: 'Another workspace', desc: 'Viewer', value: 'other' },
    ],
    align: 'start',
    width: 288,
    checkable: true,
    selected: 'current',
    onSelect: (v) => {
      if (v === 'other') toast(`Only ${workspace.name} is in this prototype.`, { kind: 'scope' });
    },
  });

  useEffect(installPressFeedback, []);

  const link = (n: NavItem) => {
    const on = path.startsWith(n.href);
    return (
      <a
        key={n.href}
        className={on ? 'nav-item is-active' : 'nav-item'}
        href={n.href}
        aria-current={on ? 'page' : undefined}
      >
        <Icon name={n.glyph} size={20} />
        <span className="nav-label">{n.label}</span>
      </a>
    );
  };

  return (
    <>
      <div className="shell">
        <aside className="sidebar" aria-label="Sidebar">
          <a className="sidebar-logo" href={nav[0]?.href ?? '#/'} aria-label={BRAND.name}>
            <Icon name={BRAND.glyph} size={24} />
            <span className="sidebar-brand">{BRAND.name}</span>
          </a>
          <button type="button" className="team" {...workspaceMenu.triggerProps}>
            <span className="team-avatar" style={{ background: workspace.color }} aria-hidden="true">
              {workspace.initials}
            </span>
            <span className="team-text">
              <span className="team-name">{workspace.name}</span>
              <span className="team-role">{role}</span>
            </span>
            <Icon name="chevron-selector-vertical" size={20} />
          </button>
          {workspaceMenu.menu}
          <nav className="nav" aria-label="Primary">
            {nav.map(link)}
          </nav>
          <div className="sidebar-foot">
            <nav className="nav" aria-label="Account">
              {navFoot.map(link)}
            </nav>
            <div className="user">
              <span className="user-avatar">{user.initials}</span>
              <span className="user-text">
                <span className="user-name">{user.name}</span>
                <span className="user-email">{user.email}</span>
              </span>
              <Button kind="tertiary" size={null} icon="log-out-01" aria-label="Log out" />
            </div>
          </div>
        </aside>
        <main className="content" id="main">
          {children}
        </main>
      </div>
      <OverlayHost />
      <Toaster />
      <ViewTools />
    </>
  );
}

export function PageHead({
  title,
  desc,
  back,
  actions,
}: {
  title: string;
  desc?: string;
  back?: { href: string; label: string };
  actions?: ReactNode;
}) {
  return (
    <>
      {back ? (
        <a className="back-link" href={back.href}>
          <Icon name="arrow-left" size={16} />
          {back.label}
        </a>
      ) : null}
      <div className="page-head">
        <div>
          <h1 className="page-title">{title}</h1>
          {desc ? <p className="page-desc">{desc}</p> : null}
        </div>
        <div className="page-actions">{actions}</div>
      </div>
    </>
  );
}
