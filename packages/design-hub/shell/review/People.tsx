// The People card, for Studio: add someone, hand over their one-time link,
// and see who can comment and until when. A link signs in one device, then
// stops working, so each row offers another link for another device, a sign
// out everywhere, a change of access length, and Revoke.
import { fmtDate } from '@kit/format';
import { Button, Select } from '@kit/ui';
import { type FormEvent, type ReactNode, useId, useRef, useState } from 'react';
import { type Access, LIMITS, LINK_DAYS, type PersonKind } from '../../core/review/model';
import { Action } from './Card';
import { act, type Me, type ReviewStore } from './client';

type Link = { name: string; href: string };

const KIND_NAMES: Record<PersonKind, string> = { studio: 'Studio', client: 'Client' };

const KIND_OPTIONS: { value: PersonKind; label: string; desc: string }[] = [
  { value: 'client', label: KIND_NAMES.client, desc: 'Comments, replies and resolves any thread' },
  {
    value: 'studio',
    label: KIND_NAMES.studio,
    desc: 'Also sorts, deletes any comment and manages people',
  },
];

const ACCESS_NAMES: Record<Access, string> = { '3m': '3 months', '6m': '6 months', open: 'Open-ended' };

const LENGTH_OPTIONS: { value: Access; label: string }[] = [
  { value: '3m', label: ACCESS_NAMES['3m'] },
  { value: '6m', label: ACCESS_NAMES['6m'] },
  { value: 'open', label: ACCESS_NAMES.open },
];

/** The add form's choices: the default for this kind first, then each length. */
function accessOptions(kind: PersonKind, projectDefault: Access | null) {
  const fallback =
    kind === 'studio' ? 'Open-ended for Studio' : `Project default: ${ACCESS_NAMES[projectDefault ?? '3m']}`;
  return [{ value: 'default', label: 'Default', desc: fallback }, ...LENGTH_OPTIONS];
}

function AddForm({
  store,
  projectDefault,
  onLink,
}: {
  store: ReviewStore;
  projectDefault: Access | null;
  onLink: (link: Link) => void;
}) {
  const [kind, setKind] = useState<PersonKind>('client');
  const [access, setAccess] = useState('default');
  const [busy, setBusy] = useState(false);
  const kindLabel = useId();
  const accessLabel = useId();
  const add = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const name = String(f.get('name') ?? '');
    setBusy(true);
    act(
      store
        .addPerson(name, String(f.get('team') ?? ''), kind, access === 'default' ? null : (access as Access))
        .then((href) => {
          onLink({ name, href });
          form.reset();
        })
        .finally(() => setBusy(false)),
    );
  };
  return (
    <form className="rv-invite" onSubmit={add}>
      <label className="field">
        <span className="field-label">Name</span>
        <input
          className="input"
          name="name"
          required
          maxLength={LIMITS.name}
          autoComplete="off"
          data-autofocus=""
        />
      </label>
      <label className="field">
        <span className="field-label">Team</span>
        <input
          className="input"
          name="team"
          required
          maxLength={LIMITS.team}
          autoComplete="off"
          placeholder="Studio, or the client’s company"
        />
      </label>
      <div className="field">
        <span id={kindLabel} className="field-label">
          Kind
        </span>
        <Select
          labelId={kindLabel}
          menuClassName="rv-menu"
          value={kind}
          options={KIND_OPTIONS}
          onChange={(next) => setKind(next as PersonKind)}
        />
      </div>
      <div className="field">
        <span id={accessLabel} className="field-label">
          Access
        </span>
        <Select
          labelId={accessLabel}
          menuClassName="rv-menu"
          value={access}
          options={accessOptions(kind, projectDefault)}
          onChange={setAccess}
        />
      </div>
      <Button type="submit" kind="primary" size={null} label="Create link" busy={busy} />
    </form>
  );
}

function ShareLink({ link }: { link: Link }) {
  const [copied, setCopied] = useState(false);
  const field = useRef<HTMLInputElement>(null);
  const copy = () =>
    navigator.clipboard.writeText(link.href).then(
      () => setCopied(true),
      // No clipboard access (an insecure origin, a denied permission): select the link to copy by hand.
      () => field.current?.select(),
    );
  return (
    <div className="rv-share" role="status">
      <p>
        Send this link to {link.name} only. It signs in one device, then stops working. Unused, it lasts{' '}
        {LINK_DAYS} days.
      </p>
      <div className="rv-share-row">
        <input
          ref={field}
          className="input"
          readOnly
          value={link.href}
          aria-label={`Sign-in link for ${link.name}`}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button size={null} className="rv-copy" label={copied ? 'Copied' : 'Copy'} onClick={copy} />
      </div>
    </div>
  );
}

/** How links behave, said once where Studio shares them. */
function HowLinksWork() {
  return (
    <p className="rv-muted rv-disclosure">
      Each person gets their own link. A link signs in one device, then stops working, so a second device
      needs a new link. An unused link lasts {LINK_DAYS} days. Revoking someone ends their access everywhere.
    </p>
  );
}

const ended = (p: Me) => p.accessEndsAt !== null && p.accessEndsAt <= new Date().toISOString();

/** When someone's access ends, as the row says it. */
function accessText(p: Me): string {
  if (p.accessEndsAt === null) return 'open-ended';
  const day = fmtDate(p.accessEndsAt.slice(0, 10));
  return ended(p) ? `access ended ${day}` : `until ${day}`;
}

type Mode = 'idle' | 'signOut' | 'revoke' | 'access';

function Confirm({
  text,
  label,
  onYes,
  onNo,
}: {
  text: string;
  label: string;
  onYes: () => void;
  onNo: () => void;
}) {
  return (
    <>
      <span className="rv-confirm">{text}</span>
      <Action label={label} danger onClick={onYes} />
      <Action label="Keep" onClick={onNo} />
    </>
  );
}

function AccessPicker({ person, store, onDone }: { person: Me; store: ReviewStore; onDone: () => void }) {
  const label = useId();
  return (
    <>
      <span id={label} className="rv-confirm">
        Access from today
      </span>
      <Select
        labelId={label}
        menuClassName="rv-menu"
        value={null}
        placeholder="Choose"
        options={LENGTH_OPTIONS}
        onChange={(next) => act(store.setAccess(person.id, next as Access).then(onDone))}
      />
      <Action label="Cancel" onClick={onDone} />
    </>
  );
}

type RowProps = { person: Me; store: ReviewStore; onLink: (link: Link) => void };

function PersonActions({ person, store, onLink, setMode }: RowProps & { setMode: (m: Mode) => void }) {
  const linked = (pending: Promise<string>) =>
    act(pending.then((href) => onLink({ name: person.name, href })));
  // A link would open nothing once access has ended, so the row offers the fix instead.
  if (ended(person))
    return (
      <>
        <Action label="Change access" onClick={() => setMode('access')} />
        <Action label="Revoke" onClick={() => setMode('revoke')} />
      </>
    );
  return (
    <>
      <Action label="New link" onClick={() => linked(store.newLink(person.id))} />
      <Action label="Sign out everywhere" onClick={() => setMode('signOut')} />
      <Action label="Access" onClick={() => setMode('access')} />
      <Action label="Revoke" onClick={() => setMode('revoke')} />
    </>
  );
}

function PersonRow({ person, store, onLink }: RowProps) {
  const [mode, setMode] = useState<Mode>('idle');
  const idle = () => setMode('idle');
  const views: Record<Mode, () => ReactNode> = {
    idle: () => <PersonActions person={person} store={store} onLink={onLink} setMode={setMode} />,
    access: () => <AccessPicker person={person} store={store} onDone={idle} />,
    revoke: () => (
      <Confirm
        text={`Remove ${person.name}’s access everywhere?`}
        label="Revoke"
        onYes={() => act(store.revoke(person.id).then(idle))}
        onNo={idle}
      />
    ),
    signOut: () => (
      <Confirm
        text={`Sign ${person.name} out of every device? They get one new link.`}
        label="Sign out"
        onYes={() =>
          act(
            store.signOut(person.id).then((href) => {
              onLink({ name: person.name, href });
              idle();
            }),
          )
        }
        onNo={idle}
      />
    ),
  };
  return <div className="rv-row rv-acts">{views[mode]()}</div>;
}

export function People({
  store,
  me,
  people,
  access,
}: {
  store: ReviewStore;
  me: Me | null;
  people: Me[] | null;
  access: Access | null;
}) {
  const [link, setLink] = useState<Link | null>(null);
  return (
    <div className="rv-body">
      <AddForm store={store} projectDefault={access} onLink={setLink} />
      {/* Keyed by the link, so a second one starts on Copy again. */}
      {link && <ShareLink key={link.href} link={link} />}
      <HowLinksWork />
      {people === null ? (
        <p className="rv-muted">Loading people…</p>
      ) : (
        <ul className="rv-people">
          {people.map((p) => (
            <li key={p.id} data-revoked={p.revokedAt ? '' : undefined}>
              <div className="rv-person">
                <strong>{p.name}</strong>
                <span className="rv-muted">
                  {p.team} · {KIND_NAMES[p.kind]} · {p.revokedAt ? 'revoked' : accessText(p)}
                </span>
              </div>
              {p.id !== me?.id && !p.revokedAt && <PersonRow person={p} store={store} onLink={setLink} />}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
