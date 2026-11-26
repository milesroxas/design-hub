// Pins on the elements comments are about, and the marker for one being
// written. In comment mode they are the way into a thread, so each is a real
// button in the tab order. The button is the hit area and never changes size;
// the face inside it is what presses and lifts, so a press near the edge
// still ends on the pin. An open thread's pin is solid and numbered; an
// open internal one is numbered on amber, the colour of an internal note, its
// colour alone telling it apart; a resolved one is pale and carries a check.
// The number is the thread's own, never its place in the list. The label read
// out (Comment I2) keeps the I, so two threads never sound alike.
import { Icon } from '@kit/Icon';
import { useEffect, useRef } from 'react';
import { type Comment, threadLabel } from '../../core/review/model';
import { pinPoint } from './anchor';
import { draftPoint } from './PickLayer';
import type { Draft } from './view';

const moveTo = (el: HTMLElement, at: { x: number; y: number } | null) => {
  el.hidden = !at;
  if (at) el.style.transform = `translate(${at.x}px, ${at.y}px)`;
};

/** "Comment I3, internal, resolved, by Rae": the label when it has one, then what the face shows. */
function pinLabel(c: Comment): string {
  const label = threadLabel(c);
  const words = [
    label ? `Comment ${label}` : 'Comment',
    c.audience === 'internal' && 'internal',
    c.status === 'resolved' && 'resolved',
  ];
  return `${words.filter(Boolean).join(', ')}, by ${c.author.name}`;
}

function Pin({ c, active, onOpen }: { c: Comment; active: boolean; onOpen: (id: string) => void }) {
  const resolved = c.status === 'resolved';
  // A Client is never sent an internal thread, so only Studio ever sees this face.
  const internal = c.audience === 'internal';
  return (
    <button
      type="button"
      className="rv-pin"
      data-pin={c.id}
      data-resolved={resolved ? '' : undefined}
      data-internal={internal ? '' : undefined}
      data-active={active ? '' : undefined}
      aria-label={pinLabel(c)}
      aria-pressed={active}
      hidden
      onClick={() => onOpen(c.id)}
    >
      <span className="rv-pin-face">{resolved ? <Icon name="check" size={12} /> : c.number || null}</span>
    </button>
  );
}

export function Pins({
  comments,
  active,
  draft,
  onOpen,
}: {
  comments: Comment[];
  active: string | null;
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
        moveTo(pin, c?.anchor ? pinPoint(c.anchor) : null);
      }
      const d = layer.current?.querySelector<HTMLElement>('[data-draft]');
      if (d && draft) moveTo(d, draftPoint(draft));
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
    <div ref={layer} className="rv-pins">
      {comments.map((c) => (
        <Pin key={c.id} c={c} active={active === c.id} onOpen={onOpen} />
      ))}
      {draft?.offset && (
        <span className="rv-pin" data-draft="" data-new="" aria-hidden="true" hidden>
          <span className="rv-pin-face" />
        </span>
      )}
    </div>
  );
}
