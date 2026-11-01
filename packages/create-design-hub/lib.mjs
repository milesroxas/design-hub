// The pure parts of create-design-hub: the rules a new project folder must
// meet and the edits the template gets. No I/O here, so every rule is tested
// without a disk.
import { basename, isAbsolute } from 'node:path';

export const SPEC = {
  command: 'npm create design-hub -- --path <folder>',
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
    '--no-install': { type: 'boolean', description: 'Copy the template and stop before pnpm install.' },
  },
  output: '{ ok, path, repo, created, next }',
};

/** Files the template stores under another name, because npm drops dotfiles of these names from a package. */
export const RENAMES = { _gitignore: '.gitignore', _gitattributes: '.gitattributes' };

/** What is copied from the template: everything but what a project makes for itself. */
export const SKIP = new Set(['node_modules', 'dist', '.env', 'pnpm-lock.yaml']);
export const SKIP_DIRS = {
  '.design-hub': new Set(['checks.json']),
  '.claude': new Set(['settings.json', 'launch.json']),
};

/** The problems with a create request, by flag; empty when it is valid. */
export function validate({ path, visibility = 'none', template, link }) {
  const errors = {};
  if (!path || !isAbsolute(path)) errors.path = '--path takes an absolute folder.';
  else if (!/^[\w.-]+$/.test(basename(path)))
    errors.path = 'The folder name becomes the repo name: letters, digits, dot, dash, underscore.';
  if (!['private', 'public', 'none'].includes(visibility))
    errors.visibility = '--visibility takes private, public or none.';
  if (template !== undefined && !/^[\w.-]+\/[\w.-]+$/.test(template))
    errors.template = '--template takes owner/repo.';
  if (link !== undefined && !isAbsolute(link)) errors.link = '--link takes an absolute path.';
  return errors;
}

/** The project's package.json: named after its folder, pinned to the design-hub version that made it. */
export function projectManifest(template, { name, version, link }) {
  const pkg = JSON.parse(JSON.stringify(template));
  pkg.name = name;
  pkg.dependencies['design-hub'] = link ? `link:${link}` : `^${version}`;
  return pkg;
}
