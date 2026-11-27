import {
  createContext,
  type ReactNode,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'react';
import { FORMATS, type Format, type FormatName, sizeLabel, zoomFor } from '../core/formats.ts';
import { client, restoreDials, useDials } from './dials';
import { pinAppearance, urlAppearance } from './prefs';
import { ViewScope } from './ViewTools';
import './artboard.css';

export { FORMAT_NAMES, FORMATS, type FormatName } from '../core/formats.ts';

const params = new URLSearchParams(location.search);
/** True when `design-hub export` opened the page: artboards only, at their real size, no tools. */
export const exporting = params.has('export');

type View = { zoom: string; guides: boolean; room: { width: number; height: number } };
const BoardView = createContext<View>({ zoom: '100%', guides: false, room: { width: 1e5, height: 1e5 } });

const ZOOMS = ['fit', '25%', '50%', '100%'];
const frames = (n: number) =>
  new Promise<void>((resolve) => {
    const step = (left: number) => (left ? requestAnimationFrame(() => step(left - 1)) : resolve());
    step(n);
  });

/** Applies the export's dial state, waits for fonts and images, then tells the exporter the page is ready. */
async function settleForExport() {
  const dials = params.get('dials');
  if (dials) restoreDials(JSON.parse(dials));
  await document.fonts.ready;
  await Promise.all([...document.images].map((img) => img.decode().catch(() => undefined)));
  await frames(2);
  document.documentElement.dataset.exportReady = '1';
}

/** The width the board has to draw in, and a height that keeps one artboard on screen. */
function useRoom() {
  const ref = useRef<HTMLDivElement>(null);
  const [room, setRoom] = useState({ width: 1e5, height: 1e5 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || exporting) return;
    const measure = () => setRoom({ width: el.clientWidth, height: Math.min(innerHeight * 0.6, 640) });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  return { ref, room };
}

const NO_VIEW: readonly never[] = [];

type BoardProps = { title: string; lede?: ReactNode; children: ReactNode };

/**
 * The canvas brand collateral sits on: every artboard side by side, scaled to
 * fit, with its format and size under it. Under `design-hub export` it is
 * the artboards alone, at their real size.
 */
export function Board({ title, lede, children }: BoardProps) {
  const view = useDials(
    'Board',
    {
      // How a person looks at the boards, not the design: a Client's from the start. They are a board's only viewing tools.
      zoom: client({ type: 'select', options: ZOOMS, default: 'fit' }),
      guides: client(true),
    },
    {
      hints: {
        zoom: 'How large the artboards draw on screen. Export always writes them at their real size.',
        guides: "Shade the bands a platform's own interface covers, where type and logos never go.",
      },
    },
  );
  const { ref, room } = useRoom();

  useEffect(() => {
    if (exporting) void settleForExport();
  }, []);

  // Collateral has one look: light, or the one ?theme= names, which is what export writes.
  // A person's own dark theme never recolours a piece that ships light.
  useEffect(() => {
    pinAppearance(urlAppearance() ?? 'light');
    return () => pinAppearance(null);
  }, []);

  if (exporting)
    return (
      <BoardView.Provider value={{ zoom: '100%', guides: false, room }}>
        <div className="board-export">{children}</div>
      </BoardView.Provider>
    );

  return (
    <BoardView.Provider value={{ zoom: view.zoom as string, guides: view.guides as boolean, room }}>
      <main className="board">
        <header className="board-head">
          <h1 className="board-title">{title}</h1>
          {lede ? <p className="board-lede">{lede}</p> : null}
        </header>
        {/* No View panel on a board: a still file has no motion to slow and no theme to flip. */}
        <ViewScope.Provider value={NO_VIEW}>
          <div className="board-grid" ref={ref}>
            {children}
          </div>
        </ViewScope.Provider>
      </main>
    </BoardView.Provider>
  );
}

type ArtboardProps = {
  format: FormatName;
  /** Names the file on export (`<slug>-<name>.png`) and labels it on screen. */
  name?: string;
  children: ReactNode;
};

/**
 * One piece of collateral at its real pixel size: type, spacing and images
 * are drawn at the values that ship. On screen it scales with the Board's
 * zoom; the content never knows.
 */
/** The bands a platform's own interface covers, shaded on screen, never exported. */
function SafeBands({ format }: { format: FormatName }) {
  const f: Format = FORMATS[format];
  if (!f.safe) return null;
  return (
    <>
      <div className="artboard-safe" style={{ top: 0, height: f.safe.top }} aria-hidden="true" />
      <div className="artboard-safe" style={{ bottom: 0, height: f.safe.bottom }} aria-hidden="true" />
    </>
  );
}

export function Artboard({ format, name, children }: ArtboardProps) {
  const { zoom, guides, room } = useContext(BoardView);
  const f = FORMATS[format];
  const scale = exporting ? 1 : zoomFor(zoom, format, room);
  const frame = (
    <div
      className="artboard"
      data-artboard=""
      data-format={format}
      data-name={name ?? ''}
      data-output={f.output}
      style={{ width: f.width, height: f.height, zoom: scale }}
    >
      {children}
      {guides ? <SafeBands format={format} /> : null}
    </div>
  );
  if (exporting) return frame;
  return (
    <figure className="artboard-slot">
      {frame}
      <figcaption className="artboard-label">
        <span>{name ?? f.label}</span>
        <span className="tabular">
          {f.label} · {sizeLabel(format)}
        </span>
      </figcaption>
    </figure>
  );
}
