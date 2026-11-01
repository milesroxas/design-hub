// The project's icons: the package's Untitled UI line set, plus the project's
// own glyphs. Add one by pasting its inner SVG here under a name; `@kit/Icon`
// draws from this file, so a glyph added here is on every prototype at once.
import { icons as base } from '@milesroxas/design-hub/kit/icons';

export const icons = {
  ...base,
  // logo: { vb: '0 0 24 24', inner: '<path d="…" fill="currentColor"/>' },
} as const;

export type IconName = keyof typeof icons;
