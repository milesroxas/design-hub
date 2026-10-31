// _kit/tokens.css read as data: the light values on :root and the dark
// overrides on .dark-mode, each classified by what an Elyx token can hold.
// Pure, so the Elyx generator's mapping is tested without the Elyx CLI.

export type TokenKind = 'color' | 'radius' | 'length' | 'font';
export type Classified = { kind: TokenKind; value: string } | { kind: 'skip'; why: string };

// The harness is the prototype's own voice, never the product's, so it never enters the design system.
const EXCLUDED = /^harness-/;

/** The custom properties declared in one selector's block, comments stripped. */
export function block(css: string, selector: string): Map<string, string> {
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, '');
  const at = clean.indexOf(`${selector} {`);
  if (at < 0) throw new Error(`tokens.css has no ${selector} block.`);
  const body = clean.slice(clean.indexOf('{', at) + 1, clean.indexOf('}', at));
  const out = new Map<string, string>();
  for (const decl of body.split(';')) {
    const m = decl.match(/^\s*--([A-Za-z_-][\w-]*)\s*:\s*([\s\S]+?)\s*$/);
    if (m) out.set(m[1], m[2].replace(/\s+/g, ' '));
  }
  return out;
}

const byte = (n: number) =>
  Math.round(Math.min(255, Math.max(0, n)))
    .toString(16)
    .padStart(2, '0');

function hexColor(value: string): string | null {
  const m = value.match(/^#([0-9a-f]{3,8})$/i);
  if (!m) return null;
  const short = m[1].length === 3 || m[1].length === 4;
  const h = short ? [...m[1].toLowerCase()].map((c) => c + c).join('') : m[1].toLowerCase();
  if (h.length !== 6 && h.length !== 8) return null;
  return `#${h.length === 8 && h.endsWith('ff') ? h.slice(0, 6) : h}`;
}

const channel = (p: string) => (p.endsWith('%') ? (Number.parseFloat(p) * 255) / 100 : Number.parseFloat(p));
const alphaOf = (p: string | undefined) =>
  p === undefined ? 1 : p.endsWith('%') ? Number.parseFloat(p) / 100 : Number.parseFloat(p);

function rgbColor(value: string): string | null {
  const m = value.match(/^rgba?\(\s*([^)]+)\)$/i);
  const parts = m ? m[1].split(/\s*[,/]\s*|\s+/).filter(Boolean) : [];
  if (parts.length < 3 || parts.length > 4) return null;
  const rgb = parts.slice(0, 3).map(channel);
  const alpha = alphaOf(parts[3]);
  if (![...rgb, alpha].every(Number.isFinite)) return null;
  return `#${rgb.map(byte).join('')}${alpha >= 1 ? '' : byte(alpha * 255)}`;
}

/** #rgb, #rrggbbaa, rgb() and rgba() as lowercase #rrggbb or #rrggbbaa; null for anything else. */
export const toHex = (value: string): string | null => hexColor(value) ?? rgbColor(value);

export function classify(name: string, value: string): Classified {
  if (EXCLUDED.test(name)) return { kind: 'skip', why: 'harness material, not the design' };
  const color = toHex(value);
  if (color) return { kind: 'color', value: color };
  const px = value.match(/^(-?\d+(?:\.\d+)?)px$/);
  if (px) return { kind: name.startsWith('radius-') ? 'radius' : 'length', value: px[1] };
  if (/^font(-|$)/.test(name)) {
    // Elyx binds one family; the first in the stack is the design's, the rest are fallbacks.
    const first = value
      .split(',')[0]
      .trim()
      .replace(/^["']|["']$/g, '');
    return { kind: 'font', value: JSON.stringify(first) };
  }
  return { kind: 'skip', why: 'no Elyx token type (a shadow, ring, easing, duration or keyword)' };
}
