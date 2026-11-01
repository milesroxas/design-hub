import axe from 'axe-core';

// Dev only: axe runs once the page has been quiet for a moment and logs
// new violations as [a11y] warnings. ?a11y=0 turns it off.
const HARNESS = [['.proto-picker'], ['.dialkit-root'], ['[data-harness]'], ['[data-lapse-panel]']];

export function watchA11y() {
  let timer = 0;
  let running = false;
  let last: string | null = null;

  const run = async () => {
    if (running) return;
    running = true;
    try {
      const { violations } = await axe.run(
        { exclude: HARNESS },
        { resultTypes: ['violations'], rules: { region: { enabled: false } } },
      );
      const key = violations.map((v) => `${v.id}:${v.nodes.length}`).join('|');
      if (key && key !== last) {
        console.groupCollapsed(`[a11y] ${violations.length} rule(s) failing`);
        for (const v of violations) {
          console.warn(
            `[a11y] ${v.impact} ${v.id}: ${v.help}`,
            v.nodes.map((n) => n.target.join(' ')),
            v.helpUrl,
          );
        }
        console.groupEnd();
      } else if (!key && last !== '') {
        console.info('[a11y] clean');
      }
      last = key;
    } finally {
      running = false;
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    // Safari has no requestIdleCallback; without the fallback the watcher throws and never runs there.
    const idle = window.requestIdleCallback ?? ((fn: () => void) => window.setTimeout(fn, 200));
    timer = window.setTimeout(() => idle(run, { timeout: 2000 }), 1200);
  };

  new MutationObserver(schedule).observe(document.body, { subtree: true, childList: true });
  addEventListener('hashchange', schedule);
  schedule();
}
