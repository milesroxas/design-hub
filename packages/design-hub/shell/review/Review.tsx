// The review layer on a deployed prototype. One round button turns comment
// mode on: pins appear, a click anywhere starts a comment, and a pin opens its
// thread in a card beside it. Off, the page carries only the button. It is
// harness, not product: it wears the harness material and never borrows the
// prototype's chrome. One file per part; this one holds the state and wires them.
// What a person sees is what the server sent them: Client view asks the server
// for a Client's list, and the audience filter only narrows Studio's own.
import { useStoredState } from '@kit/hooks';
import { areCommentsHidden, isClientView, setClientView, setCommentsHidden } from '@kit/prefs';
import { Button } from '@kit/ui';
import { type Dispatch, useEffect, useMemo, useReducer, useState } from 'react';
import { type Anchor, type Audience, type Comment, isRoot } from '../../core/review/model';
import { can, viewOf } from '../../core/review/policy';
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
  filtered,
  filterNote,
  initialView,
  lensOf,
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
type Lens = ReturnType<typeof lensOf>;

/** Studio in Client view: the same person, judged by the rules as a Client, so Studio's controls step aside. */
const asClient = (s: State): State => (s.me ? { ...s, me: { ...s.me, kind: 'client' } } : s);

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

/**
 * The view, its remembered parts kept in kit/prefs, and the list loaded for
 * it: Client view asks the server for a Client's list, which for a Client
 * changes nothing.
 */
function useView(store: ReviewStore): [View, Dispatch<ViewAction>] {
  const [v, dispatch] = useReducer(view, undefined, () => initialView(areCommentsHidden(), isClientView()));
  useEffect(() => {
    resumeAnchor((id) => dispatch({ type: 'open', id }));
  }, []);
  useEffect(() => {
    void store.load(v.clientView ? 'client' : undefined);
  }, [store, v.clientView]);
  useEffect(() => setCommentsHidden(v.hidden), [v.hidden]);
  useEffect(() => setClientView(v.clientView), [v.clientView]);
  useEscape(v.commenting, dispatch);
  return [v, dispatch];
}

export function Review({ prototype, feature, states }: Props) {
  const store = useMemo(() => createReviewStore(prototype), [prototype]);
  const s = useReviewState(store);
  const [v, dispatch] = useView(store);
  const [spot, setSpot] = useSpot();
  const url = useCurrentUrl();

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
        // Every open thread the person was sent, never the filtered list: a narrowed filter cannot hide one.
        openCount={roots.filter((c) => c.status === 'open').length}
        spot={spot}
        onSpot={setSpot}
        onToggle={() => dispatch({ type: v.commenting ? 'stop' : 'start' })}
        onShow={() => dispatch({ type: 'show' })}
      />
    </div>
  );
}

/**
 * The session ended after the page loaded (a revoke, a sign out everywhere,
 * or the end of their access): comment mode is this card and nothing else.
 */
function GuestCard({ onClose }: { onClose: () => void }) {
  return (
    <Card at={null} label="Comments" onDismiss={onClose}>
      <div className="rv-note">
        <strong>You are signed out</strong>
        <p>Ask the studio for a new link to read and leave comments.</p>
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
function Commenting({ store, s: real, v, dispatch, url, where, states, roots }: ModeProps) {
  const lens = lensOf(viewOf(real.me) === 'studio', v);
  const s = lens.clientView ? asClient(real) : real;
  const currentId = threadOf(v.card);
  const current = roots.find((c) => c.id === currentId);
  const shown = filtered(roots, v);
  const round = roundOf(shown, v.resolved, currentId);
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
        active={currentId}
        draft={draft}
        onOpen={open}
      />
      <ModeBar
        store={store}
        s={s}
        lens={lens}
        v={v}
        dispatch={dispatch}
        round={round}
        roots={shown}
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
          mark={lens.asStudio}
          url={url}
          states={states}
          open={open}
          onStep={step}
          onClose={() => dispatch({ type: 'close' })}
        />
      )}
      {draft && (
        <DraftCard
          store={store}
          draft={draft}
          where={where}
          states={states}
          audience={draftAudience(lens)}
          dispatch={dispatch}
        />
      )}
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
      <People store={store} me={s.me} people={s.people} access={s.access} />
    </Card>
  );
}

/** Comment mode's bar, wired to the view and the store. */
function ModeBar({
  store,
  s,
  lens,
  v,
  dispatch,
  round,
  roots,
  index,
  onStep,
}: Pick<ModeProps, 'store' | 's' | 'v' | 'dispatch' | 'roots'> & {
  lens: Lens;
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
      canFilter={lens.asStudio}
      filter={v.filter}
      filterNote={filterNote(v)}
      onFilter={(filter) => dispatch({ type: 'filter', filter })}
      canClientView={lens.asStudio || lens.clientView}
      clientView={lens.clientView}
      onClientView={(on) => dispatch({ type: 'clientView', on })}
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
  mark,
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
  mark: boolean;
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
      mark={mark}
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

/**
 * Who a new thread is for. Studio chooses, internal first. In Client view it
 * is client-facing, as a Client's would be. A Client sends none: the server
 * makes theirs client-facing.
 */
type DraftAudience = 'choose' | 'client' | null;
const draftAudience = (lens: Lens): DraftAudience => {
  if (lens.asStudio) return 'choose';
  return lens.clientView ? 'client' : null;
};

const AUDIENCES: { value: Audience; label: string; title: string }[] = [
  { value: 'internal', label: 'Internal', title: 'Only Studio sees it' },
  { value: 'client', label: 'Client-facing', title: 'Everyone sees it, the client included' },
];

/** Studio's choice on a new thread, in the head beside the title. Fixed once posted: to tell the client later, write a new one. */
function AudienceChoice({ value, onChange }: { value: Audience; onChange: (a: Audience) => void }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: a fieldset brings a border and a legend the card does not want
    <div className="rv-toggle rv-audience" role="group" aria-label="Who sees it">
      {AUDIENCES.map((a) => (
        <button
          key={a.value}
          type="button"
          aria-pressed={value === a.value}
          title={a.title}
          onClick={() => onChange(a.value)}
        >
          {a.label}
        </button>
      ))}
    </div>
  );
}

function DraftCard({
  store,
  draft,
  where,
  states,
  audience,
  dispatch,
}: {
  store: ReviewStore;
  draft: Draft;
  where: Where;
  states: string[];
  audience: DraftAudience;
  dispatch: Dispatch<ViewAction>;
}) {
  const [chosen, setChosen] = useState<Audience>('internal');
  const sent = audience === 'choose' ? chosen : audience;
  return (
    // The highlight shows sighted people what it is on; the label tells everyone else.
    <Card
      at={draftPoint(draft)}
      label={`New comment on ${describe(draft.target)}`}
      onDismiss={() => dispatch({ type: 'close' })}
    >
      <header className="rv-card-head">
        <h2 className="rv-title">New comment</h2>
        {audience === 'choose' && <AudienceChoice value={chosen} onChange={setChosen} />}
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
            const anchor = captureAnchor(where, draft.target, draftPoint(draft));
            const c = await store.add(body, anchor, states, sent);
            dispatch({ type: 'open', id: c.id });
          }}
          onCancel={() => dispatch({ type: 'close' })}
        />
      </div>
    </Card>
  );
}
