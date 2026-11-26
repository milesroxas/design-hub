// Comment mode's bar: one quiet pill in three groups. What a new comment is
// about (Pin or Page), the threads to step through, and the way out.
// Everything rarer sits behind ⋯: for Studio, that includes which threads
// to list (all, internal, client-facing) and Client view. Client view, and a
// filter other than All, each put a plain note over the bar with the way out,
// so a narrowed list is never mistaken for the whole one. Only the chosen half of the
// toggle is filled: the page under the bar is the work.
import { Icon } from '@kit/Icon';
import { Button, type MenuEntry, useMenu } from '@kit/ui';
import type { Filter, Scope } from './view';

const VERB = matchMedia('(pointer: coarse)').matches ? 'Tap' : 'Click';

type Props = {
  count: number;
  /** Where the open thread sits in the round, from 0; -1 with none open. */
  index: number;
  scope: Scope;
  onScope: (scope: Scope) => void;
  resolved: boolean;
  resolvedCount: number;
  /** Studio only: the People entry in ⋯. */
  canManagePeople: boolean;
  /** Studio, not in Client view: the audience filter in ⋯. */
  canFilter: boolean;
  filter: Filter;
  /** "Internal only" while the filter narrows the list; null with All. */
  filterNote: string | null;
  onFilter: (filter: Filter) => void;
  /** Studio: the Client view entry in ⋯, and the note while it is on. */
  canClientView: boolean;
  clientView: boolean;
  onClientView: (on: boolean) => void;
  error: string | null;
  onStep: (by: number) => void;
  onResolved: () => void;
  onPeople: () => void;
  onHide: () => void;
  onDone: () => void;
  onDismissError: () => void;
};

const FILTERS: { value: Filter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'internal', label: 'Internal' },
  { value: 'client', label: 'Client-facing' },
];

/** Studio's: which threads to list, then Client view. A Client gets neither. */
function audienceItems(p: Pick<Props, 'canFilter' | 'filter' | 'canClientView' | 'clientView'>): MenuEntry[] {
  const filter: MenuEntry[] = p.canFilter
    ? [
        { heading: 'Show' },
        ...FILTERS.map((f) => ({
          label: f.label,
          value: `filter:${f.value}`,
          checked: p.filter === f.value,
        })),
        '-',
      ]
    : [];
  const view: MenuEntry[] = p.canClientView
    ? [
        p.clientView
          ? {
              label: 'Leave Client view',
              desc: 'Back to every thread',
              value: 'clientView',
              icon: 'log-out-01',
            }
          : {
              label: 'Client view',
              desc: 'See comments as a client does',
              value: 'clientView',
              icon: 'briefcase-01',
            },
      ]
    : [];
  return [...filter, ...view];
}

function moreItems(resolved: boolean, resolvedCount: number, canManagePeople: boolean): MenuEntry[] {
  return [
    {
      label: resolved ? 'Hide resolved' : 'Show resolved',
      desc: resolvedCount ? `${resolvedCount} on this prototype` : 'Nothing resolved yet',
      value: 'resolved',
      icon: 'check-circle',
      disabled: !resolvedCount && !resolved,
    },
    ...(canManagePeople
      ? [{ label: 'People', desc: 'Who can comment', value: 'people', icon: 'users-01' as const }]
      : []),
    { label: 'Hide comments', desc: 'Tuck the button into the edge', value: 'hide', icon: 'chevron-right' },
  ];
}

/** A view that is not the usual one, said plainly over the bar, with the one action back. */
function ViewNote({
  icon,
  text,
  action,
  onAction,
}: {
  icon: 'briefcase-01' | 'filter-lines';
  text: string;
  action: string;
  onAction: () => void;
}) {
  return (
    <p className="rv-alert rv-viewing">
      <Icon name={icon} size={14} />
      <span>{text}</span>
      <Button kind="tertiary" size={null} className="rv-act" label={action} onClick={onAction} />
    </p>
  );
}

function Alert({ error, onDismiss }: { error: string; onDismiss: () => void }) {
  return (
    <p className="rv-alert" role="alert">
      <span>{error}</span>
      <Button kind="tertiary" size={null} className="rv-act" label="Dismiss" onClick={onDismiss} />
    </p>
  );
}

const SCOPES: { value: Scope; label: string; icon: 'target-04' | 'file-06'; title: string }[] = [
  { value: 'pin', label: 'Pin', icon: 'target-04', title: `${VERB} anything to comment on it` },
  { value: 'page', label: 'Page', icon: 'file-06', title: 'Comment on the whole page' },
];

/** Pin a comment to part of the page, or leave one on the page as a whole. */
function Toggle({ scope, onScope }: Pick<Props, 'scope' | 'onScope'>) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and a legend the bar does not want
    <div className="rv-toggle" role="group" aria-label="Comment on">
      {SCOPES.map((s) => (
        <button
          key={s.value}
          type="button"
          aria-pressed={scope === s.value}
          title={s.title}
          onClick={() => onScope(s.value)}
        >
          <Icon name={s.icon} size={16} />
          <span className="rv-toggle-label">{s.label}</span>
        </button>
      ))}
    </div>
  );
}

/** ‹ 2 open › with nothing open, ‹ 1 of 2 › with one: the arrows step straight to a thread. */
function Stepper({ count, index, resolved, onStep }: Pick<Props, 'count' | 'index' | 'resolved' | 'onStep'>) {
  const label = index < 0 ? `${count} ${resolved ? 'in all' : 'open'}` : `${index + 1} of ${count}`;
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and a legend the bar does not want
    <div className="rv-bar-group rv-stepper" role="group" aria-label="Comments on this prototype">
      <Button
        kind="tertiary"
        size={null}
        icon="chevron-left"
        iconSize={16}
        aria-label="Previous comment"
        disabled={!count}
        onClick={() => onStep(-1)}
      />
      <span className="rv-stepper-count tabular" aria-live="polite">
        {label}
      </span>
      <Button
        kind="tertiary"
        size={null}
        icon="chevron-right"
        iconSize={16}
        aria-label="Next comment"
        disabled={!count}
        onClick={() => onStep(1)}
      />
    </div>
  );
}

export function Bar(p: Props) {
  const actions: Record<string, () => void> = {
    resolved: p.onResolved,
    people: p.onPeople,
    hide: p.onHide,
    clientView: () => p.onClientView(!p.clientView),
    'filter:all': () => p.onFilter('all'),
    'filter:internal': () => p.onFilter('internal'),
    'filter:client': () => p.onFilter('client'),
  };
  const more = useMenu({
    className: 'rv-menu',
    label: 'Comment options',
    width: 264,
    align: 'end',
    items: [...audienceItems(p), ...moreItems(p.resolved, p.resolvedCount, p.canManagePeople)],
    onSelect: (v) => actions[v ?? '']?.(),
  });
  return (
    <div className="rv-bar-stack">
      {p.clientView && (
        <ViewNote
          icon="briefcase-01"
          text="Client view: comments as a client sees them"
          action="Leave"
          onAction={() => p.onClientView(false)}
        />
      )}
      {p.filterNote && (
        <ViewNote
          icon="filter-lines"
          text={p.filterNote}
          action="Show all"
          onAction={() => p.onFilter('all')}
        />
      )}
      {p.error && <Alert error={p.error} onDismiss={p.onDismissError} />}
      <section className="rv-bar" aria-label="Comment mode">
        <Toggle scope={p.scope} onScope={p.onScope} />
        <span className="rv-bar-rule" aria-hidden="true" />
        <Stepper count={p.count} index={p.index} resolved={p.resolved} onStep={p.onStep} />
        <span className="rv-bar-rule" aria-hidden="true" />
        <div className="rv-bar-group">
          <Button
            kind="tertiary"
            size={null}
            icon="dots-horizontal"
            iconSize={16}
            aria-label="Comment options"
            {...more.triggerProps}
          />
          {more.menu}
          <Button
            kind="tertiary"
            size={null}
            icon="x-close"
            iconSize={16}
            aria-label="Stop commenting"
            title="Stop commenting (Esc)"
            onClick={p.onDone}
          />
        </div>
      </section>
    </div>
  );
}
