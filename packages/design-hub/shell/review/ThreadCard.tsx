// One thread in a card beside its pin. Reading and replying are the job, so
// the reply box owns the foot at full width; the thread's one decision,
// Resolve, sits in the head beside what the comment is on. Kind and state
// show as tags once set and are changed from ⋯. A resolved thread wears a
// check, a band naming who resolved it, and Reopen where Resolve was. Studio
// also sees who the thread is for, Internal or Client-facing, as a quiet mark
// in the head; a Client sees no such words.
import { Icon } from '@kit/Icon';
import { Button, type MenuEntry, useMenu } from '@kit/ui';
import { type KeyboardEvent, useEffect, useState } from 'react';
import { type Audience, type Comment, KINDS, type Kind, LIMITS, threadLabel } from '../../core/review/model';
import { can } from '../../core/review/policy';
import { Action, Card } from './Card';
import { act, type Me, type ReviewStore } from './client';
import { Field, useTextBox } from './Field';

const KIND_LABEL: Record<Kind, string> = { bug: 'Bug', taste: 'Taste', copy: 'Copy' };
const AUDIENCE_LABEL: Record<Audience, string> = { internal: 'Internal', client: 'Client-facing' };
const relative = new Intl.RelativeTimeFormat('en', { numeric: 'auto', style: 'short' });
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

function Avatar({ name }: { name: string }) {
  const initials = name
    .split(/[\s-]+/)
    .filter(Boolean)
    .map((w) => w[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();
  return (
    <span className="rv-avatar" aria-hidden="true">
      {initials}
    </span>
  );
}

/** Editing in place: the words stay where they were, in a quiet field, with Cancel and Save under them. */
function EditBox({
  initial,
  onSave,
  onCancel,
}: {
  initial: string;
  onSave: (body: string) => Promise<unknown>;
  onCancel: () => void;
}) {
  const { body, setBody, busy, setBusy, area } = useTextBox(initial, 200);
  useEffect(() => {
    const a = area.current;
    if (!a || !matchMedia('(pointer: fine)').matches) return;
    a.focus();
    a.setSelectionRange(a.value.length, a.value.length);
  }, [area]);
  const save = async () => {
    const next = body.trim();
    if (!next || busy) return;
    if (next === initial.trim()) return onCancel();
    setBusy(true);
    try {
      await onSave(next);
    } catch {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      onCancel();
    } else if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void save();
    }
  };
  return (
    <div className="rv-edit-box">
      <textarea
        ref={area}
        rows={1}
        value={body}
        maxLength={LIMITS.body}
        aria-label="Edit comment"
        enterKeyHint="done"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
      />
      <div className="rv-edit-actions">
        <Button kind="tertiary" size={null} label="Cancel" onClick={onCancel} />
        <Button
          kind="primary"
          size={null}
          label="Save"
          busy={busy}
          disabled={!body.trim()}
          onClick={() => void save()}
        />
      </div>
    </div>
  );
}

function EntryHead({ comment, canEdit, onEdit }: { comment: Comment; canEdit: boolean; onEdit: () => void }) {
  return (
    <header className="rv-msg-head">
      <strong>{comment.author.name}</strong>
      <time className="rv-muted" dateTime={comment.createdAt}>
        {ago(comment.createdAt)}
        {comment.editedAt && ' · edited'}
      </time>
      {canEdit && (
        <Button
          kind="tertiary"
          size={null}
          className="rv-act rv-edit"
          icon="edit-02"
          iconSize={14}
          aria-label="Edit comment"
          title="Edit"
          onClick={onEdit}
        />
      )}
    </header>
  );
}

function Tags({ tags }: { tags: string[] }) {
  if (!tags.length) return null;
  return (
    <div className="rv-tags">
      {tags.map((t) => (
        <span key={t} className="rv-tag">
          {t}
        </span>
      ))}
    </div>
  );
}

function Entry({
  store,
  me,
  root,
  comment,
  tags = [],
}: {
  store: ReviewStore;
  me: Me | null;
  root: Comment;
  comment: Comment;
  tags?: string[];
}) {
  const [editing, setEditing] = useState(false);
  return (
    <article className="rv-msg" data-editing={editing ? '' : undefined}>
      <Avatar name={comment.author.name} />
      <div className="rv-msg-main">
        <EntryHead
          comment={comment}
          canEdit={can(me, 'edit', root, comment) && !editing}
          onEdit={() => setEditing(true)}
        />
        {editing ? (
          <EditBox
            initial={comment.body}
            onSave={async (body) => {
              await store.edit(comment.id, body);
              setEditing(false);
            }}
            onCancel={() => setEditing(false)}
          />
        ) : (
          <>
            <p className="rv-text">{comment.body}</p>
            <Tags tags={tags} />
          </>
        )}
      </div>
    </article>
  );
}

/** The kind and state a thread carries, as words. */
function tagsOf(root: Comment): string[] {
  const { kind = null, state = null } = root.triage ?? {};
  return [kind && KIND_LABEL[kind], state].filter((t): t is string => !!t);
}

type TriageChange = { kind: string | null; state: string | null };

/** Kind and state as checked choices, for Studio; then the thread's rarer actions. */
function menuItems(
  root: Comment,
  states: string[],
  canTriage: boolean,
  canDelete: boolean,
  show: boolean,
): MenuEntry[] {
  const { kind = null, state = null } = root.triage ?? {};
  const stateItems: MenuEntry[] = states.length
    ? [{ heading: 'State' }, ...states.map((s) => ({ label: s, value: `state:${s}`, checked: state === s }))]
    : [];
  const triage: MenuEntry[] = canTriage
    ? [
        { heading: 'Kind' },
        ...KINDS.map((k) => ({ label: KIND_LABEL[k], value: `kind:${k}`, checked: kind === k })),
        ...stateItems,
        '-',
      ]
    : [];
  return [
    ...triage,
    ...(show ? [{ label: 'Show its state', value: 'show', icon: 'clock-rewind' as const }] : []),
    ...(canDelete
      ? [{ label: 'Delete thread', value: 'delete', icon: 'trash-01' as const, danger: true }]
      : []),
  ];
}

/** Picking the checked choice again clears it. */
function triageAfter(root: Comment, value: string): TriageChange {
  const { kind = null, state = null } = root.triage ?? {};
  const at = value.indexOf(':');
  const field = value.slice(0, at);
  const choice = value.slice(at + 1);
  if (field === 'kind') return { kind: kind === choice ? null : choice, state };
  return { kind, state: state === choice ? null : choice };
}

function ThreadMenu({
  store,
  root,
  states,
  canTriage,
  canDelete,
  onShow,
  onDelete,
}: {
  store: ReviewStore;
  root: Comment;
  states: string[];
  canTriage: boolean;
  canDelete: boolean;
  onShow?: () => void;
  onDelete: () => void;
}) {
  const items = menuItems(root, states, canTriage, canDelete, !!onShow);
  const menu = useMenu({
    className: 'rv-menu',
    label: 'Thread options',
    width: 220,
    items,
    onSelect: (v) => {
      if (v === 'show') onShow?.();
      else if (v === 'delete') onDelete();
      else if (v) act(store.triage(root.id, triageAfter(root, v), states));
    },
  });
  if (!items.length) return null;
  return (
    <>
      <Button
        kind="tertiary"
        size={null}
        icon="dots-horizontal"
        iconSize={16}
        aria-label="Thread options"
        {...menu.triggerProps}
      />
      {menu.menu}
    </>
  );
}

/** The thread's one decision, in its head: Resolve while open, Reopen once resolved. */
function ResolveButton({ store, root }: { store: ReviewStore; root: Comment }) {
  const open = root.status === 'open';
  return (
    <Button
      kind="tertiary"
      size={null}
      className={open ? 'rv-resolve' : 'rv-resolve is-done'}
      icon={open ? 'check' : 'refresh-cw-01'}
      iconSize={open ? 16 : 14}
      label={open ? 'Resolve' : 'Reopen'}
      onClick={() => act(store.resolve(root.id, open))}
    />
  );
}

function Stepper({ index, total, onStep }: { index: number; total: number; onStep: (by: number) => void }) {
  return (
    // The bar steps through threads; on a phone it steps aside for the sheet, so the sheet carries the arrows.
    <span className="rv-card-step">
      <Button
        kind="tertiary"
        size={null}
        icon="chevron-left"
        iconSize={16}
        aria-label="Previous comment"
        disabled={total < 2}
        onClick={() => onStep(-1)}
      />
      <span className="rv-muted rv-step tabular">
        {index + 1}/{total}
      </span>
      <Button
        kind="tertiary"
        size={null}
        icon="chevron-right"
        iconSize={16}
        aria-label="Next comment"
        disabled={total < 2}
        onClick={() => onStep(1)}
      />
    </span>
  );
}

function Foot({
  store,
  root,
  confirming,
  onKeep,
}: {
  store: ReviewStore;
  root: Comment;
  confirming: boolean;
  onKeep: () => void;
}) {
  if (confirming)
    return (
      <div className="rv-card-foot rv-confirm" role="alert">
        <span>Delete this thread and its replies?</span>
        <Action label="Cancel" onClick={onKeep} />
        <Button kind="primary-error" size={null} label="Delete" onClick={() => act(store.remove(root.id))} />
      </div>
    );
  if (root.status === 'resolved') return null;
  return (
    <div className="rv-card-foot">
      <Field
        label={`Reply to ${root.author.name}`}
        placeholder="Reply"
        send="Reply"
        autoFocus
        onSend={(body) => store.reply(root.id, body)}
      />
    </div>
  );
}

function ResolvedBand({ root }: { root: Comment }) {
  if (root.status !== 'resolved') return null;
  return (
    <p className="rv-band">
      <Icon name="check-circle" size={14} />
      Resolved{root.resolvedBy ? ` by ${root.resolvedBy.name}` : ''}
    </p>
  );
}

type HeadProps = {
  store: ReviewStore;
  root: Comment;
  /** Show who the thread is for: Studio only, and not in Client view. */
  mark: boolean;
  index: number;
  total: number;
  states: string[];
  canResolve: boolean;
  canTriage: boolean;
  canDelete: boolean;
  onStep: (by: number) => void;
  onClose: () => void;
  onShow?: () => void;
  onDelete: () => void;
};

/** Its number and who it is for, then its one decision and the rest. The pin beside the card already shows what it is on. */
function ThreadHead({
  store,
  root,
  mark,
  index,
  total,
  states,
  canResolve,
  canTriage,
  canDelete,
  onStep,
  onClose,
  onShow,
  onDelete,
}: HeadProps) {
  return (
    <header className="rv-card-head">
      <span className="rv-no" data-audience={root.audience} aria-hidden="true">
        {root.status === 'resolved' ? <Icon name="check" size={12} /> : root.number || null}
      </span>
      {mark && (
        <span className="rv-aud" data-audience={root.audience}>
          {AUDIENCE_LABEL[root.audience]}
        </span>
      )}
      <span className="rv-spacer" />
      <Stepper index={index} total={total} onStep={onStep} />
      {canResolve && <ResolveButton store={store} root={root} />}
      <ThreadMenu
        store={store}
        root={root}
        states={states}
        canTriage={canTriage}
        canDelete={canDelete}
        onShow={onShow}
        onDelete={onDelete}
      />
      <Button
        kind="tertiary"
        size={null}
        icon="x-close"
        iconSize={16}
        aria-label="Close comment"
        onClick={onClose}
      />
    </header>
  );
}

export function ThreadCard({
  store,
  me,
  root,
  replies,
  mark,
  index,
  total,
  states,
  at,
  onStep,
  onClose,
  onShow,
}: {
  store: ReviewStore;
  me: Me | null;
  root: Comment;
  replies: Comment[];
  mark: boolean;
  index: number;
  total: number;
  states: string[];
  at: { x: number; y: number } | null;
  onStep: (by: number) => void;
  onClose: () => void;
  onShow?: () => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const resolved = root.status === 'resolved';
  const label = threadLabel(root);
  const words = [label ? `Comment ${label}` : 'Comment', mark && AUDIENCE_LABEL[root.audience]];
  return (
    <Card
      at={at}
      label={[...words, resolved && 'resolved'].filter(Boolean).join(', ')}
      resolved={resolved}
      onDismiss={onClose}
    >
      <ThreadHead
        store={store}
        root={root}
        mark={mark}
        index={index}
        total={total}
        states={states}
        canResolve={can(me, 'resolve', root)}
        canTriage={can(me, 'triage', root)}
        canDelete={can(me, 'delete', root)}
        onStep={onStep}
        onClose={onClose}
        onShow={onShow}
        onDelete={() => setConfirming(true)}
      />
      <ResolvedBand root={root} />
      <div className="rv-card-body">
        <Entry store={store} me={me} root={root} comment={root} tags={tagsOf(root)} />
        {replies.map((r) => (
          <Entry key={r.id} store={store} me={me} root={root} comment={r} />
        ))}
      </div>
      <Foot store={store} root={root} confirming={confirming} onKeep={() => setConfirming(false)} />
    </Card>
  );
}
