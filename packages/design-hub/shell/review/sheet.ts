// On a phone the card is a bottom sheet: docked to the edge, lifted over the
// iOS keyboard, dragged down by its head to dismiss. These hooks are that
// behaviour; Card.tsx applies them only while the screen is narrow.
import { type PointerEvent, type RefObject, useEffect, useRef, useSyncExternalStore } from 'react';
import { dragOffset, shouldDismiss } from './place';

/** Narrow enough for the sheet; the same line as review.css. Layout, so width is the right test. */
const NARROW = '(max-width: 560px)';

const subscribeNarrow = (fn: () => void) => {
  const q = matchMedia(NARROW);
  q.addEventListener('change', fn);
  return () => q.removeEventListener('change', fn);
};
export const useNarrow = () => useSyncExternalStore(subscribeNarrow, () => matchMedia(NARROW).matches);

/**
 * iOS never resizes the layout viewport for the keyboard, only the visual one,
 * so a sheet fixed to the bottom ends up behind the keys. This writes how far
 * the keyboard reaches up (--rv-kb) and how tall the visible area is (--rv-vh)
 * onto the sheet. Android resizes the layout itself (interactive-widget in
 * index.html), where the keyboard reach comes out as 0.
 */
export function useKeyboardInset(ref: RefObject<HTMLElement | null>, active: boolean) {
  useEffect(() => {
    const vv = visualViewport;
    const el = ref.current;
    if (!active || !vv || !el) return;
    const sync = () => {
      el.style.setProperty('--rv-kb', `${Math.max(0, innerHeight - vv.height - vv.offsetTop)}px`);
      el.style.setProperty('--rv-vh', `${vv.height}px`);
    };
    sync();
    vv.addEventListener('resize', sync);
    vv.addEventListener('scroll', sync);
    return () => {
      vv.removeEventListener('resize', sync);
      vv.removeEventListener('scroll', sync);
    };
  }, [ref, active]);
}

/** Drag the sheet down by its head; let go past the line, or with a flick, and it leaves. */
export function useSheetDrag(ref: RefObject<HTMLElement | null>, active: boolean, onDismiss?: () => void) {
  const drag = useRef<{ id: number; y: number; t: number; last: number; lastT: number } | null>(null);

  const release = (el: HTMLElement, dy: number, velocity: number) => {
    delete el.dataset.dragging;
    if (onDismiss && shouldDismiss(dy, velocity)) {
      el.dataset.leaving = '';
      el.style.transform = 'translateY(100%)';
      setTimeout(onDismiss, 200);
    } else el.style.transform = '';
  };

  return {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      const el = ref.current;
      if (!active || !onDismiss || !el || !(e.target as Element).closest('.rv-card-head, .rv-grab')) return;
      if ((e.target as Element).closest('button')) return;
      drag.current = { id: e.pointerId, y: e.clientY, t: e.timeStamp, last: e.clientY, lastT: e.timeStamp };
      e.currentTarget.setPointerCapture(e.pointerId);
      el.dataset.dragging = '';
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      const el = ref.current;
      if (!d || !el || e.pointerId !== d.id) return;
      el.style.transform = `translateY(${dragOffset(e.clientY - d.y)}px)`;
      d.last = e.clientY;
      d.lastT = e.timeStamp;
    },
    onPointerUp(e: PointerEvent<HTMLElement>) {
      const d = drag.current;
      const el = ref.current;
      drag.current = null;
      if (!d || !el) return;
      const dy = e.clientY - d.y;
      release(el, dy, dy / Math.max(1, e.timeStamp - d.t));
    },
    onPointerCancel() {
      const el = ref.current;
      drag.current = null;
      if (el) release(el, 0, 0);
    },
  };
}

/** On a phone, a pin the sheet would cover scrolls up into the space above it. */
export function useRevealPin(
  ref: RefObject<HTMLElement | null>,
  at: { x: number; y: number } | null,
  active: boolean,
) {
  const y = at?.y ?? null;
  // biome-ignore lint/correctness/useExhaustiveDependencies: once per card, when it opens; following the pin after that is the page's scroll
  useEffect(() => {
    const el = ref.current;
    if (!active || y === null || !el) return;
    const top = el.getBoundingClientRect().top;
    if (y > 48 && y < top - 32) return;
    scrollBy({
      top: y - top * 0.4,
      behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
  }, [active]);
}
