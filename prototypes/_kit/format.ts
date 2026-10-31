// Words for numbers and dates, the same in the shell and every prototype.

/** An ISO date (2026-10-28) as "28 Oct 2026"; empty for an empty string. Noon, so no timezone moves the day. */
export const fmtDate = (iso: string) =>
  iso
    ? new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : '';

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
