declare module 'virtual:design-hub/registry' {
  import type { ComponentType } from 'react';
  import type { Doc } from './doc';
  /** Each prototype's README text, by slug. */
  export const readmes: Record<string, string>;
  /** Each prototype's module loader, by slug; absent when the folder has no index.tsx. */
  export const modules: Record<string, () => Promise<{ default: ComponentType }>>;
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
