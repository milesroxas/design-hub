// The one rule for turning a project name into a folder and repo name. No
// imports, because the page loads this file too: the path it previews is the
// path the server creates.

/** The folder name for a project name: what create.mjs accepts as a repo name. */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80);
}
