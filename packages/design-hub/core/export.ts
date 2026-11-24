// The decisions `design-hub export` makes, kept pure: which browser to drive,
// what each artboard becomes, and what its file is called. The command
// (scripts/export.ts) does the driving.
import { isFormat, type Output } from './formats.ts';

/** An artboard as the page reports it: its name, format, and box in page pixels. */
export type Board = {
  /** Its place on the page, so the exporter can show or hide exactly this one. */
  index: number;
  name: string;
  format: string;
  output: Output;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type As = 'auto' | Output;

/** Where Chrome, Chromium or Edge usually lives; $CHROME_PATH first. */
export function chromeCandidates(platform: string, env: Record<string, string | undefined>): string[] {
  const own = env.CHROME_PATH ? [env.CHROME_PATH] : [];
  if (platform === 'darwin')
    return [
      ...own,
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ];
  if (platform === 'win32') {
    const roots = [env.PROGRAMFILES, env['PROGRAMFILES(X86)'], env.LOCALAPPDATA].filter(Boolean);
    return [
      ...own,
      ...roots.flatMap((r) => [
        `${r}\\Google\\Chrome\\Application\\chrome.exe`,
        `${r}\\Microsoft\\Edge\\Application\\msedge.exe`,
      ]),
    ];
  }
  return [
    ...own,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/snap/bin/chromium',
  ];
}

/** The browser's DevTools address, from the line headless Chrome prints on start. */
export const devtoolsUrl = (stderr: string) =>
  stderr.match(/DevTools listening on (ws:\/\/\S+)/)?.[1] ?? null;

/** What one DevTools message means to the exporter: a reply to a command, a page exception, or nothing. */
export type DevtoolsMessage =
  | { kind: 'reply'; id: number; result: unknown; error?: string }
  | { kind: 'exception'; text: string }
  | { kind: 'other' };

type RawMessage = {
  id?: number;
  result?: unknown;
  error?: { message: string };
  method?: string;
  params?: { exceptionDetails?: { exception?: { description?: string }; text?: string } };
};

export function readDevtools(data: string): DevtoolsMessage {
  const msg = JSON.parse(data) as RawMessage;
  if (msg.id !== undefined)
    return { kind: 'reply', id: msg.id, result: msg.result, error: msg.error?.message };
  if (msg.method !== 'Runtime.exceptionThrown') return { kind: 'other' };
  const d = msg.params?.exceptionDetails;
  return { kind: 'exception', text: d?.exception?.description ?? d?.text ?? 'An exception' };
}

/** Which artboards become PNG files and which go into the one PDF. */
export function plan(boards: Board[], as: As): { png: Board[]; pdf: Board[] } {
  const output = (b: Board): Output => (as === 'auto' ? b.output : as);
  return { png: boards.filter((b) => output(b) === 'png'), pdf: boards.filter((b) => output(b) === 'pdf') };
}

const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');

/** `<slug>-<name>.png`, unique within one export: a repeated name gets -2, -3. */
export function fileNames(slug: string, boards: Board[], ext: string): string[] {
  const seen = new Map<string, number>();
  return boards.map((b, i) => {
    const base = slugify(b.name) || (isFormat(b.format) ? `${b.format}-${i + 1}` : `artboard-${i + 1}`);
    const count = (seen.get(base) ?? 0) + 1;
    seen.set(base, count);
    return `${slug}-${count > 1 ? `${base}-${count}` : base}.${ext}`;
  });
}

/**
 * The PDFs an export writes: one per format, in the order the formats first
 * appear. Chrome lays out one PDF at a single width, so a deck and an A4 page
 * in the same file would shrink each other.
 */
export function pdfFiles(slug: string, boards: Board[]): { format: string; file: string }[] {
  const formats = [...new Set(boards.map((b) => b.format))];
  return formats.map((format) => ({
    format,
    file: formats.length > 1 ? `${slug}-${format}.pdf` : `${slug}.pdf`,
  }));
}

/** The page the browser opens: the prototype in export mode, with the dial state and theme asked for. */
export function exportUrl(origin: string, slug: string, opts: { dials?: string; theme?: string }): string {
  const params = new URLSearchParams({ export: '1' });
  if (opts.dials) params.set('dials', opts.dials);
  if (opts.theme) params.set('theme', opts.theme);
  return `${origin}/${slug}/?${params}`;
}
