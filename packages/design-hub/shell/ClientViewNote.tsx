import { useControls } from '@kit/audience';
import { Icon } from '@kit/Icon';
import { setClientView, useClientView } from '@kit/prefs';
import { Button } from '@kit/ui';
import './shell.css';

/**
 * Client view on: the comment layer's note (shell/review, .rv-viewing), in
 * its words and look, with the one way back. On the index and on a
 * prototype's page that Client view shows as missing.
 */
export function ClientViewNote({
  onLeave,
  text = 'Client view: prototypes as a client sees them',
  at,
}: {
  onLeave: () => void;
  text?: string;
  /** On a prototype's page the note sits at the top: the picker and the comment bar hold the bottom. */
  at?: 'top';
}) {
  return (
    <p className="index-viewing sys" role="status" data-at={at}>
      <Icon name="briefcase-01" size={14} />
      <span>{text}</span>
      <Button kind="tertiary" size={null} className="index-viewing-act" label="Leave" onClick={onLeave} />
    </p>
  );
}

/**
 * On a prototype's page, for a Studio person in Client view: what the page
 * is showing, and the way back. Client view is entered from the Controls
 * panel or the comment bar; it is left from here, from either of them, or
 * from the index.
 */
export function PrototypeClientView() {
  const { person } = useControls();
  const on = useClientView();
  if (!person || !on) return null;
  const leave = () => {
    setClientView(false);
    location.reload();
  };
  return <ClientViewNote onLeave={leave} at="top" text="Client view: this prototype as a client gets it" />;
}
