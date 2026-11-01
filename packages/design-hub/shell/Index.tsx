import { fmtDate, plural } from '@kit/format';
import { useStoredState } from '@kit/hooks';
import { Icon } from '@kit/Icon';
import {
  type CSSProperties,
  type KeyboardEvent,
  type MouseEvent,
  useDeferredValue,
  useEffect,
  useRef,
  useState,
} from 'react';
import { featureTitle, guideHref } from '../core/feature';
import { type Entry, entries, guides } from './registry';
import './shell.css';

// One group per feature: its one primary prototype, its alternates on a rail
// under it, then its internal explorations folded away. A second sprint
// becomes an alternate, since a feature has one primary. Prototypes with no
// feature fold into their own group. Archived ones leave their group.
type Group = {
  id: string;
  title: string;
  guide?: string;
  items: Entry[];
  alternates: Entry[];
  explorations: Entry[];
};
const groupsOf = (list: Entry[]): Group[] => {
  const live = list.filter((e) => e.status !== 'archived');
  const features = [...new Set(live.map((e) => e.feature).filter(Boolean))];
  return [
    ...features.map((f) => {
      const own = live.filter((e) => e.feature === f);
      const primary = own.find((e) => e.kind === 'sprint');
      const alternates = own.filter((e) => e.kind !== 'exploration' && e !== primary);
      return {
        id: `feature-${f}`,
        title: featureTitle(f),
        guide: guides.has(f) ? guideHref(f) : undefined,
        items: primary ? [primary] : alternates,
        alternates: primary ? alternates : [],
        explorations: own.filter((e) => e.kind === 'exploration'),
      };
    }),
    {
      id: 'unassigned',
      title: 'Without a feature',
      items: [],
      alternates: [],
      explorations: live.filter((e) => !e.feature),
    },
    {
      id: 'archived',
      title: 'Archived',
      items: list.filter((e) => e.status === 'archived'),
      alternates: [],
      explorations: [],
    },
  ].filter((g) => g.items.length || g.alternates.length || g.explorations.length);
};

const RISE_CAP = 8;
const rise = (i: number) => ({ '--i': Math.min(i, RISE_CAP) }) as CSSProperties;

export function Index() {
  const [query, setQuery] = useState('');
  const [leaving, setLeaving] = useState<string | null>(null);
  const [opened, setOpened] = useStoredState<Record<string, boolean>>('index-explorations-open', {});
  const [instant, setInstant] = useState(false);
  const q = useDeferredValue(query.trim().toLowerCase());
  const main = useRef<HTMLElement>(null);
  const shown = entries.filter((e) => !q || `${e.title} ${e.summary} ${e.slug}`.toLowerCase().includes(q));
  const groups = groupsOf(shown);
  const archivedTotal = entries.filter((e) => e.status === 'archived').length;

  // A back-forward cache restore brings the faded page back; undo the exit.
  useEffect(() => {
    const restore = (e: PageTransitionEvent) => {
      if (e.persisted) setLeaving(null);
    };
    addEventListener('pageshow', restore);
    return () => removeEventListener('pageshow', restore);
  }, []);

  // Arrows walk the rows; keyboard moves never animate.
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const rows = Array.from(
      main.current?.querySelectorAll<HTMLAnchorElement>('.index-row, .index-fold:not([inert]) .index-card') ??
        [],
    );
    if (!rows.length) return;
    const at = rows.indexOf(document.activeElement as HTMLAnchorElement);
    const next = e.key === 'ArrowDown' ? Math.min(at + 1, rows.length - 1) : Math.max(at - 1, 0);
    rows[next]?.focus();
    e.preventDefault();
  };

  // Pointer opens fade the page while the prototype loads. A keyboard open
  // (detail 0) is instant, and a modified click opens elsewhere, so neither fades.
  const onOpen = (e: MouseEvent<HTMLAnchorElement>, slug: string) => {
    if (e.detail === 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    setLeaving(slug);
  };

  // A keyboard toggle (detail 0) opens and closes without motion.
  const onToggle = (e: MouseEvent<HTMLButtonElement>, id: string) => {
    setInstant(e.detail === 0);
    setOpened((o) => ({ ...o, [id]: !o[id] }));
  };

  const rows = (items: Entry[], from: number) =>
    items.map((e, i) => (
      <li key={e.slug} className="index-rise" style={rise(from + i)}>
        <a
          className="index-row"
          href={`/${e.slug}/`}
          data-kind={e.kind}
          data-chosen={leaving === e.slug || undefined}
          onClick={(ev) => onOpen(ev, e.slug)}
        >
          <span className="index-title">{e.title}</span>
          <span className="index-summary">{e.summary}</span>
          <EntryMeta entry={e} className="index-meta" />
        </a>
      </li>
    ));

  let slot = 0;
  return (
    <main className={leaving ? 'index is-leaving' : 'index'} ref={main} onKeyDown={onKeyDown}>
      <header className="index-head">
        <h1>Prototypes</h1>
        <p className="index-voice">
          High-fidelity sketches in code, made as we sprint on features and improve the product.
        </p>
      </header>
      {entries.length > 6 ? (
        <label className="index-filter">
          <span className="sr-only">Filter prototypes</span>
          <input
            type="search"
            placeholder="Filter"
            autoComplete="off"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
      ) : null}
      {entries.length === 0 ? (
        <section className="index-empty index-rise" style={rise(0)}>
          <h2>No prototypes yet</h2>
          <p>
            Write the problem and the one question in a README, then start one with{' '}
            <code>pnpm new &lt;slug&gt;</code>.
          </p>
        </section>
      ) : null}
      {groups.map((g) => {
        const from = slot;
        const alt = from + 1 + g.items.length;
        const sub = g.alternates.length ? alt + 1 + g.alternates.length : alt;
        const open = Boolean(q || opened[g.id]);
        slot = g.explorations.length ? sub + 1 + (open ? g.explorations.length : 0) : sub;
        return (
          <section key={g.id} aria-labelledby={`group-${g.id}`} className="index-group">
            <div className="index-section index-rise" style={rise(from)}>
              <h2 id={`group-${g.id}`}>{g.title}</h2>
              {g.guide ? (
                <a className="index-guide" href={g.guide}>
                  Walkthrough
                  <span className="sr-only"> for {g.title}</span>
                  <Icon name="arrow-right" size={16} />
                </a>
              ) : null}
            </div>
            {g.items.length ? <ul className="index-list">{rows(g.items, from + 1)}</ul> : null}
            {g.alternates.length ? (
              <div className="index-alternates">
                <h3
                  id={`group-${g.id}-alternates`}
                  className="index-alternates-label index-rise"
                  style={rise(alt)}
                >
                  Alternates
                </h3>
                <ul className="index-list" aria-labelledby={`group-${g.id}-alternates`}>
                  {rows(g.alternates, alt + 1)}
                </ul>
              </div>
            ) : null}
            {g.explorations.length ? (
              <Explorations
                group={g}
                at={sub}
                open={open}
                instant={instant}
                leaving={leaving}
                onToggle={(ev) => onToggle(ev, g.id)}
                onOpen={onOpen}
              />
            ) : null}
          </section>
        );
      })}
      {entries.length > 0 && shown.length === 0 ? (
        <p className="index-none" role="status">
          Nothing matches “{query}”.
        </p>
      ) : null}
      {entries.length > 0 ? (
        <footer className="index-foot index-rise" style={rise(slot)}>
          <p className="tabular">
            {plural(entries.length - archivedTotal, 'prototype')}
            {archivedTotal ? `, ${plural(archivedTotal, 'archived')}` : ''}
          </p>
        </footer>
      ) : null}
    </main>
  );
}

/** A group's internal explorations, folded away under a toggle until asked for or a search matches them. */
function Explorations({
  group,
  at,
  open,
  instant,
  leaving,
  onToggle,
  onOpen,
}: {
  group: Group;
  at: number;
  open: boolean;
  instant: boolean;
  leaving: string | null;
  onToggle: (e: MouseEvent<HTMLButtonElement>) => void;
  onOpen: (e: MouseEvent<HTMLAnchorElement>, slug: string) => void;
}) {
  const foldId = `group-${group.id}-explorations`;
  return (
    <>
      <h3 id={`${foldId}-title`} className="index-subsection index-rise" style={rise(at)}>
        <button
          type="button"
          className="index-fold-toggle"
          aria-expanded={open}
          aria-controls={foldId}
          onClick={onToggle}
        >
          Internal explorations
          <span className="index-fold-count tabular">{group.explorations.length}</span>
          <Icon name="chevron-down" size={16} />
        </button>
      </h3>
      <div
        id={foldId}
        className="index-fold"
        data-open={open || undefined}
        data-instant={instant || undefined}
        inert={!open}
      >
        <ul className="index-cards" aria-labelledby={`${foldId}-title`}>
          {group.explorations.map((e, i) => (
            <li key={e.slug} className="index-rise" style={rise(at + 1 + i)}>
              <a
                className="index-card"
                href={`/${e.slug}/`}
                data-chosen={leaving === e.slug || undefined}
                onClick={(ev) => onOpen(ev, e.slug)}
              >
                <span className="index-card-head">
                  <span className="index-title">{e.title}</span>
                  <Icon name="arrow-right" size={16} />
                </span>
                <span className="index-summary">{e.summary}</span>
                <EntryMeta entry={e} className="index-card-meta" />
              </a>
            </li>
          ))}
        </ul>
      </div>
    </>
  );
}

function EntryMeta({ entry, className }: { entry: Entry; className: string }) {
  return (
    <span className={className}>
      <span>{entry.context === 'app' ? 'App shell' : 'Space'}</span>
      <span className="index-status" data-status={entry.status}>
        {entry.status}
      </span>
      <time dateTime={entry.created} className="tabular">
        {fmtDate(entry.created)}
      </time>
    </span>
  );
}
