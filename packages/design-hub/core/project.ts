// What kind of engagement a project is: its tracks, and for a website the
// platform it ships on. A studio works three ways, often at once: a product
// (designed here, handed to the client's engineers as a spec), a website
// (built on a CMS and a front end), and brand collateral (fixed-size
// templates: social posts, slides, print). The answer lives in
// .design-hub/project.json, so `new`, the hub, the port and every agent read
// one file instead of guessing from prose. Pure: callers read and write it.

export const TRACKS = ['product', 'website', 'brand'] as const;
export type Track = (typeof TRACKS)[number];

export const PLATFORMS = ['webflow', 'payload', 'wordpress', 'emdash'] as const;
export type Platform = (typeof PLATFORMS)[number];

export const FRONTENDS = ['astro', 'next'] as const;
export type Frontend = (typeof FRONTENDS)[number];

export type Website = {
  platform: Platform;
  /** The code that renders the site. Absent for Webflow, which renders its own pages. */
  frontend?: Frontend;
  /** Where the site is deployed, when the platform decides it. */
  host?: string;
};

export type Project = { tracks: Track[]; website?: Website };

export const TRACK_LABEL: Record<Track, string> = {
  product: 'Product',
  website: 'Website',
  brand: 'Brand',
};

const PLATFORM_LABEL: Record<Platform, string> = {
  webflow: 'Webflow',
  payload: 'Payload CMS',
  wordpress: 'WordPress',
  emdash: 'EmDash',
};

/**
 * What each platform fixes. Webflow renders its own pages; EmDash is built
 * on Astro and deployed to Cloudflare; Payload and WordPress are headless
 * here, so the front end is a choice.
 */
const PLATFORM_RULES: Record<Platform, { frontend: Frontend | null | 'choose'; host?: string }> = {
  webflow: { frontend: null, host: 'webflow' },
  emdash: { frontend: 'astro', host: 'cloudflare' },
  payload: { frontend: 'choose' },
  wordpress: { frontend: 'choose' },
};

/** The sample prototype and walkthrough feature each track ships with, so setup can drop the ones a project does not use. */
const SAMPLES: Record<Track, { slug: string; feature: string }> = {
  product: { slug: 'sample-list', feature: 'sample' },
  website: { slug: 'sample-page', feature: 'sample-site' },
  brand: { slug: 'sample-social', feature: 'sample-brand' },
};

const isTrack = (v: unknown): v is Track => TRACKS.includes(v as Track);
const isPlatform = (v: unknown): v is Platform => PLATFORMS.includes(v as Platform);
const isFrontend = (v: unknown): v is Frontend => FRONTENDS.includes(v as Frontend);

/** Tracks in their canonical order, without repeats. */
const ordered = (tracks: Track[]): Track[] => TRACKS.filter((t) => tracks.includes(t));

/** The website settings a platform and an optional front end make, or the problem with them. */
export function websiteFor(platform: string, frontend?: string): { website: Website } | { problem: string } {
  if (!isPlatform(platform)) return { problem: `The platform is one of: ${PLATFORMS.join(', ')}.` };
  const rule = PLATFORM_RULES[platform];
  const host = rule.host ? { host: rule.host } : {};
  if (rule.frontend === 'choose') {
    if (!frontend)
      return { problem: `${PLATFORM_LABEL[platform]} needs a front end: ${FRONTENDS.join(' or ')}.` };
    if (!isFrontend(frontend)) return { problem: `The front end is one of: ${FRONTENDS.join(', ')}.` };
    return { website: { platform, frontend, ...host } };
  }
  if (frontend && frontend !== rule.frontend)
    return {
      problem: rule.frontend
        ? `${PLATFORM_LABEL[platform]} always uses ${rule.frontend}.`
        : `${PLATFORM_LABEL[platform]} renders its own pages; it takes no front end.`,
    };
  return { website: { platform, ...(rule.frontend ? { frontend: rule.frontend } : {}), ...host } };
}

/** A project from flags or a file: the tracks, and the website when the website track is on. */
export function makeProject(
  tracks: readonly string[],
  website?: { platform?: string; frontend?: string },
): { project: Project } | { problems: string[] } {
  const problems: string[] = [];
  const unknown = tracks.filter((t) => !isTrack(t));
  if (unknown.length) problems.push(`Unknown track: ${unknown.join(', ')}. Tracks: ${TRACKS.join(', ')}.`);
  const chosen = ordered(tracks.filter(isTrack));
  if (!chosen.length && !unknown.length) problems.push(`Pick at least one track: ${TRACKS.join(', ')}.`);
  const project: Project = { tracks: chosen };
  if (chosen.includes('website') && website?.platform) {
    const made = websiteFor(website.platform, website.frontend);
    if ('problem' in made) problems.push(made.problem);
    else project.website = made.website;
  } else if (!chosen.includes('website') && (website?.platform || website?.frontend)) {
    problems.push('A platform or front end needs the website track.');
  }
  return problems.length ? { problems } : { project };
}

/** project.json's contents, or the problems with them. A missing file is the caller's case, not this one's. */
export function parseProject(raw: unknown): { project: Project } | { problems: string[] } {
  if (!raw || typeof raw !== 'object') return { problems: ['project.json is not an object.'] };
  const { tracks, website } = raw as {
    tracks?: unknown;
    website?: { platform?: unknown; frontend?: unknown };
  };
  if (!Array.isArray(tracks)) return { problems: ['project.json has no tracks list.'] };
  return makeProject(tracks.map(String), {
    platform: website?.platform ? String(website.platform) : undefined,
    frontend: website?.frontend ? String(website.frontend) : undefined,
  });
}

/** Whether the website track still needs its platform. Setup asks for it; the port refuses to start without it. */
export const needsPlatform = (p: Project) => p.tracks.includes('website') && !p.website;

/**
 * The track a new prototype belongs to: the one asked for, else the
 * project's only track. A project with no tracks recorded (made before
 * tracks existed) takes any.
 */
export function trackFor(
  project: Project | null,
  asked?: string,
): { track: Track | '' } | { problem: string } {
  if (asked && !isTrack(asked)) return { problem: `--track is one of: ${TRACKS.join(', ')}.` };
  if (!project) return { track: (asked as Track | undefined) ?? '' };
  if (asked) {
    return project.tracks.includes(asked as Track)
      ? { track: asked as Track }
      : { problem: `This project has no ${asked} track. It has: ${project.tracks.join(', ')}.` };
  }
  if (project.tracks.length === 1) return { track: project.tracks[0] };
  return { problem: `This project has several tracks; name one with --track ${project.tracks.join('|')}.` };
}

/** The samples to remove when a project keeps only these tracks. */
export const samplesOutside = (tracks: readonly Track[]) =>
  TRACKS.filter((t) => !tracks.includes(t)).map((t) => SAMPLES[t]);
