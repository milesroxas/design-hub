import { type ComponentType, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import './harness.css';

type Props = {
  options: Record<string, ComponentType>;
  replay?: boolean;
  onReplay?: () => void;
  position?: 'bottom' | 'top';
};

const POPUPS = '[role="menu"], [role="listbox"], [role="dialog"]';
const OWNS_KEYS = `input, textarea, select, [contenteditable=""], [contenteditable="true"], ${POPUPS}`;
const HARNESS = '.dialkit-root, [data-harness]';

const popupOpen = () =>
  [...document.querySelectorAll(POPUPS)].some((el) => !el.closest(HARNESS) && el.getClientRects().length > 0);

function initialIndex(count: number) {
  const v = Number(new URLSearchParams(location.search).get('v'));
  return Number.isInteger(v) && v >= 1 && v <= count ? v - 1 : 0;
}

const modified = (e: KeyboardEvent) => e.metaKey || e.ctrlKey || e.altKey || e.shiftKey;

/** A bare key the page has not handled, outside any control or popup that owns keys. */
const pickerOwns = (e: KeyboardEvent) =>
  !modified(e) && !e.defaultPrevented && !(e.target as Element | null)?.closest?.(OWNS_KEYS) && !popupOpen();

/** What a key does: 1 to N picks a variant, arrows step and wrap, R replays. */
function keyTarget(key: string, index: number, count: number): number | 'again' | null {
  const n = Number.parseInt(key, 10);
  if (n >= 1 && n <= count) return n - 1;
  if (key === 'ArrowRight') return (index + 1) % count;
  if (key === 'ArrowLeft') return (index - 1 + count) % count;
  return key.toLowerCase() === 'r' ? 'again' : null;
}

export function Variants({ options, replay = true, onReplay, position = 'bottom' }: Props) {
  const names = Object.keys(options);
  const [index, setIndex] = useState(() => initialIndex(names.length));
  const [take, setTake] = useState(0);
  const [ready, setReady] = useState(false);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const highlight = useRef<HTMLSpanElement>(null);

  const select = useCallback(
    (i: number) => {
      if (i < 0 || i >= names.length) return;
      setIndex(i);
      const url = new URL(location.href);
      url.searchParams.set('v', String(i + 1));
      history.replaceState(history.state, '', url);
    },
    [names.length],
  );

  const again = useCallback(() => (onReplay ? onReplay() : setTake((t) => t + 1)), [onReplay]);

  useLayoutEffect(() => {
    const move = () => {
      const el = items.current[index];
      if (!el || !highlight.current) return;
      highlight.current.style.width = `${el.offsetWidth}px`;
      highlight.current.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    move();
    addEventListener('resize', move);
    return () => removeEventListener('resize', move);
  }, [index]);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!pickerOwns(e)) return;
      const next = keyTarget(e.key, index, names.length);
      if (next === 'again') again();
      else if (next !== null) select(next);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, names.length, select, again]);

  const Current = options[names[index]];

  return (
    <>
      <Current key={`${index}:${take}`} />
      {createPortal(
        <nav
          className="proto-picker"
          aria-label="Prototype variants"
          data-ready={ready ? '' : undefined}
          data-position={position === 'top' ? 'top' : undefined}
        >
          <span ref={highlight} className="proto-picker-highlight" aria-hidden="true" />
          {names.map((name, i) => (
            <button
              key={name}
              ref={(el) => {
                items.current[i] = el;
              }}
              type="button"
              className="proto-picker-item"
              data-active={i === index ? '' : undefined}
              aria-current={i === index ? 'true' : undefined}
              onClick={() => select(i)}
            >
              {name}
            </button>
          ))}
          {replay && (
            <>
              <span className="proto-picker-divider" aria-hidden="true" />
              <button
                type="button"
                className="proto-picker-item proto-picker-replay"
                aria-label="Replay animation (R)"
                onClick={again}
              >
                ↻
              </button>
            </>
          )}
        </nav>,
        document.body,
      )}
    </>
  );
}
