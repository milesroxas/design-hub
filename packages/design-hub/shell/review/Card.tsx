// The one card on screen: beside its pin when it has one, beside the
// Comments button when it does not. It flips and clamps to stay in view and
// follows the page as it scrolls.
import { Button } from '@kit/ui';
import { type CSSProperties, type ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { besideButton, besidePoint, type Placement } from './place';
import { useKeyboardInset, useNarrow, useRevealPin, useSheetDrag } from './sheet';

const toStyle = (p: Placement): CSSProperties => ({ left: p.left, top: p.top, transformOrigin: p.origin });

function place(at: { x: number; y: number } | null, h: number): CSSProperties {
  const vp = { width: innerWidth, height: innerHeight };
  if (at) return toStyle(besidePoint(at, h, vp));
  const b = document.querySelector('.rv-launch')?.getBoundingClientRect();
  return b ? toStyle(besideButton(b, h, vp)) : { right: 16, bottom: 72 };
}

/** Re-renders once a frame on scroll and resize, so a card beside a pin moves with it. */
function useFollow() {
  const [, tick] = useState(0);
  useEffect(() => {
    let frame = 0;
    const on = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        tick((n) => n + 1);
      });
    };
    addEventListener('scroll', on, { capture: true, passive: true });
    addEventListener('resize', on);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', on, { capture: true });
      removeEventListener('resize', on);
    };
  }, []);
}

export function Card({
  at,
  label,
  resolved,
  onDismiss,
  children,
}: {
  at: { x: number; y: number } | null;
  label: string;
  resolved?: boolean;
  /** Dragging the sheet down on a phone calls this. */
  onDismiss?: () => void;
  children: ReactNode;
}) {
  useFollow();
  const ref = useRef<HTMLElement>(null);
  const narrow = useNarrow();
  const drag = useSheetDrag(ref, narrow, onDismiss);
  useKeyboardInset(ref, narrow);
  useRevealPin(ref, at, narrow);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setH(el.offsetHeight));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // A card that closes with focus inside hands it to the button, never to <body>.
  useEffect(() => {
    const el = ref.current;
    return () => {
      if (!el?.contains(document.activeElement)) return;
      requestAnimationFrame(() => {
        if (document.activeElement === document.body)
          document.querySelector<HTMLElement>('.rv-launch')?.focus();
      });
    };
  }, []);
  return (
    <section
      ref={ref}
      className="rv-card"
      aria-label={label}
      data-resolved={resolved ? '' : undefined}
      data-sheet={narrow ? '' : undefined}
      style={narrow ? undefined : place(at, h)}
      {...drag}
    >
      {narrow && <span className="rv-grab" aria-hidden="true" />}
      {children}
    </section>
  );
}

/** A quiet text action in a row of them: Edit, Keep, Delete. */
export function Action({ label, danger, onClick }: { label: string; danger?: boolean; onClick: () => void }) {
  return (
    <Button
      kind="tertiary"
      size={null}
      className={danger ? 'rv-act rv-act-danger' : 'rv-act'}
      label={label}
      onClick={onClick}
    />
  );
}
