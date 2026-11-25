// Where the Comments button rests: one of six spots on the screen's edge,
// and which one a drag lands in. Pure, so node:test runs it.

export const SPOTS = ['top-left', 'top-right', 'left', 'right', 'bottom-left', 'bottom-right'] as const;
export type Spot = (typeof SPOTS)[number];
export const DEFAULT_SPOT: Spot = 'bottom-right';

type Point = { x: number; y: number };
type Size = { width: number; height: number };

/** How far ahead a release is projected along its velocity, in ms: a flick carries the button, a slow drop does not. */
const PROJECT_MS = 120;

export const isSpot = (value: unknown): value is Spot => SPOTS.includes(value as Spot);

/** The centre of the button resting at a spot, for a button `size` wide, `gap` in from the edges. */
export function centreOf(spot: Spot, viewport: Size, size: number, gap: number): Point {
  const half = size / 2;
  const x = spot.endsWith('left') ? gap + half : viewport.width - gap - half;
  const y = spot.startsWith('top')
    ? gap + half
    : spot.startsWith('bottom')
      ? viewport.height - gap - half
      : viewport.height / 2;
  return { x, y };
}

/** The spot nearest where the button would come to rest: its centre at release, carried a little along its velocity (px per ms). */
export function nearestSpot(at: Point, velocity: Point, viewport: Size, size: number, gap: number): Spot {
  const land = { x: at.x + velocity.x * PROJECT_MS, y: at.y + velocity.y * PROJECT_MS };
  let best: Spot = DEFAULT_SPOT;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const spot of SPOTS) {
    const c = centreOf(spot, viewport, size, gap);
    const distance = Math.hypot(c.x - land.x, c.y - land.y);
    if (distance < bestDistance) {
      best = spot;
      bestDistance = distance;
    }
  }
  return best;
}

const ROWS: Spot[][] = [
  ['top-left', 'top-right'],
  ['left', 'right'],
  ['bottom-left', 'bottom-right'],
];

/** The spot one step away by keyboard: Alt and an arrow move the button across or along the edge. */
export function stepSpot(spot: Spot, key: string): Spot {
  const row = ROWS.findIndex((r) => r.includes(spot));
  const col = ROWS[row].indexOf(spot);
  if (key === 'ArrowLeft') return ROWS[row][0];
  if (key === 'ArrowRight') return ROWS[row][1];
  if (key === 'ArrowUp') return ROWS[Math.max(0, row - 1)][col];
  if (key === 'ArrowDown') return ROWS[Math.min(ROWS.length - 1, row + 1)][col];
  return spot;
}
