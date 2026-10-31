// The feature slug names docs/sprints/<feature>/ and a prototype's `feature:`. One rule for its shape and its display name.
export const SLUG = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export const featureTitle = (slug: string) => slug.replace(/-/g, ' ').replace(/^\w/, (c) => c.toUpperCase());

export const guideHref = (feature: string) => `/guide/${feature}/`;
