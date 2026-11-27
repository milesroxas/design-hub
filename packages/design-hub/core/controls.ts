// Which of a prototype's controls a Client gets: its dials and its variants.
// Pure, so the server, the kit and the tests read one set of rules.
//
// A dial is internal until marked client-facing. It is marked in two places:
// in code, with `client(...)` around the dial where it is declared, which is
// where it starts; and in the hub, by Studio, which is stored per deployed
// site and overrules the code either way. A variant is marked only in the
// hub. The View tools are never asked about: they are always a Client's.
//
// The mark decides what a Client's panel draws and nothing else. A prototype's
// code is one file a Client's browser loads, so an internal dial's name, range
// and default are still in it; its value stays at the default.

export type ControlAudience = 'internal' | 'client';

export const CONTROL_KINDS = ['dial', 'variant'] as const;
export type ControlKind = (typeof CONTROL_KINDS)[number];

/** What the hub stored for one prototype: a mark per dial Studio switched, and the variants a Client gets. */
export type Marks = { dials: Record<string, ControlAudience>; variants: string[] };

export const NO_MARKS: Marks = { dials: {}, variants: [] };

const MAX_ID = 200;

/** A dial's or a variant's name as the store keeps it: one line of text, trimmed, at most 200 characters. */
export const isControlId = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length > 0 &&
  v.length <= MAX_ID &&
  v.trim() === v &&
  // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what is refused
  !/[\u0000-\u001f\u007f]/.test(v);

/** A dial is named by its panel and its key, a folder's dial by the keys down to it: `Review/density`, `Card/shadow.blur`. */
export const dialId = (panel: string, path: readonly string[]) => `${panel}/${path.join('.')}`;

/** The store's field for one control. */
export const controlField = (kind: ControlKind, id: string) => `${kind}:${id}`;

/** The marks in a prototype's stored fields. A field or a value that is not one of ours is left out, so it reads as unmarked. */
export function readMarks(fields: Record<string, string>): Marks {
  const dials: Record<string, ControlAudience> = {};
  const variants: string[] = [];
  for (const [field, value] of Object.entries(fields)) {
    const at = field.indexOf(':');
    const [kind, id] = [field.slice(0, at), field.slice(at + 1)];
    if (!isControlId(id)) continue;
    if (kind === 'dial' && (value === 'client' || value === 'internal')) dials[id] = value;
    if (kind === 'variant' && value === 'client') variants.push(id);
  }
  return { dials, variants: variants.sort() };
}

/** The marks after one control is switched. */
export function withMark(marks: Marks, kind: ControlKind, id: string, audience: ControlAudience): Marks {
  if (kind === 'dial') return { ...marks, dials: { ...marks.dials, [id]: audience } };
  const rest = marks.variants.filter((v) => v !== id);
  return { ...marks, variants: audience === 'client' ? [...rest, id].sort() : rest };
}

/** Who a dial is for: the hub's mark when Studio set one, else what the code says, else internal. */
export const dialAudience = (marks: Marks, id: string, inCode: ControlAudience): ControlAudience =>
  marks.dials[id] ?? inCode;

/**
 * The variants a Client gets, in the order the prototype declares them. One
 * is no picker. None marked is still one: the first, so a page is never empty.
 */
export function clientVariants(names: readonly string[], marks: Marks): string[] {
  const kept = names.filter((n) => marks.variants.includes(n));
  return kept.length ? kept : names.slice(0, 1);
}

// The config a prototype hands to useDials, read without DialKit's types: a
// leaf is a dial, an object without a `type` is a folder of them.

type Config = Record<string, unknown>;
type Marked = { __client: unknown };

const isRecord = (v: unknown): v is Config => typeof v === 'object' && v !== null && !Array.isArray(v);
const isMarked = (v: unknown): v is Marked => isRecord(v) && '__client' in v;
const isFolder = (v: unknown): v is Config => isRecord(v) && !('type' in v);
/** DialKit's own key for a folder that starts closed: not a dial. */
const SETTING = '_collapsed';

/**
 * Marks a dial client-facing where it is declared, or a folder and every dial
 * in it. Typed as the dial itself, so the values a prototype reads keep their types.
 */
export const client = <T>(dial: T): T => ({ __client: dial }) as T;

export type Dial = { id: string; path: string[]; inCode: ControlAudience };

/** A config as DialKit takes it (every `client()` unwrapped) and the dials in it. */
export function readConfig(panel: string, config: Config): { config: Config; dials: Dial[] } {
  const dials: Dial[] = [];
  const walk = (node: Config, path: string[], inherited: ControlAudience): Config => {
    const out: Config = {};
    for (const [key, raw] of Object.entries(node)) {
      if (key === SETTING) {
        out[key] = raw;
        continue;
      }
      const inCode: ControlAudience = isMarked(raw) ? 'client' : inherited;
      const value = isMarked(raw) ? raw.__client : raw;
      const at = [...path, key];
      if (isFolder(value)) out[key] = walk(value, at, inCode);
      else {
        out[key] = value;
        dials.push({ id: dialId(panel, at), path: at, inCode });
      }
    }
    return out;
  };
  return { config: walk(config, [], 'internal'), dials };
}

/** The part of an unwrapped config whose dials `shown` keeps. A folder with none left goes with them. */
export function keepDials(panel: string, config: Config, shown: (id: string) => boolean): Config {
  const walk = (node: Config, path: string[]): Config => {
    const out: Config = {};
    for (const [key, value] of Object.entries(node)) {
      if (key === SETTING) continue;
      const at = [...path, key];
      if (isFolder(value)) {
        const inner = walk(value, at);
        if (Object.keys(inner).length)
          out[key] = SETTING in value ? { ...inner, [SETTING]: value[SETTING] } : inner;
      } else if (shown(dialId(panel, at))) out[key] = value;
    }
    return out;
  };
  return walk(config, []);
}

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, min: number, max: number) => Math.max(min, Math.min(max, v));

/** A slider's starting value: its first number, kept inside a range that is given. */
function sliderDefault(value: readonly unknown[]): number {
  const seed = finite(value[0]) ? value[0] : 0;
  if (!finite(value[1]) || !finite(value[2])) return seed;
  const [min, max] = value[1] <= value[2] ? [value[1], value[2]] : [value[2], value[1]];
  return clamp(seed, min, min === max ? min + 1 : max);
}

const firstOption = (options: unknown): unknown => {
  const first = Array.isArray(options) ? options[0] : undefined;
  if (first === undefined) return '';
  return typeof first === 'string' ? first : (first as { value: unknown }).value;
};

/** One axis of a pad: `[default, min, max, step?]`, the default snapped to the step as DialKit snaps it. */
function padAxis(axis: unknown): number {
  const [initial, min, max, given] = (Array.isArray(axis) ? axis : [0, -1, 1, 0.01]) as number[];
  const step = given ?? (max - min) / 200;
  const at = clamp(initial, min, max);
  if (at === min || at === max) return at;
  return clamp(Number((min + Math.round((at - min) / step) * step).toPrecision(12)), min, max);
}

/** By `type`: what DialKit starts each kind of dial at when its config names no default. */
const TYPED: Record<string, (v: Config) => unknown> = {
  select: (v) => v.default ?? firstOption(v.options),
  color: (v) => v.default ?? '#000000',
  image: (v) => v.default ?? firstOption(v.options ?? []),
  text: (v) => v.default ?? '',
  pad: (v) => ({ x: padAxis(v.x), y: padAxis(v.y) }),
};

/**
 * What a dial reads when nobody can move it: the value DialKit would start it
 * at. A test holds this equal to DialKit's own for every kind of dial.
 */
export function defaultOf(dial: unknown): unknown {
  if (Array.isArray(dial)) return sliderDefault(dial);
  if (!isRecord(dial) || typeof dial.type !== 'string') return dial;
  const typed = TYPED[dial.type];
  return typed ? typed(dial) : dial;
}

/**
 * The values a prototype reads: DialKit's for the dials it drew, the default
 * for every dial it did not, in the shape of the whole config.
 */
export function withDefaults(config: Config, values: Config): Config {
  const out: Config = {};
  for (const [key, dial] of Object.entries(config)) {
    if (key === SETTING) continue;
    if (isFolder(dial)) out[key] = withDefaults(dial, isRecord(values[key]) ? values[key] : {});
    else out[key] = key in values ? values[key] : defaultOf(dial);
  }
  return out;
}
