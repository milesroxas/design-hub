// The fixed sizes brand collateral is made in. An artboard is designed at its
// real pixel size, so type and spacing are the values that ship, and
// `design-hub export` writes it at that size: PNG for anything posted, PDF for
// anything presented or printed. One list for the kit (the browser) and the
// export command (Node).

export type Output = 'png' | 'pdf';

export type Format = {
  label: string;
  width: number;
  height: number;
  output: Output;
  /** The CSS page size for PDF; pixel formats print at their pixel size. */
  page?: string;
  /** Bands a platform's own interface covers; type and logos stay out of them. */
  safe?: { top: number; bottom: number };
};

export const FORMATS = {
  'post-square': { label: 'Post, square', width: 1080, height: 1080, output: 'png' },
  'post-portrait': { label: 'Post, portrait', width: 1080, height: 1350, output: 'png' },
  story: { label: 'Story', width: 1080, height: 1920, output: 'png', safe: { top: 250, bottom: 250 } },
  'link-preview': { label: 'Link preview', width: 1200, height: 630, output: 'png' },
  banner: { label: 'Banner', width: 1584, height: 396, output: 'png' },
  slide: { label: 'Slide', width: 1920, height: 1080, output: 'pdf' },
  a4: { label: 'A4', width: 794, height: 1123, output: 'pdf', page: '210mm 297mm' },
  letter: { label: 'Letter', width: 816, height: 1056, output: 'pdf', page: '8.5in 11in' },
} as const satisfies Record<string, Format>;

export type FormatName = keyof typeof FORMATS;

export const FORMAT_NAMES = Object.keys(FORMATS) as FormatName[];

export const isFormat = (v: unknown): v is FormatName => typeof v === 'string' && v in FORMATS;

/** `1080 × 1350`, as a label under an artboard. */
export const sizeLabel = (name: FormatName) => `${FORMATS[name].width} × ${FORMATS[name].height}`;

/** The CSS `@page` size a format prints at: its paper size, or its pixel size. */
export const pageSize = (name: FormatName) => {
  const f: Format = FORMATS[name];
  return f.page ?? `${f.width}px ${f.height}px`;
};

/** The screen scale for the Board's zoom dial: `fit`, or a percentage. */
export function zoomFor(zoom: string, name: FormatName, room: { width: number; height: number }): number {
  if (zoom === 'fit') return fitZoom(name, room);
  const percent = Number.parseFloat(zoom);
  return Number.isFinite(percent) && percent > 0 ? percent / 100 : 1;
}

/**
 * How large an artboard draws on screen: its real size at most, else what
 * fits the board's width and a comfortable height. Export always draws at 1.
 */
export function fitZoom(name: FormatName, room: { width: number; height: number }): number {
  const { width, height } = FORMATS[name];
  return Math.min(1, room.width / width, room.height / height);
}
