// The one text box: a new comment, a reply, an edit. It grows with its
// words; Enter sends, Shift Enter starts a new line, Esc in an empty box backs out.
import { Icon } from '@kit/Icon';
import { type KeyboardEvent, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { LIMITS } from '../../core/review/model';

const MAX_HEIGHT = 160;

/** A text box's words, its busy flag, and a textarea that grows to fit them up to `max` px. */
export function useTextBox(initial: string, max: number) {
  const [body, setBody] = useState(initial);
  const [busy, setBusy] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  // biome-ignore lint/correctness/useExhaustiveDependencies: grows to fit whenever the words change
  useLayoutEffect(() => {
    const a = area.current;
    if (!a) return;
    a.style.height = 'auto';
    a.style.height = `${Math.min(a.scrollHeight, max)}px`;
  }, [body, max]);
  return { body, setBody, busy, setBusy, area };
}

export function Field({
  label,
  placeholder,
  send,
  initial = '',
  autoFocus,
  onSend,
  onCancel,
}: {
  label: string;
  placeholder: string;
  send: string;
  initial?: string;
  autoFocus?: boolean;
  onSend: (body: string) => Promise<unknown>;
  onCancel?: () => void;
}) {
  const { body, setBody, busy, setBusy, area } = useTextBox(initial, MAX_HEIGHT);
  // Never on a touch screen: focusing there throws the keyboard over the page.
  useEffect(() => {
    if (autoFocus && matchMedia('(pointer: fine)').matches) area.current?.focus();
  }, [autoFocus, area]);

  const submit = async () => {
    if (!body.trim() || busy) return;
    setBusy(true);
    try {
      await onSend(body.trim());
      setBody('');
    } catch {
      // The store shows the error; the words stay so nothing typed is lost.
    } finally {
      setBusy(false);
    }
  };
  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    } else if (e.key === 'Escape' && onCancel && !body) {
      e.preventDefault();
      onCancel();
    }
  };
  return (
    <form
      className="rv-field"
      aria-busy={busy}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <textarea
        ref={area}
        rows={1}
        value={body}
        maxLength={LIMITS.body}
        aria-label={label}
        placeholder={placeholder}
        enterKeyHint="send"
        onChange={(e) => setBody(e.target.value)}
        onKeyDown={onKey}
      />
      <button
        type="submit"
        className="rv-send"
        aria-label={send}
        title={`${send} (Enter). Shift Enter for a new line.`}
        disabled={!body.trim() || busy}
      >
        <Icon name="arrow-right" size={16} />
      </button>
    </form>
  );
}
