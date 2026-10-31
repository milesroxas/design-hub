// A prototype README's `## States` table: one row per state the prototype
// holds, the first cell its name and the second how a reviewer reaches it.
// The fidelity guard, the pre-flight, comment triage and `miles-port` all
// read states through this one parser, so they never disagree on the list.

export type State = { name: string; reach: string };

const HEADING = /^##\s+States\s*$/m;
const NEXT_HEADING = /^#{1,2}\s/m;
const SEPARATOR = /^\|\s*:?-{3,}/;

const cells = (row: string) =>
  row
    .trim()
    .replace(/^\||\|$/g, '')
    .split('|')
    .map((c) => c.trim());

/** The states listed in a README, or null when it has no States section. */
export function parseStates(readme: string): State[] | null {
  const start = readme.search(HEADING);
  if (start < 0) return null;
  const rest = readme.slice(start).replace(HEADING, '');
  const end = rest.search(NEXT_HEADING);
  const section = end < 0 ? rest : rest.slice(0, end);
  const rows = section.split('\n').filter((l) => l.trim().startsWith('|'));
  // The first row is the header, whatever it says; the separator follows it.
  return rows
    .slice(1)
    .filter((r) => !SEPARATOR.test(r.trim()))
    .map(cells)
    .map(([name = '', reach = '']) => ({ name, reach }))
    .filter((s) => s.name !== '');
}
