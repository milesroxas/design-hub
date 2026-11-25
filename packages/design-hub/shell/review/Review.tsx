// The review layer on a deployed prototype. One round button turns comment
// mode on: pins appear, a click anywhere starts a comment, and a pin opens its
// thread in a card beside it. Off, the page carries only the button. It is
// harness, not product: it wears the harness material and never borrows the
// prototype's chrome. One file per part; this one holds the state and wires them.
import { useStoredState } from '@kit/hooks';
import { areCommentsHidden, setCommentsHidden } from '@kit/prefs';
import { Button } from '@kit/ui';
import { type Dispatch, useEffect, useMemo, useReducer, useState } from 'react';
import { type Anchor, type Comment, isRoot } from '../../core/review/model';
import { can } from '../../core/review/policy';
import { captureAnchor, currentUrl, openAnchor, pinPoint, resumeAnchor } from './anchor';
import { Bar } from './Bar';
import { Card } from './Card';
import { createReviewStore, type ReviewStore, useReviewState } from './client';
import { Field } from './Field';
import { Launcher } from './Launcher';
import { People } from './People';
import { describe, draftPoint, PickLayer } from './PickLayer';
import { Pins } from './Pins';
import { DEFAULT_SPOT, isSpot, type Spot } from './snap';
import { ThreadCard } from './ThreadCard';
import {
  type Draft,
  draftOf,
  initialView,
  roundOf,
  scopeOf,
  stepTarget,
  threadOf,
  type View,
  type ViewAction,
  view,
} from './view';
import './review.css';

type Props = { prototype: string; feature: string; states: string[] };
type State = ReturnType<ReviewStore['get']>;
type Where = { prototype: string; feature: string };

/** The page's path, query and hash, kept current as hash routes change. */
function useCurrentUrl(): string {
  const [url, setUrl] = useState(currentUrl);
  useEffect(() => {
    const onRoute = () => setUrl(currentUrl());
    addEventListener('hashchange', onRoute);
    return () => removeEventListener('hashchange', onRoute);
  }, []);
  return url;
}

// Toasts land bottom-right; lift them clear of the button while it rests there.
function useToastLift(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.documentElement.style.setProperty('--toast-lift', '56px');
    return () => {
      document.documentElement.style.removeProperty('--toast-lift');
    };
  }, [active]);
}

/** Esc steps back one level, unless a menu or a text box with words in it owns the key. */
function useEscape(active: boolean, dispatch: Dispatch<ViewAction>) {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || document.querySelector('.menu.is-open')) return;
      if (e.target instanceof HTMLTextAreaElement && e.target.value) return;
      dispatch({ type: 'escape' });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [active, dispatch]);
}

/** Where the button rests, remembered per browser like the theme. */
function useSpot(): [Spot, (s: Spot) => void] {
  const [stored, setStored] = useStoredState<string>('proto:comments-spot', DEFAULT_SPOT);
  return [isSpot(stored) ? stored : DEFAULT_SPOT, setStored];
}

export function Review({ prototype, feature, states }: Props) {
  const store = useMemo(() => createReviewStore(prototype), [prototype]);
  const s = useReviewState(store);
  const [v, dispatch] = useReducer(view, undefined, () => initialView(areCommentsHidden()));
  const [spot, setSpot] = useSpot();
  const url = useCurrentUrl();

  useEffect(() => {
    void store.load();
    resumeAnchor((id) => dispatch({ type: 'open', id }));
  }, [store]);
  useEffect(() => setCommentsHidden(v.hidden), [v.hidden]);
  useEscape(v.commenting, dispatch);

  const shown = s.status === 'ready' || s.status === 'guest';
  useToastLift(shown && !v.hidden && spot === 'bottom-right');
  if (!shown) return null;

  const roots = s.comments.filter(isRoot);
  return (
    <div data-harness="review" className="rv">
      {v.commenting &&
        (s.status === 'guest' ? (
          <GuestCard onClose={() => dispatch({ type: 'stop' })} />
        ) : (
          <Commenting
            store={store}
            s={s}
            v={v}
            dispatch={dispatch}
            url={url}
            where={{ prototype, feature }}
            states={states}
            roots={roots}
          />
        ))}
      <Launcher
        hidden={v.hidden}
        commenting={v.commenting}
        openCount={roots.filter((c) => c.status === 'open').length}
        spot={spot}
        onSpot={setSpot}
        onToggle={() => dispatch({ type: v.commenting ? 'stop' : 'start' })}
        onShow={() => dispatch({ type: 'show' })}
      />
    </div>
  );
}

/** With no person behind the session, comment mode is this card and nothing else. */
function GuestCard({ onClose }: { onClose: () => void }) {
  return (
    <Card at={null} label="Comments" onDismiss={onClose}>
      <div className="rv-note">
        <strong>Comments need an invite</strong>
        <p>
          You are viewing with the shared password. Ask the team for an invite link to read and leave
          comments.
        </p>
      </div>
    </Card>
  );
}

type ModeProps = {
  store: ReviewStore;
  s: State;
  v: View;
  dispatch: Dispatch<ViewAction>;
  url: string;
  where: Where;
  states: string[];
  roots: Comment[];
};

/** Everything comment mode puts on the page: the surface, the pins, the bar and the one card. */
function Commenting({ store, s, v, dispatch, url, where, states, roots }: ModeProps) {
  const number = new Map(roots.map((c, i) => [c.id, i + 1]));
  const currentId = threadOf(v.card);
  const current = roots.find((c) => c.id === currentId);
  const round = roundOf(roots, v.resolved, currentId);
  const draft = draftOf(v.card);
  const open = (id: string) => dispatch({ type: 'open', id });
  // Opening a thread from the arrows brings its element into view; its card follows the pin.
  const step = (by: number) => {
    const next = stepTarget(round, currentId, by);
    if (!next) return;
    open(next.id);
    const target = next.anchor?.url === url ? next.anchor.target : null;
    if (target) document.querySelector(target)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  return (
    <>
      <PickLayer onPick={(d) => dispatch({ type: 'draft', draft: d })} onOpen={open} />
      <Pins
        comments={round.filter((c) => c.anchor?.url === url)}
        number={number}
        active={currentId}
        draft={draft}
        onOpen={open}
      />
      <ModeBar
        store={store}
        s={s}
        v={v}
        dispatch={dispatch}
        round={round}
        roots={roots}
        index={current ? round.indexOf(current) : -1}
        onStep={step}
      />
      {current && (
        <OpenThread
          key={current.id}
          store={store}
          s={s}
          root={current}
          round={round}
          number={number}
          url={url}
          states={states}
          open={open}
          onStep={step}
          onClose={() => dispatch({ type: 'close' })}
        />
      )}
      {draft && <DraftCard store={store} draft={draft} where={where} states={states} dispatch={dispatch} />}
      {v.card?.type === 'people' && (
        <PeopleCard store={store} s={s} onClose={() => dispatch({ type: 'close' })} />
      )}
    </>
  );
}

function PeopleCard({ store, s, onClose }: { store: ReviewStore; s: State; onClose: () => void }) {
  return (
    <Card at={null} label="People" onDismiss={onClose}>
      <header className="rv-card-head">
        <h2 className="rv-title">People</h2>
        <span className="rv-spacer" />
        <Button
          kind="tertiary"
          size={null}
          icon="x-close"
          iconSize={16}
          aria-label="Close"
          onClick={onClose}
        />
      </header>
      <People store={store} me={s.me} people={s.people} />
    </Card>
  );
}

/** Comment mode's bar, wired to the view and the store. */
function ModeBar({
  store,
  s,
  v,
  dispatch,
  round,
  roots,
  index,
  onStep,
}: Pick<ModeProps, 'store' | 's' | 'v' | 'dispatch' | 'roots'> & {
  round: Comment[];
  index: number;
  onStep: (by: number) => void;
}) {
  return (
    <Bar
      count={round.length}
      index={index}
      onStep={onStep}
      scope={scopeOf(v.card)}
      onScope={(scope) => {
        // Pressing the side already on does nothing: Pin never closes a thread you are reading.
        if (scope === scopeOf(v.card)) return;
        dispatch(
          scope === 'page' ? { type: 'draft', draft: { target: null, offset: null } } : { type: 'close' },
        );
      }}
      resolved={v.resolved}
      resolvedCount={roots.filter((c) => c.status === 'resolved').length}
      canManagePeople={can(s.me, 'people')}
      error={s.error}
      onResolved={() => dispatch({ type: 'resolved' })}
      onPeople={() => {
        dispatch({ type: 'people' });
        if (!s.people) void store.loadPeople().catch(() => {});
      }}
      onHide={() => dispatch({ type: 'hide' })}
      onDone={() => dispatch({ type: 'stop' })}
      onDismissError={store.clearError}
    />
  );
}

/** The thread card, beside its pin when the pin is on this view. */
function OpenThread({
  store,
  s,
  root,
  round,
  number,
  url,
  states,
  open,
  onStep,
  onClose,
}: {
  store: ReviewStore;
  s: State;
  root: Comment;
  round: Comment[];
  number: Map<string, number>;
  url: string;
  states: string[];
  open: (id: string) => void;
  onStep: (by: number) => void;
  onClose: () => void;
}) {
  const here = (c: Comment) => (c.anchor?.url === url ? c.anchor : null);
  const anchor = root.anchor;
  return (
    <ThreadCard
      store={store}
      me={s.me}
      root={root}
      replies={s.comments.filter((c) => c.thread === root.id && c.id !== root.id)}
      n={number.get(root.id) ?? 0}
      index={round.indexOf(root)}
      total={round.length}
      states={states}
      at={here(root) ? pinPoint(root.anchor as Anchor) : null}
      onStep={onStep}
      onClose={onClose}
      // A changed hash reaches useCurrentUrl through hashchange; the card only reopens.
      onShow={anchor ? () => openAnchor(anchor, root.id, () => open(root.id)) : undefined}
    />
  );
}

function DraftCard({
  store,
  draft,
  where,
  states,
  dispatch,
}: {
  store: ReviewStore;
  draft: Draft;
  where: Where;
  states: string[];
  dispatch: Dispatch<ViewAction>;
}) {
  return (
    <Card at={draftPoint(draft)} label="New comment" onDismiss={() => dispatch({ type: 'close' })}>
      <header className="rv-card-head">
        <h2 className="rv-title">New comment</h2>
        <span className="rv-muted rv-ellipsis">on {describe(draft.target)}</span>
        <span className="rv-spacer" />
        <Button
          kind="tertiary"
          size={null}
          icon="x-close"
          iconSize={16}
          aria-label="Close"
          onClick={() => dispatch({ type: 'close' })}
        />
      </header>
      <div className="rv-card-foot">
        <Field
          label="New comment"
          placeholder="Add a comment"
          send="Post"
          autoFocus
          onSend={async (body) => {
            const c = await store.add(body, captureAnchor(where, draft.target, draftPoint(draft)), states);
            dispatch({ type: 'open', id: c.id });
          }}
          onCancel={() => dispatch({ type: 'close' })}
        />
      </div>
    </Card>
  );
}
