// Where the one card sits: beside its pin, or beside the Comments button when
// it has no pin. Pure, so node:test runs it; Card.tsx measures and applies it.

const CARD_WIDTH = 320;
const EDGE = 16;
const AWAY = 12;
const PIN_GAP = 20;

type Point = { x: number; y: number };
type Rect = { left: number; top: number; right: number; bottom: number };
type Viewport = { width: number; height: number };
export type Placement = { left: number; top: number; origin: string };

const clampTop = (top: number, h: number, vp: Viewport) =>
  Math.min(Math.max(EDGE, top), vp.height - h - EDGE);

/** Beside a pin: to its right when that fits, else to its left; level with it, kept on screen. */
export function besidePoint(at: Point, h: number, vp: Viewport): Placement {
  const right = at.x + PIN_GAP + CARD_WIDTH < vp.width - EDGE;
  return {
    left: right ? at.x + PIN_GAP : Math.max(EDGE, at.x - PIN_GAP - CARD_WIDTH),
    top: clampTop(at.y - 28, h, vp),
    origin: `${right ? 'left' : 'right'} top`,
  };
}

/** Beside the button resting mid-edge: to its inner side, centred on it. */
function besideMiddle(b: Rect, onRight: boolean, h: number, vp: Viewport): Placement {
  return {
    left: onRight ? b.left - AWAY - CARD_WIDTH : b.right + AWAY,
    top: clampTop((b.top + b.bottom) / 2 - h / 2, h, vp),
    origin: onRight ? 'right center' : 'left center',
  };
}

/** Beside the button at a corner: above it at the bottom, below it at the top, its outer edge lined up with the button's. */
function besideCorner(b: Rect, onRight: boolean, h: number, vp: Viewport): Placement {
  const below = (b.top + b.bottom) / 2 < vp.height / 2;
  return {
    left: onRight ? Math.max(EDGE, b.right - CARD_WIDTH) : b.left,
    top: clampTop(below ? b.bottom + AWAY : b.top - AWAY - h, h, vp),
    origin: `${below ? 'top' : 'bottom'} ${onRight ? 'right' : 'left'}`,
  };
}

export function besideButton(b: Rect, h: number, vp: Viewport): Placement {
  const onRight = (b.left + b.right) / 2 > vp.width / 2;
  const cy = (b.top + b.bottom) / 2;
  const middle = cy > vp.height * 0.25 && cy < vp.height * 0.75;
  return middle ? besideMiddle(b, onRight, h, vp) : besideCorner(b, onRight, h, vp);
}

/** How far a dragged sheet moves for a finger `dy` from where it started: freely down, and only a little up, against resistance. */
export const dragOffset = (dy: number) => (dy >= 0 ? dy : -Math.sqrt(-dy) * 2);

/** A sheet let go this far down, or flicked down this fast (px per ms), leaves; anything less settles back. */
export const shouldDismiss = (dy: number, velocity: number) => dy > 96 || (dy > 12 && velocity > 0.5);

/** How far a point lies outside a box; 0 inside it. */
export function distanceToRect(x: number, y: number, r: Rect): number {
  const dx = Math.max(r.left - x, 0, x - r.right);
  const dy = Math.max(r.top - y, 0, y - r.bottom);
  return Math.hypot(dx, dy);
}

/** The box a click near enough to counts as on, of those within `reach`: the closest. */
export function nearest<T extends Rect>(x: number, y: number, boxes: T[], reach: number): T | null {
  let best: T | null = null;
  let bestDistance = reach;
  for (const box of boxes) {
    const d = distanceToRect(x, y, box);
    if (d <= bestDistance) {
      best = box;
      bestDistance = d;
    }
  }
  return best;
}
