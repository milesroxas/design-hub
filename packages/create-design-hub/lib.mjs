// The pure parts of create-design-hub: the rules a new project folder must
// meet and the edits the template gets. No I/O here, so every rule is tested
// without a disk.
import { basename, isAbsolute } from 'node:path';

export const SPEC = {
  command: 'npm create @milesroxas/design-hub -- --path <folder>',
  summary: 'Create a new project from the Design Hub template, as a local git repo or on GitHub.',
  flags: {
    '--path': {
      type: 'string',
      required: true,
      description: 'Absolute folder for the project; its name is the repo name.',
    },
    '--owner': {
      type: 'string',
      description: 'GitHub account or org that owns the repo. Default: the signed-in gh account.',
    },
    '--visibility': {
      type: 'string',
      choices: ['private', 'public', 'none'],
      default: 'none',
      description: 'none: a local git repo only.',
    },
    '--link': {
      type: 'string',
      description:
        'Developing Design Hub itself: a local path to packages/design-hub, installed with the link: protocol.',
    },
    '--track': {
      type: 'list',
      choices: ['product', 'website', 'brand'],
      description:
        'A track the project has, repeated for several. Keeps only their samples. Default: every sample, tracks unset.',
    },
    '--platform': {
      type: 'string',
      choices: ['webflow', 'payload', 'wordpress', 'emdash'],
      description: 'With --track website: where the site is built.',
    },
    '--frontend': {
      type: 'string',
      choices: ['astro', 'next'],
      description: 'With Payload or WordPress: the front end. Webflow takes none; EmDash is always Astro.',
    },
    '--no-install': { type: 'boolean', description: 'Copy the template and stop before pnpm install.' },
  },
  output: '{ ok, path, repo, created, tracks?, next }',
};

/** Files the template stores under another name, because npm drops dotfiles of these names from a package. */
export const RENAMES = { _gitignore: '.gitignore', _gitattributes: '.gitattributes' };

/** What is copied from the template: everything but what a project makes for itself. */
export const SKIP = new Set(['node_modules', 'dist', '.env', 'pnpm-lock.yaml']);
export const SKIP_DIRS = {
  '.design-hub': new Set(['checks.json', 'project.json']),
  '.claude': new Set(['settings.json']),
};

const TRACKS = ['product', 'website', 'brand'];
// The platform rules of design-hub's core/project.ts, checked here before
// anything is copied, because the package that owns them is not installed
// yet. `design-hub tracks set` applies them again after the install.
const PLATFORM_FRONTEND = { webflow: null, emdash: 'astro', payload: 'choose', wordpress: 'choose' };

/** The problem with a set of tracks and a website platform, or null. */
export function tracksProblem({ track = [], platform, frontend }) {
  const unknown = track.filter((t) => !TRACKS.includes(t));
  if (unknown.length) return `--track takes ${TRACKS.join(', ')}; got ${unknown.join(', ')}.`;
  if ((platform || frontend) && !track.includes('website'))
    return '--platform and --frontend need --track website.';
  if (frontend && !platform) return '--frontend needs --platform.';
  if (!platform) return null;
  if (!(platform in PLATFORM_FRONTEND))
    return `--platform takes ${Object.keys(PLATFORM_FRONTEND).join(', ')}.`;
  const rule = PLATFORM_FRONTEND[platform];
  if (rule === 'choose' && !['astro', 'next'].includes(frontend ?? ''))
    return `${platform} needs --frontend astro or next.`;
  if (rule !== 'choose' && frontend && frontend !== rule)
    return rule ? `${platform} always uses ${rule}.` : `${platform} renders its own pages; drop --frontend.`;
  return null;
}

/** Flags for `design-hub tracks set`, which records the tracks and drops the other tracks' samples. */
export function tracksArgs({ track = [], platform, frontend }) {
  const args = ['tracks', 'set', ...track.flatMap((t) => ['--track', t]), '--remove-samples'];
  if (platform) args.push('--platform', platform);
  if (frontend) args.push('--frontend', frontend);
  return args;
}

/** The problems with a create request, by flag; empty when it is valid. */
export function validate({ path, visibility = 'none', template, link, track, platform, frontend }) {
  const errors = {};
  if (!path || !isAbsolute(path)) errors.path = '--path takes an absolute folder.';
  else if (!/^[\w.-]+$/.test(basename(path)))
    errors.path = 'The folder name becomes the repo name: letters, digits, dot, dash, underscore.';
  if (!['private', 'public', 'none'].includes(visibility))
    errors.visibility = '--visibility takes private, public or none.';
  if (template !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(template))
    errors.template = '--template takes owner/repo.';
  if (link !== undefined && !isAbsolute(link)) errors.link = '--link takes an absolute path.';
  const tracks = tracksProblem({ track, platform, frontend });
  if (tracks) errors.track = tracks;
  return errors;
}

/** The project's package.json: named after its folder, pinned to the design-hub version that made it. */
export function projectManifest(template, { name, version, link }) {
  const pkg = JSON.parse(JSON.stringify(template));
  pkg.name = name;
  pkg.dependencies['@milesroxas/design-hub'] = link ? `link:${link}` : `^${version}`;
  return pkg;
}
