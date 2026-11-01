// Emails and phone numbers in fixture data. A CMS pull can put a real
// person's details behind a share link a client forwards, so the pre-flight
// stops on every match until it is confirmed as a business contact. This is
// the code half of the contact check; Jev, when on, only judges whether a
// match is a private person or a public business.

export type Contact = { kind: 'email' | 'phone'; value: string; path: string };

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// A run that starts and ends with a digit, may hold spaces, dots, dashes and
// brackets, and is not glued to letters or digits on either side.
const PHONE = /(?<![\w.+-])\+?\d[\d\s().-]{6,}\d(?![\w])/g;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}/;

function phones(text: string): string[] {
  return [...text.matchAll(PHONE)]
    .map((m) => m[0].trim())
    .filter((v) => {
      const digits = v.replace(/\D/g, '').length;
      return digits >= 9 && digits <= 15 && !ISO_DATE.test(v);
    });
}

/** Every contact in a string, in order of appearance. */
export function contactsIn(text: string, path = ''): Contact[] {
  const emails = [...text.matchAll(EMAIL)].map((m) => ({ kind: 'email' as const, value: m[0], path }));
  const withoutEmails = text.replace(EMAIL, ' ');
  return [...emails, ...phones(withoutEmails).map((value) => ({ kind: 'phone' as const, value, path }))];
}

/** Every contact in any string of a JSON value, with the path to it (`real[2].owner`). */
export function contactsInJson(value: unknown, path = ''): Contact[] {
  if (typeof value === 'string') return contactsIn(value, path);
  if (Array.isArray(value)) return value.flatMap((v, i) => contactsInJson(v, `${path}[${i}]`));
  if (value && typeof value === 'object')
    return Object.entries(value).flatMap(([k, v]) => contactsInJson(v, path ? `${path}.${k}` : k));
  return [];
}
