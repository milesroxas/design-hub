// Hostile fixture sets, derived from the real ones so Claude never writes
// them by hand. A feature's fixtures.json holds `real` (pulled from the CMS
// or copied from the comp) and `missing` (the item with no image, no link,
// hand-written because no rule can derive it). This file fills in the rest:
//
//   longest  the first item carries, in each free-text field the component
//            names (`text`), the longest real value for that field doubled,
//            because the CMS will hold a longer title than anything in it
//            today; the other items stay real, so the monster row is judged
//            beside normal ones. Only named fields stretch: a doubled date,
//            status or URL is not a longer value, it is a broken one
//   empty    nothing
//   max      the real items repeated up to the design's maximum count, ids
//            made unique so React keys hold
//
// A set written in the JSON by hand wins over the derived one, so a feature
// can replace any of them when its component needs something the rule
// cannot know.

export const SET_NAMES = ['real', 'longest', 'empty', 'max', 'missing'] as const;
export type SetName = (typeof SET_NAMES)[number];

export type FixtureSets<T> = Record<SetName, T[]>;
type Source<T> = { real: T[]; missing: T[] } & Partial<Record<SetName, T[]>>;
/** The keys of T whose values are strings: the only fields `longest` can stretch. */
type TextKey<T> = { [K in keyof T & string]: T[K] extends string | null | undefined ? K : never }[keyof T &
  string];
type Options<T> = {
  /** The design's maximum count, for `max`. */
  max: number;
  /** The free-text fields a reviewer reads (a name, a title), for `longest`. */
  text: readonly TextKey<T>[];
};

export function fixtureSets<T extends Record<string, unknown>>(
  source: Source<T>,
  { max, text }: Options<T>,
): FixtureSets<T> {
  return {
    real: source.real,
    longest: source.longest ?? longest(source.real, text),
    empty: source.empty ?? [],
    max: source.max ?? repeat(source.real, max),
    missing: source.missing,
  };
}

function longest<T extends Record<string, unknown>>(real: T[], text: readonly string[]): T[] {
  const [first, ...rest] = real;
  if (!first) return [];
  const hostile = { ...first } as Record<string, unknown>;
  for (const key of text) {
    const widest = real
      .map((item) => item[key])
      .filter((v): v is string => typeof v === 'string')
      .reduce((a, b) => (b.length > a.length ? b : a), '');
    if (widest) hostile[key] = `${widest} ${widest}`;
  }
  return [hostile as T, ...rest];
}

function repeat<T extends Record<string, unknown>>(real: T[], count: number): T[] {
  if (!real.length) return [];
  return Array.from({ length: count }, (_, i) => {
    const item = real[i % real.length];
    const round = Math.floor(i / real.length);
    return round === 0 || !('id' in item) ? item : { ...item, id: `${String(item.id)}-${round}` };
  });
}
