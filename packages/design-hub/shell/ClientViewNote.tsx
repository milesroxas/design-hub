import { Icon } from '@kit/Icon';
import { Button } from '@kit/ui';
import './shell.css';

/**
 * Client view on: the comment layer's note (shell/review, .rv-viewing), in
 * its words and look, with the one way back. On the index and on a
 * prototype's page that Client view shows as missing.
 */
export function ClientViewNote({ onLeave }: { onLeave: () => void }) {
  return (
    <p className="index-viewing sys" role="status">
      <Icon name="briefcase-01" size={14} />
      <span>Client view: prototypes as a client sees them</span>
      <Button kind="tertiary" size={null} className="index-viewing-act" label="Leave" onClick={onLeave} />
    </p>
  );
}
