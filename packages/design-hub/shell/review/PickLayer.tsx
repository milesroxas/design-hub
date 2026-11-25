// Comment mode's hold on the page. No surface goes over it: a click or tap
// on the page is caught at the document before the page sees it, so the page
// and every panel in it still scroll natively, by wheel or by finger. A mouse
// gets an outline on the element under it; a keyboard comments on the focused
// element with Enter.
import { useEffect, useRef } from 'react';
import { isHarness } from './anchor';
import { nearest } from './place';
import type { Draft } from './view';

/** How close, in px, a click must land to a pin's edge to open it rather than start a new comment. */
const PIN_REACH = 16;

/** The pin a point lands on or near, by its thread id. */
function pinAt(x: number, y: number): HTMLElement | null {
  const pins = [...document.querySelectorAll<HTMLElement>('.rv-pin[data-pin]:not([hidden])')].map((el) => {
    const r = el.getBoundingClientRect();
    return { el, left: r.left, top: r.top, right: r.right, bottom: r.bottom };
  });
  return nearest(x, y, pins, PIN_REACH)?.el ?? null;
}

/** Marks the pin a mouse is near, so it lifts and the cursor says a click opens it. */
function markNear(pin: HTMLElement | null) {
  for (const el of document.querySelectorAll('.rv-pin[data-near]'))
    if (el !== pin) delete (el as HTMLElement).dataset.near;
  if (pin) pin.dataset.near = '';
  if (pin) document.documentElement.dataset.rvNear = '';
  else delete document.documentElement.dataset.rvNear;
}

const isPage = (t: EventTarget | null): t is Element =>
  t instanceof Element && !isHarness(t) && t !== document.body && t !== document.documentElement;

function outline(box: HTMLElement | null, el: Element | null) {
  if (!box) return;
  box.hidden = !el;
  if (!el) return;
  const r = el.getBoundingClientRect();
  box.style.transform = `translate(${r.left}px, ${r.top}px)`;
  box.style.width = `${r.width}px`;
  box.style.height = `${r.height}px`;
}

const fraction = (v: number, size: number) => (size ? Math.min(1, Math.max(0, v / size)) : 0.5);

/** Where on the element the click landed; the middle for a keyboard click, which has no point. */
function offsetOf(el: Element, e: MouseEvent) {
  if (e.detail === 0) return { x: 0.5, y: 0.5 };
  const r = el.getBoundingClientRect();
  return { x: fraction(e.clientX - r.left, r.width), y: fraction(e.clientY - r.top, r.height) };
}

/** Where a draft's marker sits now, in viewport pixels, or null for the whole page. */
export function draftPoint(d: Draft): { x: number; y: number } | null {
  if (!d.target || !d.offset || !d.target.isConnected) return null;
  const r = d.target.getBoundingClientRect();
  return { x: r.left + r.width * d.offset.x, y: r.top + r.height * d.offset.y };
}

/** What a comment is about, in words: the element's label or its first words. */
export const describe = (el: Element | null) => {
  if (!el) return 'the whole page';
  // biome-ignore lint/performance/useDomNodeTextContent: innerText keeps the spaces between a row's parts; textContent runs them together
  const text = (el.getAttribute('aria-label') || (el as HTMLElement).innerText || el.textContent || '')
    .trim()
    .replace(/\s+/g, ' ');
  return text ? `“${text.length > 40 ? `${text.slice(0, 40)}…` : text}”` : `a ${el.localName} element`;
};

export function PickLayer({
  onPick,
  onOpen,
}: {
  onPick: (draft: Draft) => void;
  onOpen: (id: string) => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pick = useRef(onPick);
  pick.current = onPick;
  const open = useRef(onOpen);
  open.current = onOpen;

  useEffect(() => {
    const root = document.documentElement;
    root.dataset.rvCommenting = '';
    // Pressing the page must not press its controls: a menu that opens on pointerdown stays shut.
    const hold = (e: Event) => {
      if (!isPage(e.target)) return;
      e.stopPropagation();
      if (e.type !== 'pointerdown') e.preventDefault();
    };
    const onClick = (e: MouseEvent) => {
      const t = e.target;
      if (!(t instanceof Element) || isHarness(t)) return;
      // A click near a pin opens it, wherever the press began or ended: a near miss is not a new comment.
      const pin = e.detail ? pinAt(e.clientX, e.clientY) : null;
      if (!pin && !isPage(t)) return;
      e.preventDefault();
      e.stopPropagation();
      outline(box.current, null);
      if (pin?.dataset.pin) open.current(pin.dataset.pin);
      else if (isPage(t)) pick.current({ target: t, offset: offsetOf(t, e) });
    };
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const pin = pinAt(e.clientX, e.clientY);
      markNear(pin);
      outline(box.current, !pin && isPage(e.target) ? e.target : null);
    };
    const onScroll = () => outline(box.current, null);
    const opts = { capture: true };
    document.addEventListener('pointerdown', hold, opts);
    document.addEventListener('mousedown', hold, opts);
    document.addEventListener('click', onClick, opts);
    document.addEventListener('pointermove', onMove, { capture: true, passive: true });
    addEventListener('scroll', onScroll, { capture: true, passive: true });
    return () => {
      delete root.dataset.rvCommenting;
      markNear(null);
      document.removeEventListener('pointerdown', hold, opts);
      document.removeEventListener('mousedown', hold, opts);
      document.removeEventListener('click', onClick, opts);
      document.removeEventListener('pointermove', onMove, opts);
      removeEventListener('scroll', onScroll, opts);
    };
  }, []);

  return <div ref={box} className="rv-pick-box" hidden />;
}
