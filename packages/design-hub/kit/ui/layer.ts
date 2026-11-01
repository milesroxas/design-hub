// Resolves on the node's own transitionend (not a child's) or after ms, whichever comes first.
export function afterTransition(node: Element | null, ms: number) {
  return new Promise<void>((resolve) => {
    if (!node) return resolve();
    let done = false;
    const finish = (e?: Event) => {
      if (e && e.target !== node) return;
      if (done) return;
      done = true;
      node.removeEventListener('transitionend', finish);
      resolve();
    };
    node.addEventListener('transitionend', finish);
    setTimeout(finish, ms + 60);
  });
}

export const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function trapTab(e: KeyboardEvent, root: HTMLElement) {
  if (e.key !== 'Tab') return;
  const list = [...root.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null);
  if (!list.length) return;
  const i = list.indexOf(document.activeElement as HTMLElement);
  if (e.shiftKey && i <= 0) {
    e.preventDefault();
    list.at(-1)?.focus();
  } else if (!e.shiftKey && (i === list.length - 1 || i === -1)) {
    e.preventDefault();
    list[0].focus();
  }
}

let pressInstalled = false;

// Menu items and rows press on pointerdown; buttons do it with :active alone.
export function installPressFeedback() {
  if (pressInstalled) return;
  pressInstalled = true;
  const lift = () => {
    for (const n of document.querySelectorAll('.is-pressed')) n.classList.remove('is-pressed');
  };
  document.addEventListener('pointerdown', (e) => {
    const b = (e.target as Element).closest?.('.menu-item, .list-row') as HTMLButtonElement | null;
    if (b && !b.disabled) b.classList.add('is-pressed');
  });
  document.addEventListener('pointerup', lift);
  document.addEventListener('pointercancel', lift);
  document.addEventListener('pointerleave', lift, true);
}
