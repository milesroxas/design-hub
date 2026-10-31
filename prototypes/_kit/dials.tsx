import {
  type ActionConfig,
  type DialConfig,
  DialRoot,
  DialStore,
  type DialValue,
  type UseDialOptions,
  useDialKit,
  useDialKitController,
} from 'dialkit';
import 'dialkit/styles.css';
import './dials.css';
import { type RefObject, useLayoutEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { iconMarkup } from './Icon';

// What the panel calls itself. DialKit hard-codes its own name as the root
// title; the prototypes say what the thing is instead.
export const DIALS_TITLE = 'Controls';

let mounted = false;
let parked = false;
let guide: string | null = null;

// The app shell parks its dials closed in the sidebar's empty corner, so the product stays in view.
export function parkDials() {
  parked = true;
}

// The shell names the walkthrough for the open prototype's feature. It must
// run before the root mounts; the panel then opens with the link as its last row.
export const setGuide = (href: string) => {
  guide = href;
};

// One DialRoot per page, in its own React root, however many panels register.
export function ensureDialRoot() {
  if (mounted) return;
  mounted = true;
  const host = document.createElement('div');
  host.dataset.harness = 'dials';
  document.body.append(host);
  const open = !parked && matchMedia('(min-width: 1180px)').matches;
  // DialKit hides its panel in production builds unless told otherwise; the
  // deployed prototypes are for tuning, so the dials ship with them.
  createRoot(host).render(
    <DialRoot
      position={parked ? 'top-left' : 'top-right'}
      theme="dark"
      defaultOpen={open}
      productionEnabled
    />,
  );
  // DialKit portals the panel to <body>; it appears once the first panel registers.
  const settle = (root: HTMLElement) => {
    retitle(root);
    placeGuide(root);
    new MutationObserver((records) => {
      for (const { type, target } of records) {
        // DialKit keeps the panel's scroll offset when it collapses, which pushes the trigger icon off-centre.
        if (type === 'attributes' && target instanceof HTMLElement && target.dataset.collapsed === 'true') {
          target.scrollTop = 0;
        }
      }
      retitle(root);
      placeGuide(root);
    }).observe(root, { subtree: true, childList: true, attributeFilter: ['data-collapsed'] });
  };
  const found = document.body.querySelector<HTMLElement>('.dialkit-root');
  if (found) settle(found);
  else {
    const watch = new MutationObserver(() => {
      const root = document.body.querySelector<HTMLElement>('.dialkit-root');
      if (!root) return;
      watch.disconnect();
      settle(root);
    });
    watch.observe(document.body, { childList: true });
  }
  installHints();
}

// The root header renders the library's name as its title and its accessible
// name, and mounts the title again on every open.
function retitle(root: HTMLElement) {
  const head = root.querySelector<HTMLElement>(
    '.dialkit-folder-root > .dialkit-folder-header .dialkit-folder-header-top',
  );
  if (head && head.getAttribute('aria-label') !== DIALS_TITLE) head.setAttribute('aria-label', DIALS_TITLE);
  const title = root.querySelector<HTMLElement>('.dialkit-folder-title-root');
  if (title && title.textContent !== DIALS_TITLE) title.textContent = DIALS_TITLE;
}

// The walkthrough is the panel's last row, under every group. DialKit remounts
// the content on open and adds groups as panels register, so the link is put
// back whenever it is missing and moved down whenever a group lands below it.
function placeGuide(root: HTMLElement) {
  if (!guide) return;
  const content = root.querySelector('.dialkit-folder-root > .dialkit-folder-content');
  if (!content) return;
  const placed = content.querySelector(':scope > .dial-guide');
  if (placed) {
    if (content.lastElementChild !== placed) content.append(placed);
    return;
  }
  const link = document.createElement('a');
  link.className = 'dial-guide';
  link.href = guide;
  link.target = '_blank';
  link.rel = 'noopener';
  link.innerHTML = `<span>Open the walkthrough</span>${iconMarkup('arrow-up-right', 16)}`;
  content.append(link);
}

// Hints: what each dial does, shown on hover or focus.
// DialKit has no per-control description, so the kit keeps one per panel and
// label and draws its own tooltip under the hovered row. A nested folder's
// controls take a nested object, keyed the same way as the config.

export type DialHints<T> = {
  [K in keyof T & string]?: T[K] extends boolean | number | string | readonly unknown[] | { type: string }
    ? string
    : DialHints<T[K]>;
};
type DialOptions<T> = UseDialOptions & { hints?: DialHints<T> };

const hints = new Map<string, Record<string, string>>();
// DialKit's own key-to-label rule, so a hint keyed by `hingeAngle` meets the row labelled "Hinge Angle".
const labelOf = (key: string) =>
  key
    .replace(/([A-Z])/g, ' $1')
    .replace(/^./, (s) => s.toUpperCase())
    .trim();
const PATH_SEP = ' / ';

// An action's row is its button, labelled by the config's `label` when it has one.
const actionLabel = (c: unknown) =>
  c && typeof c === 'object' && (c as ActionConfig).type === 'action' ? (c as ActionConfig).label : undefined;

function flattenHints(
  h: Record<string, unknown>,
  cfg: DialConfig,
  into: Record<string, string>,
  prefix = '',
) {
  for (const [k, v] of Object.entries(h)) {
    const label = prefix + (actionLabel(cfg[k]) ?? labelOf(k));
    if (typeof v === 'string') into[label] = v;
    else if (v && typeof v === 'object') {
      flattenHints(v as Record<string, unknown>, (cfg[k] ?? {}) as DialConfig, into, label + PATH_SEP);
    }
  }
}

function registerHints(panel: string, config: DialConfig, h?: Record<string, unknown>) {
  if (!h) return;
  const byLabel: Record<string, string> = { ...hints.get(panel) };
  flattenHints(h, config, byLabel);
  hints.set(panel, byLabel);
}

const rowLabel = (row: HTMLElement) =>
  row.getAttribute('aria-label') ??
  (
    row.querySelector('.dialkit-labeled-control-label')?.firstChild ??
    row.querySelector('.dialkit-select-label') ??
    row
  ).textContent?.trim() ??
  '';

/** The row's folders, innermost first, up to its panel (the section), and the panel's title. */
function rowPlace(row: HTMLElement): { path: string[]; panel: string | undefined } {
  const path: string[] = [];
  for (
    let f = row.closest<HTMLElement>('.dialkit-folder');
    f;
    f = f.parentElement?.closest('.dialkit-folder') ?? null
  ) {
    const title = f
      .querySelector(':scope > .dialkit-folder-header .dialkit-folder-title')
      ?.textContent?.trim();
    if (f.classList.contains('dialkit-folder-section')) return { path, panel: title };
    if (title) path.unshift(title);
  }
  return { path, panel: undefined };
}

function hintFor(el: Element) {
  const row = el.closest<HTMLElement>(
    '.dialkit-slider, .dialkit-labeled-control, .dialkit-select-row, .dialkit-button',
  );
  if (!row) return null;
  const { path, panel } = rowPlace(row);
  const text = panel ? hints.get(panel)?.[[...path, rowLabel(row)].join(PATH_SEP)] : undefined;
  return text ? { row, text } : null;
}

// The first hint waits; once one is up, moving to the next row shows it at once (the Tooltip Rule).
// DialKit portals its panel to <body>, so the listeners sit on the document and keep to .dialkit-root.
function installHints() {
  const tip = document.createElement('div');
  tip.className = 'dial-hint';
  tip.setAttribute('role', 'tooltip');
  tip.setAttribute('aria-hidden', 'true');
  document.body.append(tip);
  let shownFor: HTMLElement | null = null;
  let timer = 0;
  let lastHidden = 0;

  const show = (row: HTMLElement, text: string) => {
    const r = row.getBoundingClientRect();
    const onLeft = r.left < innerWidth / 2;
    tip.textContent = text;
    tip.style.top = `${r.bottom + 6}px`;
    tip.style.left = onLeft ? `${r.left}px` : '';
    tip.style.right = onLeft ? '' : `${innerWidth - r.right}px`;
    tip.style.transformOrigin = onLeft ? 'top left' : 'top right';
    tip.classList.add('is-on');
    tip.removeAttribute('aria-hidden');
    shownFor = row;
  };
  const hide = () => {
    clearTimeout(timer);
    if (shownFor) lastHidden = performance.now();
    shownFor = null;
    tip.classList.remove('is-on');
    tip.setAttribute('aria-hidden', 'true');
  };
  const aim = (target: Element | null) => {
    const hit = target?.closest('.dialkit-root') ? hintFor(target) : null;
    if (!hit) return hide();
    if (hit.row === shownFor) return;
    clearTimeout(timer);
    const instant = shownFor || performance.now() - lastHidden < 500;
    if (instant) show(hit.row, hit.text);
    else timer = window.setTimeout(() => show(hit.row, hit.text), 400);
  };

  document.addEventListener('pointerover', (e) => aim(e.target as Element));
  document.addEventListener('pointerdown', hide);
  document.addEventListener('focusin', (e) => aim(e.target as Element));
  document.addEventListener('focusout', hide);
  document.addEventListener('scroll', hide, true);
}

export function useDials<T extends DialConfig>(name: string, config: T, options?: DialOptions<T>) {
  useLayoutEffect(ensureDialRoot, []);
  const { hints: h, ...rest } = options ?? {};
  registerHints(name, config, h as Record<string, unknown> | undefined);
  return useDialKit(name, config, rest);
}

// The same panel with its controller, for dials that code also sets (every toggle at once).
export function useDialsController<T extends DialConfig>(name: string, config: T, options?: DialOptions<T>) {
  useLayoutEffect(ensureDialRoot, []);
  const { hints: h, ...rest } = options ?? {};
  registerHints(name, config, h as Record<string, unknown> | undefined);
  return useDialKitController(name, config, rest);
}

// Dial values as CSS variables on an element: `--key`, a folder's as `--folder-key`,
// a toggle as 1 or 0, an easing as the curve plus `--key-duration` in ms.
/** A number or string as written, a toggle as 1 or 0; null for anything else. */
const plainValue = (value: unknown): string | null =>
  typeof value === 'boolean'
    ? value
      ? '1'
      : '0'
    : typeof value === 'number' || typeof value === 'string'
      ? String(value)
      : null;

type Easing = { ease: number[]; duration: number };
const isEasing = (v: object): v is Easing => 'ease' in v && 'duration' in v;

export function writeDialVars(el: HTMLElement, values: Record<string, unknown>, prefix = '') {
  for (const [key, value] of Object.entries(values)) {
    const prop = `--${prefix}${key}`;
    const plain = plainValue(value);
    if (plain !== null) el.style.setProperty(prop, plain);
    else if (!value || typeof value !== 'object') continue;
    else if (isEasing(value)) {
      el.style.setProperty(prop, `cubic-bezier(${value.ease.join(', ')})`);
      el.style.setProperty(`${prop}-duration`, String(Math.round(value.duration * 1000)));
    } else if (!('type' in value)) writeDialVars(el, value as Record<string, unknown>, `${prefix}${key}-`);
  }
}

type VarsProps<T extends DialConfig> = {
  name: string;
  config: T;
  target?: RefObject<HTMLElement | null>;
  options?: DialOptions<T>;
};

// Values land in CSS variables, not state, so a slider re-renders nothing.
export function DialVars<T extends DialConfig>({ name, config, target, options }: VarsProps<T>) {
  const values = useDials(name, config, options);
  useLayoutEffect(() => {
    writeDialVars(target?.current ?? document.documentElement, values as Record<string, unknown>);
  }, [values, target]);
  return null;
}

// The dial state a review comment carries, and the way back to it.

/** Every registered panel's values, by panel name. */
export function snapshotDials(): Record<string, Record<string, unknown>> {
  return Object.fromEntries(DialStore.getPanels('panel').map((p) => [p.name, DialStore.getValues(p.id)]));
}

/** Sets each named panel's values; returns the names of panels this page does not have. */
export function restoreDials(snapshot: Record<string, Record<string, unknown>>): string[] {
  const panels = new Map(DialStore.getPanels('panel').map((p) => [p.name, p.id]));
  const missing: string[] = [];
  for (const [name, values] of Object.entries(snapshot)) {
    const id = panels.get(name);
    if (id) DialStore.updateValues(id, values as Record<string, DialValue>);
    else missing.push(name);
  }
  return missing;
}
