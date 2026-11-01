// The review layer on a deployed prototype: a Comments button, a side panel
// with the threads for this prototype, pins on the elements they are about,
// and, for editors, the people who may comment. It is harness, not product:
// it wears the harness material and never borrows the prototype's chrome.
import { Icon } from '@kit/Icon';
import {
  type FormEvent,
  type KeyboardEvent,
  type RefObject,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
} from 'react';
import {
  type Anchor,
  type Comment,
  INVITE_DAYS,
  KINDS,
  type Kind,
  LIMITS,
  type Role,
} from '../../core/review/model';
import { captureAnchor, currentUrl, isHarness, openAnchor, pinPoint, resumeAnchor } from './anchor';
import { createReviewStore, type Me, type ReviewStore, useReviewState } from './client';
import './review.css';

type Props = { prototype: string; feature: string; states: string[] };
type Draft = { target: Element | null; point: { x: number; y: number } | null };

const KIND_LABEL: Record<Kind, string> = { bug: 'Bug', taste: 'Taste', copy: 'Copy' };
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const STEPS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31_536_000],
  ['month', 2_592_000],
  ['week', 604_800],
  ['day', 86_400],
  ['hour', 3600],
  ['minute', 60],
];
function ago(iso: string): string {
  const seconds = (Date.parse(iso) - Date.now()) / 1000;
  for (const [unit, size] of STEPS)
    if (Math.abs(seconds) >= size) return relative.format(Math.round(seconds / size), unit);
  return 'just now';
}

const describe = (el: Element | null) => {
  if (!el) return 'the whole page';
  const text = (el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ');
  return text ? `“${text.length > 40 ? `${text.slice(0, 40)}…` : text}”` : `a ${el.localName} element`;
};

// The store shows every failure in the panel, so a click handler has nothing left to do with one.
const act = (pending: Promise<unknown>) => void pending.catch(() => {});

const submitOnModEnter = (e: KeyboardEvent<HTMLTextAreaElement>) => {
  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
    e.preventDefault();
    e.currentTarget.form?.requestSubmit();
  }
};

/**
 * What the layer shows: closed, the panel, or the page while an element is
 * being picked. One reducer, so a transition (pick, back to the panel, close)
 * changes every field it touches at once and no two fields can disagree.
 */
type View = { mode: 'closed' | 'panel' | 'picking'; tab: Tab; draft: Draft | null; focus: string | null };
type ViewAction =
  | { type: 'open'; focus?: string }
  | { type: 'close' }
  | { type: 'pick' }
  | { type: 'picked'; draft: Draft | null }
  | { type: 'tab'; tab: Tab }
  | { type: 'drafted' };

function view(state: View, action: ViewAction): View {
  switch (action.type) {
    case 'open':
      return { ...state, mode: 'panel', focus: action.focus ?? state.focus };
    case 'close':
      return { ...state, mode: 'closed', draft: null };
    case 'pick':
      return { ...state, mode: 'picking' };
    case 'picked':
      return { ...state, mode: 'panel', draft: action.draft };
    case 'tab':
      return { ...state, tab: action.tab };
    case 'drafted':
      return { ...state, draft: null };
  }
}

const INITIAL_VIEW: View = { mode: 'closed', tab: 'comments', draft: null, focus: null };

export function Review({ prototype, feature, states }: Props) {
  const store = useMemo(() => createReviewStore(prototype), [prototype]);
  const s = useReviewState(store);
  const [v, dispatch] = useReducer(view, INITIAL_VIEW);
  const url = useCurrentUrl();

  useEffect(() => {
    void store.load();
    resumeAnchor((id) => dispatch({ type: 'open', focus: id }));
  }, [store]);

  const shown = s.status !== 'off' && s.status !== 'loading';
  useToastLift(shown);
  if (!shown) return null;

  const close = () => dispatch({ type: 'close' });
  const roots = s.comments.filter((c) => c.thread === c.id);
  const number = new Map(roots.map((c, i) => [c.id, i + 1]));

  return (
    <div data-harness="review" className="rv">
      {v.mode === 'picking' ? (
        <PickLayer
          onPick={(target, point) => dispatch({ type: 'picked', draft: { target, point } })}
          onPage={() => dispatch({ type: 'picked', draft: { target: null, point: null } })}
          onCancel={() => dispatch({ type: 'picked', draft: null })}
        />
      ) : (
        <Launcher
          open={v.mode === 'panel'}
          openCount={roots.filter((c) => c.status === 'open').length}
          onClick={() => (v.mode === 'panel' ? close() : dispatch({ type: 'open' }))}
        />
      )}
      {s.status === 'ready' && (
        <Pins
          comments={roots.filter((c) => c.status === 'open' && c.anchor?.url === url)}
          number={number}
          draft={v.draft}
          onOpen={(id) => dispatch({ type: 'open', focus: id })}
        />
      )}
      {v.mode === 'panel' && (
        <Panel
          store={store}
          state={s}
          tab={s.me?.role === 'editor' ? v.tab : null}
          onTab={(tab) => {
            dispatch({ type: 'tab', tab });
            if (tab === 'people' && !s.people) act(store.loadPeople());
          }}
          onClose={close}
          threads={{
            store,
            me: s.me,
            roots,
            replies: s.comments.filter((c) => c.thread !== c.id),
            number,
            states,
            focus: v.focus,
            draft: v.draft,
            onNew: () => dispatch({ type: 'pick' }),
            onCancelDraft: () => dispatch({ type: 'drafted' }),
            onPost: async (body) => {
              const { target = null, point = null } = v.draft ?? {};
              await store.add(body, captureAnchor({ prototype, feature }, target, point), states);
              dispatch({ type: 'drafted' });
            },
            // A changed hash reaches useCurrentUrl through hashchange; the panel only moves its focus.
            onShow: (anchor, id) => openAnchor(anchor, id, () => dispatch({ type: 'open', focus: id })),
          }}
        />
      )}
    </div>
  );
}

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

// The launcher sits where toasts land; lift them above it while it is on the page.
function useToastLift(active: boolean) {
  useEffect(() => {
    if (!active) return;
    document.documentElement.style.setProperty('--toast-lift', '56px');
    return () => {
      document.documentElement.style.removeProperty('--toast-lift');
    };
  }, [active]);
}

/** Focuses the panel's first autofocus control, preferring the body's, whenever `when` turns true. */
function useAutofocus(panel: RefObject<HTMLElement | null>, when: boolean) {
  useEffect(() => {
    if (!when) return;
    const p = panel.current;
    (
      p?.querySelector<HTMLElement>('.rv-body [data-autofocus]') ??
      p?.querySelector<HTMLElement>('[data-autofocus]')
    )?.focus();
  }, [panel, when]);
}

type Tab = 'comments' | 'people';

function Launcher({ open, openCount, onClick }: { open: boolean; openCount: number; onClick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const wasOpen = useRef(open);
  // Closing the panel hands focus back to the button that opened it.
  useEffect(() => {
    if (wasOpen.current && !open) ref.current?.focus();
    wasOpen.current = open;
  }, [open]);
  return (
    <button
      ref={ref}
      type="button"
      className="rv-launch"
      aria-expanded={open}
      aria-controls="rv-panel"
      onClick={onClick}
    >
      <Icon name="message-text-square-01" size={16} />
      <span>Comments</span>
      {openCount > 0 && (
        <span className="rv-count">
          {openCount}
          <span className="rv-sr"> open</span>
        </span>
      )}
    </button>
  );
}

/** Tabs for an editor (tab is set), a plain title for everyone else (tab is null). */
function PanelHead({
  tab,
  onTab,
  onClose,
}: {
  tab: Tab | null;
  onTab: (t: Tab) => void;
  onClose: () => void;
}) {
  return (
    <header className="rv-head">
      {tab ? (
        <div className="rv-tabs" role="tablist" aria-label="Review">
          {(['comments', 'people'] as const).map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              data-autofocus={tab === t ? '' : undefined}
              onClick={() => onTab(t)}
            >
              {t === 'comments' ? 'Comments' : 'People'}
            </button>
          ))}
        </div>
      ) : (
        <h2 className="rv-title">Comments</h2>
      )}
      <button
        type="button"
        className="rv-icon"
        aria-label="Close review"
        onClick={onClose}
        data-autofocus={tab ? undefined : ''}
      >
        <Icon name="x-close" size={16} />
      </button>
    </header>
  );
}

type ThreadsProps = Parameters<typeof Threads>[0];

function Panel({
  store,
  state,
  tab,
  onTab,
  onClose,
  threads,
}: {
  store: ReviewStore;
  state: ReturnType<ReviewStore['get']>;
  tab: Tab | null;
  onTab: (t: Tab) => void;
  onClose: () => void;
  threads: ThreadsProps;
}) {
  const ref = useRef<HTMLElement>(null);
  // The panel mounts again after every pick, so focus goes into it each time; a draft focuses its own text box.
  useAutofocus(ref, !threads.draft);
  return (
    <aside
      id="rv-panel"
      ref={ref}
      className="rv-panel"
      aria-label="Review"
      onKeyDown={(e) => {
        // Esc closes the panel, except from a text box with words in it, where it would lose them.
        if (e.key === 'Escape' && !(e.target instanceof HTMLTextAreaElement && e.target.value)) onClose();
      }}
    >
      <PanelHead tab={tab} onTab={onTab} onClose={onClose} />
      {state.error && (
        <p className="rv-error" role="alert">
          {state.error}
          <button type="button" className="rv-link" onClick={store.clearError}>
            Dismiss
          </button>
        </p>
      )}
      {state.status === 'guest' ? (
        <p className="rv-empty">
          You are viewing with the shared password. Ask the team for an invite link to read and leave
          comments.
        </p>
      ) : tab === 'people' ? (
        <People store={store} me={state.me} people={state.people} />
      ) : (
        <Threads {...threads} />
      )}
    </aside>
  );
}

function PickLayer({
  onPick,
  onPage,
  onCancel,
}: {
  onPick: (target: Element, point: { x: number; y: number }) => void;
  onPage: () => void;
  onCancel: () => void;
}) {
  const box = useRef<HTMLDivElement>(null);
  const pageButton = useRef<HTMLButtonElement>(null);
  const under = (x: number, y: number) =>
    document
      .elementsFromPoint(x, y)
      .find((el) => !isHarness(el) && el !== document.body && el !== document.documentElement) ?? null;

  useEffect(() => {
    pageButton.current?.focus();
    const onKey = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && onCancel();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: a pointer-only picking surface; the bar's buttons are the keyboard path */}
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: as above, the keyboard picks "The whole page" in the bar */}
      <div
        className="rv-pick"
        onPointerMove={(e) => {
          const el = under(e.clientX, e.clientY);
          const b = box.current;
          if (!b) return;
          if (!el) {
            b.hidden = true;
            return;
          }
          const r = el.getBoundingClientRect();
          b.hidden = false;
          b.style.transform = `translate(${r.left}px, ${r.top}px)`;
          b.style.width = `${r.width}px`;
          b.style.height = `${r.height}px`;
        }}
        onClick={(e) => {
          const el = under(e.clientX, e.clientY);
          if (el) onPick(el, { x: e.clientX, y: e.clientY });
        }}
      />
      <div ref={box} className="rv-pick-box" hidden />
      <section className="rv-pick-bar" aria-label="Choose what to comment on">
        <span>Click the element your comment is about.</span>
        <button ref={pageButton} type="button" className="rv-button" onClick={onPage}>
          The whole page
        </button>
        <button type="button" className="rv-link" onClick={onCancel}>
          Cancel
        </button>
      </section>
    </>
  );
}

function Pins({
  comments,
  number,
  draft,
  onOpen,
}: {
  comments: Comment[];
  number: Map<string, number>;
  draft: Draft | null;
  onOpen: (id: string) => void;
}) {
  const layer = useRef<HTMLDivElement>(null);

  // Positions are written straight to the pins' transforms on scroll, resize
  // and DOM changes, at most once a frame, so a scroll re-renders nothing.
  useEffect(() => {
    let frame = 0;
    const place = () => {
      frame = 0;
      for (const pin of layer.current?.querySelectorAll<HTMLElement>('[data-pin]') ?? []) {
        const c = comments.find((x) => x.id === pin.dataset.pin);
        const at = c?.anchor ? pinPoint(c.anchor) : null;
        pin.hidden = !at;
        if (at) pin.style.transform = `translate(${at.x}px, ${at.y}px)`;
      }
      const d = layer.current?.querySelector<HTMLElement>('[data-draft]');
      if (d && draft?.point) d.style.transform = `translate(${draft.point.x}px, ${draft.point.y}px)`;
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(place);
    };
    place();
    const observer = new MutationObserver(schedule);
    observer.observe(document.body, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ['class', 'style', 'hidden'],
    });
    addEventListener('scroll', schedule, { capture: true, passive: true });
    addEventListener('resize', schedule);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      removeEventListener('scroll', schedule, { capture: true });
      removeEventListener('resize', schedule);
    };
  }, [comments, draft]);

  return (
    // The list in the panel is the accessible path to every comment; pins are a pointer shortcut.
    <div ref={layer} className="rv-pins" aria-hidden="true">
      {comments.map((c) => (
        <button
          key={c.id}
          type="button"
          tabIndex={-1}
          className="rv-pin"
          data-pin={c.id}
          hidden
          onClick={() => onOpen(c.id)}
        >
          {number.get(c.id)}
        </button>
      ))}
      {draft?.point && <span className="rv-pin" data-draft="" data-new="" />}
    </div>
  );
}

function Threads({
  store,
  me,
  roots,
  replies,
  number,
  states,
  focus,
  draft,
  onNew,
  onCancelDraft,
  onPost,
  onShow,
}: {
  store: ReviewStore;
  me: Me | null;
  roots: Comment[];
  replies: Comment[];
  number: Map<string, number>;
  states: string[];
  focus: string | null;
  draft: Draft | null;
  onNew: () => void;
  onCancelDraft: () => void;
  onPost: (body: string) => Promise<void>;
  onShow: (anchor: Anchor, id: string) => void;
}) {
  const [filter, setFilter] = useState<'open' | 'resolved'>('open');
  const list = roots.filter((c) => c.status === filter).reverse();
  const counts = {
    open: roots.filter((c) => c.status === 'open').length,
    resolved: roots.filter((c) => c.status === 'resolved').length,
  };

  useEffect(() => {
    if (!focus) return;
    const target = roots.find((c) => c.id === focus);
    if (target && target.status !== filter) setFilter(target.status);
    requestAnimationFrame(() => document.getElementById(`rv-${focus}`)?.scrollIntoView({ block: 'nearest' }));
  }, [focus, roots, filter]);

  return (
    <div className="rv-body">
      {draft ? (
        <Composer
          label={`New comment on ${describe(draft.target)}`}
          submit="Post"
          onSubmit={onPost}
          onCancel={onCancelDraft}
        />
      ) : (
        <button type="button" className="rv-button rv-new" onClick={onNew} data-autofocus="">
          <Icon name="plus" size={16} /> New comment
        </button>
      )}
      <fieldset className="rv-filter">
        <legend className="rv-sr">Show</legend>
        {(['open', 'resolved'] as const).map((f) => (
          <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
            {f === 'open' ? 'Open' : 'Resolved'} <span className="rv-muted">{counts[f]}</span>
          </button>
        ))}
      </fieldset>
      {list.length === 0 ? (
        <p className="rv-empty">
          {filter === 'open' ? 'No open comments on this prototype.' : 'Nothing resolved yet.'}
        </p>
      ) : (
        <ol className="rv-list">
          {list.map((c) => {
            const { anchor } = c;
            return (
              <Thread
                key={c.id}
                store={store}
                me={me}
                root={c}
                replies={replies.filter((r) => r.thread === c.id)}
                n={number.get(c.id) ?? 0}
                states={states}
                focused={focus === c.id}
                onShow={anchor ? () => onShow(anchor, c.id) : undefined}
              />
            );
          })}
        </ol>
      )}
    </div>
  );
}

type TriageChange = { kind: string | null; state: string | null };

function TriageSelect({
  label,
  empty,
  value,
  options,
  onChange,
}: {
  label: string;
  empty: string;
  value: string | null;
  options: [string, string][];
  onChange: (value: string | null) => void;
}) {
  return (
    <label className="rv-select">
      <span className="rv-sr">{label}</span>
      <select value={value ?? ''} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">{empty}</option>
        {options.map(([v, text]) => (
          <option key={v} value={v}>
            {text}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Editors correct the kind and state; everyone else reads them. */
function TriageTags({
  editor,
  triage,
  states,
  onChange,
}: {
  editor: boolean;
  triage: Comment['triage'];
  states: string[];
  onChange: (next: TriageChange) => void;
}) {
  const { kind = null, state = null } = triage ?? {};
  return (
    <div className="rv-tags">
      {editor ? (
        <>
          <TriageSelect
            label="Kind"
            empty="No kind"
            value={kind}
            options={KINDS.map((k) => [k, KIND_LABEL[k]])}
            onChange={(next) => onChange({ kind: next, state })}
          />
          {states.length > 0 && (
            <TriageSelect
              label="State"
              empty="No state"
              value={state}
              options={states.map((st) => [st, st])}
              onChange={(next) => onChange({ kind, state: next })}
            />
          )}
        </>
      ) : (
        [kind && KIND_LABEL[kind], state].filter(Boolean).map((tag) => (
          <span key={tag} className="rv-tag">
            {tag}
          </span>
        ))
      )}
      {triage?.by === 'jev' && <span className="rv-muted">sorted automatically</span>}
    </div>
  );
}

function ThreadActions({
  store,
  root,
  canClose,
  onReply,
  onShow,
}: {
  store: ReviewStore;
  root: Comment;
  canClose: boolean;
  onReply: () => void;
  onShow?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  if (confirming)
    return (
      <div className="rv-actions">
        <span>Delete the thread and its replies?</span>
        <button type="button" className="rv-link rv-danger" onClick={() => act(store.remove(root.id))}>
          Delete
        </button>
        <button type="button" className="rv-link" onClick={() => setConfirming(false)}>
          Keep
        </button>
      </div>
    );
  return (
    <div className="rv-actions">
      {onShow && (
        <button type="button" className="rv-link" onClick={onShow}>
          Show state
        </button>
      )}
      <button type="button" className="rv-link" onClick={onReply}>
        Reply
      </button>
      {canClose && (
        <>
          <button
            type="button"
            className="rv-link"
            onClick={() => act(store.resolve(root.id, root.status === 'open'))}
          >
            {root.status === 'open' ? 'Resolve' : 'Reopen'}
          </button>
          <button type="button" className="rv-link" onClick={() => setConfirming(true)}>
            Delete
          </button>
        </>
      )}
    </div>
  );
}

function Thread({
  store,
  me,
  root,
  replies,
  n,
  states,
  focused,
  onShow,
}: {
  store: ReviewStore;
  me: Me | null;
  root: Comment;
  replies: Comment[];
  n: number;
  states: string[];
  focused: boolean;
  onShow?: () => void;
}) {
  const [replying, setReplying] = useState(false);
  const editor = me?.role === 'editor';
  return (
    <li
      id={`rv-${root.id}`}
      className="rv-thread"
      data-focused={focused ? '' : undefined}
      data-resolved={root.status === 'resolved' ? '' : undefined}
    >
      <Entry store={store} me={me} comment={root} n={n} />
      <TriageTags
        editor={editor}
        triage={root.triage}
        states={states}
        onChange={(next) => act(store.triage(root.id, next, states))}
      />
      {replies.length > 0 && (
        <ol className="rv-replies">
          {replies.map((r) => (
            <li key={r.id}>
              <Entry store={store} me={me} comment={r} />
            </li>
          ))}
        </ol>
      )}
      {replying ? (
        <Composer
          label="Reply"
          submit="Reply"
          onSubmit={async (body) => {
            await store.reply(root.id, body);
            setReplying(false);
          }}
          onCancel={() => setReplying(false)}
        />
      ) : (
        <ThreadActions
          store={store}
          root={root}
          canClose={editor || me?.id === root.author.id}
          onReply={() => setReplying(true)}
          onShow={onShow}
        />
      )}
    </li>
  );
}

function Entry({
  store,
  me,
  comment,
  n,
}: {
  store: ReviewStore;
  me: Me | null;
  comment: Comment;
  n?: number;
}) {
  const [editing, setEditing] = useState(false);
  const own = me?.id === comment.author.id;
  return (
    <article className="rv-entry">
      <header>
        {n !== undefined && <span className="rv-no">{n}</span>}
        <strong>{comment.author.name}</strong>
        <span className="rv-muted">
          {comment.author.team} · <time dateTime={comment.createdAt}>{ago(comment.createdAt)}</time>
          {comment.editedAt && ' · edited'}
        </span>
        {own && !editing && (
          <button type="button" className="rv-link rv-edit" onClick={() => setEditing(true)}>
            Edit
          </button>
        )}
      </header>
      {editing ? (
        <Composer
          label="Edit comment"
          submit="Save"
          initial={comment.body}
          onSubmit={async (body) => {
            await store.edit(comment.id, body);
            setEditing(false);
          }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <p className="rv-text">{comment.body}</p>
      )}
    </article>
  );
}

function Composer({
  label,
  submit,
  initial = '',
  onSubmit,
  onCancel,
}: {
  label: string;
  submit: string;
  initial?: string;
  onSubmit: (body: string) => Promise<void>;
  onCancel: () => void;
}) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  useEffect(() => area.current?.focus(), []);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSubmit(body);
    } catch {
      // The store shows the error; the text stays so nothing typed is lost.
    } finally {
      setBusy(false);
    }
  };
  return (
    <form className="rv-composer" onSubmit={send} aria-busy={busy}>
      <label className="rv-label">
        {label}
        <textarea
          ref={area}
          value={body}
          rows={3}
          maxLength={LIMITS.body}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={submitOnModEnter}
        />
      </label>
      <div className="rv-actions">
        <button type="submit" className="rv-button" disabled={!body.trim() || busy}>
          {submit}
        </button>
        <button type="button" className="rv-link" onClick={onCancel}>
          Cancel
        </button>
        <span className="rv-muted rv-hint">⌘ Enter</span>
      </div>
    </form>
  );
}

function People({ store, me, people }: { store: ReviewStore; me: Me | null; people: Me[] | null }) {
  const [link, setLink] = useState<{ name: string; href: string } | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const linkField = useRef<HTMLInputElement>(null);
  const share = (name: string, href: string) => {
    setLink({ name, href });
    setCopied(false);
  };

  return (
    <div className="rv-body">
      <form
        className="rv-invite"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const name = String(f.get('name') ?? '');
          const form = e.currentTarget;
          act(
            store.invite(name, String(f.get('team') ?? ''), String(f.get('role')) as Role).then((href) => {
              share(name, href);
              form.reset();
            }),
          );
        }}
      >
        <label className="rv-label">
          Name
          <input name="name" required maxLength={LIMITS.name} autoComplete="off" data-autofocus="" />
        </label>
        <label className="rv-label">
          Team
          <input
            name="team"
            required
            maxLength={LIMITS.team}
            autoComplete="off"
            placeholder="Studio, or the client's company"
          />
        </label>
        <label className="rv-label">
          Role
          <select name="role" defaultValue="reviewer">
            <option value="reviewer">Reviewer: comments and replies</option>
            <option value="editor">Editor: also resolves, sorts and invites</option>
          </select>
        </label>
        <button type="submit" className="rv-button">
          Create invite link
        </button>
      </form>
      {link && (
        <div className="rv-share" role="status">
          <p>
            Send this link to {link.name}. It works for {INVITE_DAYS} days, and a new link replaces it.
          </p>
          <div className="rv-share-row">
            <input
              ref={linkField}
              readOnly
              value={link.href}
              aria-label={`Invite link for ${link.name}`}
              onFocus={(e) => e.currentTarget.select()}
            />
            <button
              type="button"
              className="rv-button"
              onClick={() =>
                navigator.clipboard.writeText(link.href).then(
                  () => setCopied(true),
                  // No clipboard access (an insecure origin, a denied permission): select the link to copy by hand.
                  () => linkField.current?.select(),
                )
              }
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
        </div>
      )}
      {people === null ? (
        <p className="rv-empty">Loading people…</p>
      ) : (
        <ul className="rv-people">
          {people.map((p) => (
            <li key={p.id} data-revoked={p.revokedAt ? '' : undefined}>
              <div>
                <strong>{p.name}</strong>
                <span className="rv-muted">
                  {p.team} · {p.role}
                  {p.revokedAt && ' · revoked'}
                </span>
              </div>
              {p.id !== me?.id && !p.revokedAt && (
                <div className="rv-actions">
                  {confirm === p.id ? (
                    <>
                      <button
                        type="button"
                        className="rv-link rv-danger"
                        onClick={() => act(store.revoke(p.id).then(() => setConfirm(null)))}
                      >
                        Revoke
                      </button>
                      <button type="button" className="rv-link" onClick={() => setConfirm(null)}>
                        Keep
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className="rv-link"
                        onClick={() => act(store.reissue(p.id).then((href) => share(p.name, href)))}
                      >
                        New link
                      </button>
                      <button type="button" className="rv-link" onClick={() => setConfirm(p.id)}>
                        Revoke
                      </button>
                    </>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
