// The way into the review layer: one round button that turns comment mode on
// and off. Drag it anywhere and it glides to the nearest of six spots on the
// screen's edge (snap.ts); Alt and an arrow move it by keyboard. Hidden, it
// tucks into its edge and leaves a tab that brings it back.
import { Icon } from '@kit/Icon';
import { type KeyboardEvent, type PointerEvent, useEffect, useLayoutEffect, useRef } from 'react';
import { nearestSpot, type Spot, stepSpot } from './snap';

const SIZE = 40;
const GAP = 16;
/** Pointer travel before a press becomes a drag, so a slightly moving click still clicks. */
const SLOP = 6;
/** A drag shorter than this that lands back on its own spot was a click with a wobble: it still toggles. */
const WOBBLE = 24;

type Sample = { x: number; y: number; t: number };

type Props = {
  hidden: boolean;
  commenting: boolean;
  openCount: number;
  spot: Spot;
  onSpot: (spot: Spot) => void;
  onToggle: () => void;
  onShow: () => void;
};

/** Plays the move from where the button was to where it now rests: the new spot is already laid out, the transform runs it back. */
function glide(el: HTMLElement, from: DOMRect) {
  el.style.transition = 'none';
  el.style.transform = '';
  const to = el.getBoundingClientRect();
  el.style.transform = `translate(${from.left - to.left}px, ${from.top - to.top}px)`;
  el.getBoundingClientRect();
  el.style.transition = '';
  el.style.transform = '';
}

function velocity(samples: Sample[]) {
  const a = samples[0];
  const b = samples.at(-1) ?? a;
  const dt = Math.max(1, b.t - a.t);
  return { x: (b.x - a.x) / dt, y: (b.y - a.y) / dt };
}

function useDrag(spot: Spot, onSpot: (s: Spot) => void) {
  const ref = useRef<HTMLButtonElement>(null);
  const press = useRef<{ id: number; x: number; y: number; moved: boolean; samples: Sample[] } | null>(null);
  const dragged = useRef(false);
  const from = useRef<DOMRect | null>(null);

  // biome-ignore lint/correctness/useExhaustiveDependencies: runs when the spot changes, to play the move into it
  useLayoutEffect(() => {
    if (ref.current && from.current) glide(ref.current, from.current);
    from.current = null;
  }, [spot]);

  const settle = (next: Spot) => {
    const el = ref.current;
    if (!el) return;
    if (next === spot) glide(el, el.getBoundingClientRect());
    else {
      from.current = el.getBoundingClientRect();
      onSpot(next);
    }
  };

  const handlers = {
    onPointerDown(e: PointerEvent<HTMLButtonElement>) {
      if (e.button !== 0 || !e.isPrimary) return;
      dragged.current = false;
      press.current = { id: e.pointerId, x: e.clientX, y: e.clientY, moved: false, samples: [] };
      // Captured from the press, so a quick first move that leaves the 40px button is still this drag.
      e.currentTarget.setPointerCapture(e.pointerId);
    },
    onPointerMove(e: PointerEvent<HTMLButtonElement>) {
      const p = press.current;
      const el = ref.current;
      if (!p || !el || e.pointerId !== p.id) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      if (!p.moved) {
        if (Math.hypot(dx, dy) < SLOP) return;
        p.moved = true;
        el.dataset.dragging = '';
      }
      el.style.transform = `translate(${dx}px, ${dy}px)`;
      p.samples = [...p.samples, { x: e.clientX, y: e.clientY, t: e.timeStamp }].filter(
        (s) => e.timeStamp - s.t < 100,
      );
    },
    onPointerUp(e: PointerEvent<HTMLButtonElement>) {
      const p = press.current;
      const el = ref.current;
      press.current = null;
      if (!p?.moved || !el) return;
      delete el.dataset.dragging;
      const r = el.getBoundingClientRect();
      const centre = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      const next = nearestSpot(
        centre,
        velocity(p.samples),
        { width: innerWidth, height: innerHeight },
        SIZE,
        GAP,
      );
      dragged.current = next !== spot || Math.hypot(e.clientX - p.x, e.clientY - p.y) >= WOBBLE;
      settle(next);
    },
    onPointerCancel() {
      press.current = null;
      if (!ref.current) return;
      delete ref.current.dataset.dragging;
      glide(ref.current, ref.current.getBoundingClientRect());
    },
    onKeyDown(e: KeyboardEvent<HTMLButtonElement>) {
      if (!e.altKey || !e.key.startsWith('Arrow')) return;
      e.preventDefault();
      settle(stepSpot(spot, e.key));
    },
  };
  // A drag ends in a click on the same button; it moved the button, so it must not also toggle comment mode.
  const swallowClick = () => {
    const was = dragged.current;
    dragged.current = false;
    return was;
  };
  return { ref, handlers, swallowClick };
}

export function Launcher({ hidden, commenting, openCount, spot, onSpot, onToggle, onShow }: Props) {
  const { ref, handlers, swallowClick } = useDrag(spot, onSpot);
  const tab = useRef<HTMLButtonElement>(null);
  const was = useRef(hidden);
  // Hiding and showing hand focus across, so a keyboard never loses its place.
  useEffect(() => {
    if (was.current !== hidden) (hidden ? tab : ref).current?.focus();
    was.current = hidden;
  }, [hidden, ref]);

  const label = commenting ? 'Stop commenting' : 'Comment on this page';
  return (
    <>
      <button
        ref={ref}
        type="button"
        className="rv-launch"
        data-spot={spot}
        data-away={hidden ? '' : undefined}
        inert={hidden}
        aria-label={openCount > 0 ? `${label}, ${openCount} open` : label}
        aria-pressed={commenting}
        aria-keyshortcuts="Alt+ArrowLeft Alt+ArrowRight Alt+ArrowUp Alt+ArrowDown"
        title={`${label}. Drag to move.`}
        onClick={() => swallowClick() || onToggle()}
        {...handlers}
      >
        <Icon name="message-text-square-01" size={18} />
        {openCount > 0 && (
          <span className="rv-count" aria-hidden="true">
            {openCount > 99 ? '99+' : openCount}
          </span>
        )}
      </button>
      <button
        ref={tab}
        type="button"
        className="rv-tab"
        data-spot={spot}
        data-away={hidden ? undefined : ''}
        inert={!hidden}
        aria-label="Show comments"
        title="Show comments"
        onClick={onShow}
      >
        <Icon name="message-text-square-01" size={16} />
      </button>
    </>
  );
}
