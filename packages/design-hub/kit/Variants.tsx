import { type ComponentType, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { clientVariants } from '../core/controls.ts';
import { markControl, useControls } from './audience';
import './harness.css';

type Props = {
  options: Record<string, ComponentType>;
  replay?: boolean;
  onReplay?: () => void;
  position?: 'bottom' | 'top';
};

const POPUPS = '[role="menu"], [role="listbox"], [role="dialog"]';
const OWNS_KEYS = `input, textarea, select, [contenteditable=""], [contenteditable="true"], ${POPUPS}`;
const HARNESS = '.dialkit-root, [data-harness], [data-lapse-panel]';

const popupOpen = () =>
  [...document.querySelectorAll(POPUPS)].some((el) => !el.closest(HARNESS) && el.getClientRects().length > 0);

/** `?v=N` counts the prototype's own variants, so a link names the same one for Studio and a Client. */
function initialName(names: string[]) {
  const v = Number(new URLSearchParams(location.search).get('v'));
  return names[Number.isInteger(v) && v >= 1 && v <= names.length ? v - 1 : 0];
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

/**
 * The variants the person looking gets (core/controls.ts). Studio gets every
 * one. A Client gets the ones Studio marked, or the first when none is; with
 * one, there is no picker.
 */
function useShown(names: string[]) {
  const { studio, canMark, marks } = useControls();
  const theirs = clientVariants(names, marks);
  return {
    shown: studio ? names : theirs,
    theirs,
    /** The ones Studio marked itself: the first variant is a Client's without a mark when none is. */
    marked: marks.variants,
    canMark,
    picker: studio || theirs.length > 1,
  };
}

const EYE =
  'M2.4 12.7a1.2 1.2 0 0 1 0-1.4C3.5 9.6 6.7 5 12 5s8.5 4.6 9.6 6.3a1.2 1.2 0 0 1 0 1.4C20.5 14.4 17.3 19 12 19s-8.5-4.6-9.6-6.3Z';

const Eye = () => (
  <svg
    width="16"
    height="16"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={EYE} />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

type PickerProps = {
  shown: string[];
  /** The open variant's place in `shown`, or -1 while Studio is marking. */
  active: number;
  /** What a Client gets, dotted in Studio's picker. Empty where nobody marks. */
  theirs: string[];
  position: 'bottom' | 'top';
  choosing: boolean;
  onPick: (name: string) => void;
  onReplay?: () => void;
  /** Studio's eye: turns marking on and off. Absent for a Client. */
  onChoose?: () => void;
};

function Picker({ shown, active, theirs, position, choosing, onPick, onReplay, onChoose }: PickerProps) {
  const [ready, setReady] = useState(false);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const highlight = useRef<HTMLSpanElement>(null);
  const count = shown.length;

  // biome-ignore lint/correctness/useExhaustiveDependencies: the dots change each item's width
  useLayoutEffect(() => {
    const move = () => {
      const el = items.current[active];
      if (!el || !highlight.current) return;
      highlight.current.style.width = `${el.offsetWidth}px`;
      highlight.current.style.transform = `translateX(${el.offsetLeft}px)`;
    };
    move();
    addEventListener('resize', move);
    return () => removeEventListener('resize', move);
  }, [active, count, theirs.length]);

  useEffect(() => {
    const id = requestAnimationFrame(() => requestAnimationFrame(() => setReady(true)));
    return () => cancelAnimationFrame(id);
  }, []);

  return (
    <>
      {choosing ? (
        <p className="proto-picker-note" data-position={position === 'top' ? 'top' : undefined} role="status">
          Pick what a client can flip between
        </p>
      ) : null}
      <nav
        className="proto-picker"
        aria-label="Prototype variants"
        data-ready={ready ? '' : undefined}
        data-position={position === 'top' ? 'top' : undefined}
      >
        <span ref={highlight} className="proto-picker-highlight" aria-hidden="true" hidden={active < 0} />
        {shown.map((name, i) => (
          <button
            key={name}
            ref={(el) => {
              items.current[i] = el;
            }}
            type="button"
            className="proto-picker-item"
            data-active={i === active ? '' : undefined}
            data-theirs={theirs.includes(name) ? '' : undefined}
            aria-current={i === active ? 'true' : undefined}
            aria-pressed={choosing ? theirs.includes(name) : undefined}
            title={onChoose && theirs.includes(name) ? 'A client gets this one' : undefined}
            onClick={() => onPick(name)}
          >
            {onChoose ? <span className="proto-picker-dot" aria-hidden="true" /> : null}
            {name}
          </button>
        ))}
        <Tools choosing={choosing} onReplay={onReplay} onChoose={onChoose} />
      </nav>
    </>
  );
}

function Tools({ choosing, onReplay, onChoose }: Pick<PickerProps, 'choosing' | 'onReplay' | 'onChoose'>) {
  if (!onReplay && !onChoose) return null;
  return (
    <>
      <span className="proto-picker-divider" aria-hidden="true" />
      {onReplay ? (
        <button
          type="button"
          className="proto-picker-item proto-picker-replay"
          aria-label="Replay animation (R)"
          onClick={onReplay}
        >
          ↻
        </button>
      ) : null}
      {onChoose ? (
        <button
          type="button"
          className="proto-picker-item proto-picker-choose"
          aria-pressed={choosing}
          aria-label="Choose what a client gets"
          title="Choose what a client gets"
          onClick={onChoose}
        >
          {choosing ? 'Done' : <Eye />}
        </button>
      ) : null}
    </>
  );
}

/** The open variant, kept in `?v=N`, and the way to open another. */
function usePicked(names: string[]) {
  const [picked, setPicked] = useState(() => initialName(names));
  const key = names.join('\n');
  const select = useCallback(
    (next: string | undefined) => {
      if (next === undefined) return;
      setPicked(next);
      const url = new URL(location.href);
      url.searchParams.set('v', String(key.split('\n').indexOf(next) + 1));
      history.replaceState(history.state, '', url);
    },
    [key],
  );
  return { picked, select };
}

/** 1 to N, the arrows and R, over the variants the person looking has. */
function usePickerKeys(shown: string[], index: number, select: (name: string) => void, again: () => void) {
  const shownKey = shown.join('\n');
  useEffect(() => {
    const list = shownKey.split('\n');
    const onKey = (e: KeyboardEvent) => {
      if (!pickerOwns(e)) return;
      const next = keyTarget(e.key, index, list.length);
      if (next === 'again') again();
      else if (next !== null) select(list[next]);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [index, shownKey, select, again]);
}

/** Studio's second state of the picker: a click marks a variant instead of opening it. */
function useMarking(canMark: boolean, marked: string[]) {
  const [marking, setMarking] = useState(false);
  return {
    choosing: marking && canMark,
    onChoose: canMark ? () => setMarking((m) => !m) : undefined,
    mark: (n: string) => void markControl('variant', n, marked.includes(n) ? 'internal' : 'client'),
  };
}

export function Variants({ options, replay = true, onReplay, position = 'bottom' }: Props) {
  const names = Object.keys(options);
  const { shown, theirs, marked, canMark, picker } = useShown(names);
  const { picked, select } = usePicked(names);
  const [take, setTake] = useState(0);
  const { choosing, onChoose, mark } = useMarking(canMark, marked);
  const name = shown.includes(picked) ? picked : shown[0];
  const index = shown.indexOf(name);
  const again = useCallback(() => (onReplay ? onReplay() : setTake((t) => t + 1)), [onReplay]);
  usePickerKeys(shown, index, select, again);

  const Current = options[name];
  const bar = (
    <Picker
      shown={shown}
      active={choosing ? -1 : index}
      theirs={onChoose ? theirs : []}
      position={position}
      choosing={choosing}
      onPick={choosing ? mark : select}
      onReplay={replay ? again : undefined}
      onChoose={onChoose}
    />
  );

  return (
    <>
      {Current ? <Current key={`${name}:${take}`} /> : null}
      {picker ? createPortal(bar, document.body) : null}
    </>
  );
}
