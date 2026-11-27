declare module 'virtual:design-hub/registry' {
  import type { ComponentType } from 'react';
  import type { Doc } from './doc';
  /** One prototype's entry: its README text, and its module loader, absent when the folder has no index.tsx. */
  export type RegistryEntry = { readme: string; load?: () => Promise<{ default: ComponentType }> };
  /**
   * Every prototype's slug. Built, this loads `_p/all.js`, which the gate
   * gives Studio only; for a Client it fails.
   */
  export function allSlugs(): Promise<string[]>;
  /**
   * One prototype's entry. Served, null for a slug with no prototype. Built,
   * it loads `_p/<slug>/entry.js` and fails where the gate refuses it or there is none.
   */
  export function entryOf(slug: string): Promise<RegistryEntry | null>;
  /** Each feature's compiled walkthrough loader, by feature. */
  export const guideDocs: Record<string, () => Promise<Doc>>;
}

declare module 'virtual:design-hub/lapse' {
  /** The Lapse panel's mount, or null when the project has not installed @aiforui/lapse (vite/lapse.ts). */
  export const mountLapse:
    | ((options: { position: 'bottom-left' | 'bottom-right' | 'top-left' | 'top-right' }) => {
        engine: { setSpeed(x: number): void; getSpeed(): number };
      })
    | null;
}
