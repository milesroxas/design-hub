// The People card, for Studio: invite someone, hand over their link, and see
// who can comment.
import { Button, Select } from '@kit/ui';
import { type FormEvent, useId, useRef, useState } from 'react';
import { INVITE_DAYS, LIMITS, type PersonKind } from '../../core/review/model';
import { Action } from './Card';
import { act, type Me, type ReviewStore } from './client';

type Link = { name: string; href: string };

const KIND_NAMES: Record<PersonKind, string> = { studio: 'Studio', client: 'Client' };

const KIND_OPTIONS: { value: PersonKind; label: string; desc: string }[] = [
  { value: 'client', label: KIND_NAMES.client, desc: 'Comments, replies and resolves any thread' },
  {
    value: 'studio',
    label: KIND_NAMES.studio,
    desc: 'Also sorts, deletes any comment and invites',
  },
];

function InviteForm({ store, onLink }: { store: ReviewStore; onLink: (link: Link) => void }) {
  const [kind, setKind] = useState<PersonKind>('client');
  const [busy, setBusy] = useState(false);
  const kindLabel = useId();
  const invite = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const name = String(f.get('name') ?? '');
    setBusy(true);
    act(
      store
        .invite(name, String(f.get('team') ?? ''), kind)
        .then((href) => {
          onLink({ name, href });
          form.reset();
        })
        .finally(() => setBusy(false)),
    );
  };
  return (
    <form className="rv-invite" onSubmit={invite}>
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
      <Button type="submit" kind="primary" size={null} label="Create invite link" busy={busy} />
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
        Send this link to {link.name}. It works for {INVITE_DAYS} days, and a new link replaces it.
      </p>
      <div className="rv-share-row">
        <input
          ref={field}
          className="input"
          readOnly
          value={link.href}
          aria-label={`Invite link for ${link.name}`}
          onFocus={(e) => e.currentTarget.select()}
        />
        <Button size={null} className="rv-copy" label={copied ? 'Copied' : 'Copy'} onClick={copy} />
      </div>
    </div>
  );
}

function PersonRow({
  person,
  store,
  onLink,
}: {
  person: Me;
  store: ReviewStore;
  onLink: (link: Link) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  return (
    <div className="rv-row rv-acts">
      {confirming ? (
        <>
          <span className="rv-confirm">Remove {person.name}’s access?</span>
          <Action
            label="Revoke"
            danger
            onClick={() => act(store.revoke(person.id).then(() => setConfirming(false)))}
          />
          <Action label="Keep" onClick={() => setConfirming(false)} />
        </>
      ) : (
        <>
          <Action
            label="New link"
            onClick={() => act(store.reissue(person.id).then((href) => onLink({ name: person.name, href })))}
          />
          <Action label="Revoke" onClick={() => setConfirming(true)} />
        </>
      )}
    </div>
  );
}

export function People({ store, me, people }: { store: ReviewStore; me: Me | null; people: Me[] | null }) {
  const [link, setLink] = useState<Link | null>(null);
  return (
    <div className="rv-body">
      <InviteForm store={store} onLink={setLink} />
      {/* Keyed by the link, so a second one starts on Copy again. */}
      {link && <ShareLink key={link.href} link={link} />}
      {people === null ? (
        <p className="rv-muted">Loading people…</p>
      ) : (
        <ul className="rv-people">
          {people.map((p) => (
            <li key={p.id} data-revoked={p.revokedAt ? '' : undefined}>
              <div className="rv-person">
                <strong>{p.name}</strong>
                <span className="rv-muted">
                  {p.team} · {KIND_NAMES[p.kind]}
                  {p.revokedAt && ' · revoked'}
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
