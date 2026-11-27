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
import { type RefObject, useEffect, useLayoutEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import {
  type ControlAudience,
  dialAudience,
  dialId,
  keepDials,
  readConfig,
  withDefaults,
} from '../core/controls.ts';
import { isStudioPerson, markControl, useControls } from './audience';
import { type IconName, iconMarkup } from './Icon';
import { isClientView, setClientView } from './prefs';

export { client } from '../core/controls.ts';

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
  // `design-hub export` captures the prototype alone; the panel never mounts.
  if (mounted || document.documentElement.dataset.export !== undefined) return;
  mounted = true;
  const host = document.createElement('div');
  host.dataset.harness = 'dials';
  document.body.append(host);
  const open = !parked && matchMedia('(min-width: 1180px)').matches;
  // DialKit hides its panel in production builds unless told otherwise; the
  // deployed prototypes are for tuning, so the dials ship with them.
  createRoot(host).render(
    <>
      <DialRoot
        position={parked ? 'top-left' : 'top-right'}
        theme="dark"
        defaultOpen={open}
        productionEnabled
      />
      <DialEyes />
    </>,
  );
  // DialKit portals the panel to <body>; it appears once the first panel registers.
  const settle = (root: HTMLElement) => {
    retitle(root);
    placeLinks(root);
    tagEmpty(root);
    new MutationObserver((records) => {
      for (const { type, target } of records) {
        // DialKit keeps the panel's scroll offset when it collapses, which pushes the trigger icon off-centre.
        if (type === 'attributes' && target instanceof HTMLElement && target.dataset.collapsed === 'true') {
          target.scrollTop = 0;
        }
      }
      retitle(root);
      placeLinks(root);
      tagEmpty(root);
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

type PanelLink = {
  key: string;
  label: string;
  icon: IconName;
  href?: string;
  newTab?: boolean;
  /** A row that does something here instead of going somewhere. */
  act?: () => void;
};

// Studio's way into Client view and back: the page as a client gets it, beside
// the dials it changes. The page loads again, so the comments, the dials and
// the prototype itself all start as a client's would.
function clientViewRow(): PanelLink {
  const on = isClientView();
  return {
    key: 'client-view',
    label: on ? 'Leave Client view' : 'Client view',
    icon: 'briefcase-01',
    act: () => {
      setClientView(!on);
      location.reload();
    },
  };
}

// The panel's last rows, under every group: Client view for Studio, the hub's
// list of every prototype, then the feature's walkthrough when it has one,
// which stays the very last.
function panelLinks(): PanelLink[] {
  const rows: PanelLink[] = isStudioPerson() ? [clientViewRow()] : [];
  rows.push({ key: 'home', href: '/', label: 'All prototypes', icon: 'grid-01' });
  if (guide)
    rows.push({
      key: 'guide',
      href: guide,
      label: 'Open the walkthrough',
      icon: 'arrow-up-right',
      newTab: true,
    });
  return rows;
}

function makeLink({ key, href, label, icon, newTab, act }: PanelLink) {
  const row = document.createElement(act ? 'button' : 'a');
  row.className = 'dial-link';
  row.dataset.dialLink = key;
  if (row instanceof HTMLButtonElement) {
    row.type = 'button';
    row.addEventListener('click', () => act?.());
  } else {
    row.href = href ?? '/';
    if (newTab) {
      row.target = '_blank';
      row.rel = 'noopener';
    }
  }
  row.innerHTML = `<span>${label}</span>${iconMarkup(icon, 16)}`;
  return row;
}

// DialKit remounts the content on open and adds groups as panels register, so
// the rows are put back whenever they are missing and moved down whenever a
// group lands below them.
function placeLinks(root: HTMLElement) {
  const content = root.querySelector('.dialkit-folder-root > .dialkit-folder-content');
  if (!content) return;
  const rows = panelLinks().map(
    (l) => content.querySelector<HTMLElement>(`:scope > [data-dial-link="${l.key}"]`) ?? makeLink(l),
  );
  const tail = Array.from(content.children).slice(-rows.length);
  if (rows.every((row, i) => tail[i] === row)) return;
  content.append(...rows);
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
    row.querySelector('.dialkit-select-label, .dialkit-text-label, .dialkit-color-label') ??
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

// Who a dial is for (core/controls.ts). Every dial is internal until marked
// client-facing: with `client(...)` where it is declared, or by Studio's eye
// beside its row, which is stored per site and overrules the code. Studio's
// panel has every dial. A Client's has only the client-facing ones: the others
// are never handed to DialKit, and code reads their defaults.

type Panel = {
  /** Each dial's id by the label path its row shows, as the hints key theirs. */
  byLabel: Record<string, string>;
  inCode: Record<string, ControlAudience>;
  /** Nothing in it for the person looking, so its header leaves the panel. */
  empty: boolean;
};
const panels = new Map<string, Panel>();

function labelIds(
  panel: string,
  cfg: DialConfig,
  into: Record<string, string>,
  labels = '',
  path: string[] = [],
) {
  for (const [k, v] of Object.entries(cfg)) {
    if (k === '_collapsed') continue;
    const label = labels + (actionLabel(v) ?? labelOf(k));
    if (v && typeof v === 'object' && !Array.isArray(v) && !('type' in v))
      labelIds(panel, v as DialConfig, into, label + PATH_SEP, [...path, k]);
    else into[label] = dialId(panel, [...path, k]);
  }
}

/**
 * A panel's config as DialKit takes it (`all`), the part of it the person
 * looking gets (`shown`), and DialKit's own options. Registers the hints too.
 */
function usePanel<T extends DialConfig>(name: string, config: T, options?: DialOptions<T>) {
  useLayoutEffect(ensureDialRoot, []);
  const { studio, marks } = useControls();
  const { hints: h, ...rest } = options ?? {};
  const { config: all, dials } = readConfig(name, config);
  const inCode = Object.fromEntries(dials.map((d) => [d.id, d.inCode]));
  const shown = studio
    ? all
    : keepDials(name, all, (id) => dialAudience(marks, id, inCode[id] ?? 'internal') === 'client');
  const byLabel: Record<string, string> = {};
  labelIds(name, all as DialConfig, byLabel);
  panels.set(name, { byLabel, inCode, empty: Object.keys(shown).length === 0 });
  registerHints(name, all as DialConfig, h as Record<string, unknown> | undefined);
  /** What the prototype reads: DialKit's values, with the default of every dial it was not given. */
  const read = (values: unknown) => (studio ? values : withDefaults(all, values as Record<string, unknown>));
  return { shown: shown as T, rest, read };
}

// DialKit draws a header for a panel with no dials in it.
function tagEmpty(root: HTMLElement) {
  for (const section of root.querySelectorAll<HTMLElement>('.dialkit-folder-section')) {
    const title = section
      .querySelector(':scope > .dialkit-folder-header .dialkit-folder-title')
      ?.textContent?.trim();
    const empty = !!title && !!panels.get(title)?.empty;
    if (empty !== 'dialEmpty' in section.dataset) section.toggleAttribute('data-dial-empty', empty);
  }
}

export function useDials<T extends DialConfig>(name: string, config: T, options?: DialOptions<T>) {
  const { shown, rest, read } = usePanel(name, config, options);
  return read(useDialKit(name, shown, rest)) as ReturnType<typeof useDialKit<T>>;
}

// The same panel with its controller, for dials that code also sets (every toggle at once).
export function useDialsController<T extends DialConfig>(name: string, config: T, options?: DialOptions<T>) {
  const { shown, rest, read } = usePanel(name, config, options);
  const controller = useDialKitController(name, shown, rest);
  return { ...controller, values: read(controller.values) } as ReturnType<typeof useDialKitController<T>>;
}

// Studio's eye beside each dial: one click marks it client-facing or internal.
// DialKit has no slot in a row, so the row gives up 32px at its right end
// (kit/dials.css) and the eye is drawn over that slot, from outside the row:
// a click on it never reaches a slider's drag.

const EYE_ROWS =
  '.dialkit-slider, .dialkit-labeled-control, .dialkit-select-row, .dialkit-text-control, .dialkit-color-control';
/** The panel's own sticky header, which a row scrolls under. */
const PANEL_HEAD = 48;

type Spot = { id: string; label: string; top: number; left: number };

function spotOf(row: HTMLElement, clip: DOMRect): Spot | null {
  if (row.parentElement?.closest(EYE_ROWS)) return null;
  const { path, panel } = rowPlace(row);
  const label = rowLabel(row);
  const id = panel ? panels.get(panel)?.byLabel[[...path, label].join(PATH_SEP)] : undefined;
  if (!id) return null;
  if (!('dialEye' in row.dataset)) row.dataset.dialEye = '';
  const r = row.getBoundingClientRect();
  const mid = r.top + r.height / 2;
  if (r.height === 0 || mid < clip.top + PANEL_HEAD || mid > clip.bottom - 8) return null;
  return { id, label, top: Math.round(mid), left: Math.round(r.right) };
}

function eyeSpots(): Spot[] {
  const clip = document.querySelector('.dialkit-root .dialkit-panel-inner')?.getBoundingClientRect();
  if (!clip) return [];
  const rows = document.querySelectorAll<HTMLElement>(`.dialkit-root :is(${EYE_ROWS})`);
  return [...rows].flatMap((row) => spotOf(row, clip) ?? []);
}

/** Where each eye sits, followed every frame while Studio can mark: the panel scrolls, folds and is dragged. */
function useEyeSpots(on: boolean) {
  const [spots, setSpots] = useState<Spot[]>([]);
  useEffect(() => {
    if (!on) return setSpots([]);
    document.documentElement.dataset.dialMarking = '';
    let frame = 0;
    let last = '';
    const tick = () => {
      const next = eyeSpots();
      const sig = JSON.stringify(next);
      if (sig !== last) setSpots(next);
      last = sig;
      frame = requestAnimationFrame(tick);
    };
    tick();
    return () => {
      cancelAnimationFrame(frame);
      delete document.documentElement.dataset.dialMarking;
    };
  }, [on]);
  return spots;
}

const EYE =
  'M2.4 12.7a1.2 1.2 0 0 1 0-1.4C3.5 9.6 6.7 5 12 5s8.5 4.6 9.6 6.3a1.2 1.2 0 0 1 0 1.4C20.5 14.4 17.3 19 12 19s-8.5-4.6-9.6-6.3Z';

function EyeIcon({ off }: { off: boolean }) {
  return (
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
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

function inCodeOf(id: string): ControlAudience {
  for (const p of panels.values()) if (id in p.inCode) return p.inCode[id];
  return 'internal';
}

function DialEyes() {
  const { studio, canMark, marks, failed } = useControls();
  const spots = useEyeSpots(canMark);
  // DialKit's own tools (Copy parameters, Save version) are Studio's: the panel shows them only under this mark.
  useEffect(() => {
    document.documentElement.toggleAttribute('data-dial-studio', studio);
  }, [studio]);
  if (!canMark) return null;
  return (
    <div data-harness="dial-eyes">
      {spots.map((s) => {
        const on = dialAudience(marks, s.id, inCodeOf(s.id)) === 'client';
        return (
          <button
            key={s.id}
            type="button"
            className="dial-eye"
            style={{ top: s.top, left: s.left }}
            aria-pressed={on}
            aria-label={`Client-facing: ${s.label}`}
            title={
              on
                ? 'Clients get this dial. Click to keep it internal.'
                : 'Internal. Click to give it to clients.'
            }
            onClick={() => void markControl('dial', s.id, on ? 'internal' : 'client')}
          >
            <EyeIcon off={!on} />
          </button>
        );
      })}
      {failed ? (
        <p className="dial-eye-failed" role="alert">
          {failed}
        </p>
      ) : null}
    </div>
  );
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
