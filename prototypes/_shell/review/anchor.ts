// Where a comment points: the prototype's state (URL and every dial) and an
// element on the page, and the way back to both. The selector is a path of
// tag:nth-of-type steps, stopping at a stable id, because prototype markup
// rarely carries test ids and a pin must survive a reload.
import { restoreDials, snapshotDials } from '@kit/dials';
import type { Anchor } from '../../_core/review/model';

const RESTORE_KEY = 'hub-review-restore';
const RESTORE_WAIT_MS = 3000;
// React's useId values (:r1:, «r1») change between renders of different trees; never anchor on them.
const STABLE_ID = /^[A-Za-z][\w-]*$/;

export const isHarness = (el: Element | null) =>
  !!el?.closest('[data-harness], .dialkit-root, .proto-picker');

/** The element's own id when it is stable and unique on the page, so a path can stop there. */
function stableId(node: Element): string | null {
  if (!node.id || !STABLE_ID.test(node.id)) return null;
  const id = `#${CSS.escape(node.id)}`;
  return document.querySelectorAll(id).length === 1 ? id : null;
}

/** tag, or tag:nth-of-type(n) when siblings share the tag. */
function step(node: Element): string {
  const same = node.parentElement
    ? [...node.parentElement.children].filter((c) => c.localName === node.localName)
    : [];
  return same.length > 1 ? `${node.localName}:nth-of-type(${same.indexOf(node) + 1})` : node.localName;
}

function selectorFor(el: Element): string | null {
  if (isHarness(el) || el === document.body || el === document.documentElement) return null;
  const steps: string[] = [];
  for (let node: Element | null = el; node && node !== document.body; node = node.parentElement) {
    const id = stableId(node);
    if (id) return [id, ...steps].join(' > ');
    steps.unshift(step(node));
  }
  return `body > ${steps.join(' > ')}`;
}

function resolveTarget(selector: string | null): Element | null {
  if (!selector) return null;
  try {
    return document.querySelector(selector);
  } catch {
    return null;
  }
}

export const currentUrl = () => location.pathname + location.search + location.hash;

export function captureAnchor(
  where: { prototype: string; feature: string },
  target: Element | null,
  point: { x: number; y: number } | null,
): Anchor {
  const selector = target ? selectorFor(target) : null;
  let offset: Anchor['offset'] = null;
  if (target && selector && point) {
    const r = target.getBoundingClientRect();
    const clamp = (v: number) => Math.min(1, Math.max(0, v));
    offset = {
      x: clamp(r.width ? (point.x - r.left) / r.width : 0.5),
      y: clamp(r.height ? (point.y - r.top) / r.height : 0.5),
    };
  }
  return {
    ...where,
    url: currentUrl(),
    dials: snapshotDials(),
    target: selector,
    offset,
    viewport: { width: innerWidth, height: innerHeight },
  };
}

/** Where a pin sits now, in viewport pixels, or null when its element is not on the page. */
export function pinPoint(anchor: Anchor): { x: number; y: number } | null {
  const el = resolveTarget(anchor.target);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (!r.width && !r.height) return null;
  const o = anchor.offset ?? { x: 0.5, y: 0.5 };
  return { x: r.left + r.width * o.x, y: r.top + r.height * o.y };
}

function settleDials(dials: Anchor['dials'], then: (missing: string[]) => void) {
  // Panels register as the prototype renders, so retry until every named one exists or time runs out.
  const started = performance.now();
  const tick = () => {
    const missing = restoreDials(dials);
    if (!missing.length || performance.now() - started > RESTORE_WAIT_MS) then(missing);
    else requestAnimationFrame(tick);
  };
  tick();
}

/**
 * Reopens a comment's state. A different path or query reloads the page
 * (the variant picker and the shell read them on load), carrying the dials
 * through sessionStorage; a different hash only changes the route.
 */
export function openAnchor(anchor: Anchor, commentId: string, done: (missing: string[]) => void): void {
  const url = new URL(anchor.url, location.origin);
  if (url.pathname !== location.pathname || url.search !== location.search) {
    try {
      sessionStorage.setItem(RESTORE_KEY, JSON.stringify({ id: commentId, dials: anchor.dials }));
    } catch {
      // Storage off (a private window): the page still opens at the URL, without the dials.
    }
    location.assign(anchor.url);
    return;
  }
  if (url.hash !== location.hash) location.hash = url.hash;
  settleDials(anchor.dials, done);
}

/** After a reload from openAnchor: the comment to focus, once its dials are set. */
export function resumeAnchor(done: (commentId: string, missing: string[]) => void): void {
  let pending: { id: string; dials: Anchor['dials'] } | null = null;
  try {
    pending = JSON.parse(sessionStorage.getItem(RESTORE_KEY) ?? 'null');
    sessionStorage.removeItem(RESTORE_KEY);
  } catch {
    // Storage off, or a value this page did not write: there is nothing to resume.
  }
  if (pending) {
    const { id, dials } = pending;
    settleDials(dials, (missing) => done(id, missing));
  }
}
