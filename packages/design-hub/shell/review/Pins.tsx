// Pins on the elements comments are about, and the marker for one being
// written. In comment mode they are the way into a thread, so each is a real
// button in the tab order. The button is the hit area and never changes size;
// the face inside it is what presses and lifts, so a press near the edge
// still ends on the pin. An open thread's pin is solid and numbered; a
// resolved one is pale and carries a check.
import { Icon } from '@kit/Icon';
import { useEffect, useRef } from 'react';
import type { Comment } from '../../core/review/model';
import { pinPoint } from './anchor';
import { draftPoint } from './PickLayer';
import type { Draft } from './view';

const moveTo = (el: HTMLElement, at: { x: number; y: number } | null) => {
  el.hidden = !at;
  if (at) el.style.transform = `translate(${at.x}px, ${at.y}px)`;
};

export function Pins({
  comments,
  number,
  active,
  draft,
  onOpen,
}: {
  comments: Comment[];
  number: Map<string, number>;
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
      {comments.map((c) => {
        const n = number.get(c.id);
        const resolved = c.status === 'resolved';
        return (
          <button
            key={c.id}
            type="button"
            className="rv-pin"
            data-pin={c.id}
            data-resolved={resolved ? '' : undefined}
            data-active={active === c.id ? '' : undefined}
            aria-label={`Comment ${n}${resolved ? ', resolved,' : ''} by ${c.author.name}`}
            aria-pressed={active === c.id}
            hidden
            onClick={() => onOpen(c.id)}
          >
            <span className="rv-pin-face">{resolved ? <Icon name="check" size={12} /> : n}</span>
          </button>
        );
      })}
      {draft?.offset && (
        <span className="rv-pin" data-draft="" data-new="" aria-hidden="true" hidden>
          <span className="rv-pin-face" />
        </span>
      )}
    </div>
  );
}
