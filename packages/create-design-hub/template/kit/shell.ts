import type { IconName } from '@kit/icons';

// The one place a project names its shell. DESIGN.md, Shell, says which Paper
// frames hold it; the values below are what the kit draws from that answer.
// AppShell (product: sidebar, content) and SiteShell (website: header,
// footer) both read this file, so the brand and the navigation are written
// once and never again inside a prototype.

export type NavItem = { href: string; label: string; glyph: IconName };
export type SiteLink = { href: string; label: string };
export type User = { name: string; email: string; initials: string };
export type Workspace = { name: string; initials: string; color: string };

export const BRAND = {
  name: 'Design Hub',
  // The product shell draws this glyph beside the name; a project swaps it
  // for its own mark in kit/icons.ts and names it here.
  glyph: 'logo' as IconName,
};

export const PRODUCT = {
  nav: [
    { href: '#/overview', label: 'Overview', glyph: 'grid-01' },
    { href: '#/items', label: 'Items', glyph: 'file-06' },
    { href: '#/people', label: 'People', glyph: 'users-01' },
    { href: '#/reports', label: 'Reports', glyph: 'bar-chart-01' },
  ] satisfies NavItem[],
  navFoot: [{ href: '#/settings', label: 'Settings', glyph: 'settings-02' }] satisfies NavItem[],
  workspace: { name: 'Sample workspace', initials: 'SW', color: '#dbe6fe' } satisfies Workspace,
  user: { name: 'Sam Reviewer', email: 'sam@example.com', initials: 'SR' } satisfies User,
};

export const SITE = {
  nav: [
    { href: '#/', label: 'Home' },
    { href: '#/work', label: 'Work' },
    { href: '#/about', label: 'About' },
    { href: '#/contact', label: 'Contact' },
  ] satisfies SiteLink[],
  footer: {
    columns: [
      {
        title: 'Company',
        links: [
          { href: '#/about', label: 'About' },
          { href: '#/careers', label: 'Careers' },
        ],
      },
      {
        title: 'Legal',
        links: [
          { href: '#/privacy', label: 'Privacy' },
          { href: '#/terms', label: 'Terms' },
        ],
      },
    ] satisfies { title: string; links: SiteLink[] }[],
    note: `© ${new Date().getFullYear()} ${BRAND.name}`,
  },
};
