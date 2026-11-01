#!/usr/bin/env node
// npm create design-hub -- --path <absolute path> [--owner <gh account>] [--visibility private|public|none]
//
// Copies the template into the folder, names the project after it, pins the
// design-hub version, starts a git repo, installs, and puts the miles-*
// skills in place. With --visibility private or public it also creates the
// GitHub repo and pushes. Flags only, never a prompt, one JSON object on
// stdout, `--help` prints the schema, a second run finds the project and
// changes nothing.
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { projectManifest, RENAMES, SKIP, SKIP_DIRS, SPEC, validate } from './lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATE = join(HERE, 'template');

const print = (value) => console.log(JSON.stringify(value, null, 2));
function fail(error, detail = {}) {
  print({ ok: false, error, ...detail });
  process.exit(1);
}
function run(cmd, args, cwd) {
  const out = spawnSync(cmd, args, { cwd, encoding: 'utf8', env: process.env });
  if (out.error)
    fail(`${cmd} is not installed.`, {
      fix:
        cmd === 'gh'
          ? 'brew install gh, then gh auth login'
          : cmd === 'pnpm'
            ? 'corepack enable'
            : `Install ${cmd}.`,
    });
  if (out.status !== 0)
    fail(`${cmd} ${args[0]} failed.`, {
      command: [cmd, ...args].join(' '),
      stderr: out.stderr.trim().slice(-600),
    });
  return out.stdout.trim();
}

if (process.argv.includes('--help')) {
  print(SPEC);
  process.exit(0);
}

let values;
try {
  ({ values } = parseArgs({
    options: {
      path: { type: 'string' },
      owner: { type: 'string' },
      visibility: { type: 'string' },
      link: { type: 'string' },
      'no-install': { type: 'boolean' },
    },
    strict: true,
  }));
} catch (error) {
  fail(error.message, { fix: 'npm create design-hub -- --help' });
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18))
  fail('Node 22.18 or newer is needed.', {
    found: process.versions.node,
    fix: 'Install the current LTS from https://nodejs.org',
  });

const errors = validate(values);
if (Object.keys(errors).length) fail(Object.values(errors).join(' '), { errors });
const { path, visibility = 'none', link } = values;
const name = basename(path);
const next = `pnpm --dir "${path}" bootstrap`;

// A second run finds the project already there and changes nothing.
if (existsSync(join(path, 'package.json')) && existsSync(join(path, '.git'))) {
  const remote =
    spawnSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim() ||
    null;
  print({ ok: true, path, repo: remote, created: false, next });
  process.exit(0);
}
if (existsSync(path) && readdirSync(path).length)
  fail(`${path} exists and is not empty.`, { fix: 'Pick another --path.' });

/** The template, file by file: renamed dotfiles, no local state, no installed skills. */
function copyTemplate(from, to, depth = 0) {
  mkdirSync(to, { recursive: true });
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (SKIP.has(entry.name) && depth === 0) continue;
    const keep = SKIP_DIRS[basename(from)];
    if (keep && depth === 1 && !keep.has(entry.name)) continue;
    const dest = join(to, RENAMES[entry.name] ?? entry.name);
    if (entry.isDirectory()) copyTemplate(join(from, entry.name), dest, depth + 1);
    else cpSync(join(from, entry.name), dest);
  }
}

mkdirSync(dirname(path), { recursive: true });
copyTemplate(TEMPLATE, path);
// design-hub and create-design-hub publish in lockstep, so this package's version is the hub's.
const { version } = JSON.parse(readFileSync(join(HERE, 'package.json'), 'utf8'));
const template = JSON.parse(readFileSync(join(TEMPLATE, 'package.json'), 'utf8'));
writeFileSync(
  join(path, 'package.json'),
  `${JSON.stringify(projectManifest(template, { name, version, link }), null, 2)}\n`,
);
run('git', ['init', '-b', 'main'], path);

if (!values['no-install']) {
  run('pnpm', ['install'], path);
  run(join(path, 'node_modules', '.bin', 'design-hub'), ['skills'], path);
}
run('git', ['add', '-A'], path);
run(
  'git',
  [
    '-c',
    'user.name=Design Hub',
    '-c',
    'user.email=hub@localhost',
    'commit',
    '-q',
    '-m',
    `${name}: a Design Hub project`,
  ],
  path,
);

let repo = null;
if (visibility !== 'none') {
  run('gh', ['auth', 'status']);
  const owner = values.owner ?? run('gh', ['api', 'user', '--jq', '.login']);
  run(
    'gh',
    [
      'repo',
      'create',
      `${owner}/${name}`,
      `--${visibility}`,
      '--source',
      path,
      '--remote',
      'origin',
      '--push',
    ],
    path,
  );
  repo = `https://github.com/${owner}/${name}`;
}
print({ ok: true, path, repo, created: true, next });
