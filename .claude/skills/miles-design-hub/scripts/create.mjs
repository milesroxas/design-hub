#!/usr/bin/env node
// node create.mjs --path <absolute path> [--owner <gh account or org>] [--visibility private|public|none] [--template <owner/repo>]
//
// Creates a project from the Design Hub template. It ships inside the global
// miles-design-hub skill because it runs before the project exists, so it
// cannot use the project's own scripts; it keeps their contract instead:
// flags only, never a prompt, one JSON object on stdout, `--help` prints the
// schema, a second run changes nothing. Plain JavaScript, no dependencies.
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { basename, dirname, isAbsolute, join } from 'node:path';
import { parseArgs } from 'node:util';

const SPEC = {
  command: 'node create.mjs',
  summary: 'Create a new project from the Design Hub template, on GitHub or as a plain local repo.',
  flags: {
    '--path': { type: 'string', required: true, description: 'Absolute folder for the project; its name is the repo name.' },
    '--owner': { type: 'string', description: 'GitHub account or org that owns the repo. Default: the signed-in gh account.' },
    '--visibility': { type: 'string', choices: ['private', 'public', 'none'], default: 'private', description: 'none: no GitHub repo, a local git repo only.' },
    '--template': { type: 'string', default: 'milesroxas/design-hub', description: 'The template repo, or a fork of it.' },
  },
  output: '{ ok, path, repo, created, next }',
};

const print = (value) => console.log(JSON.stringify(value, null, 2));
function fail(error, detail = {}) {
  print({ ok: false, error, ...detail });
  process.exit(1);
}
function run(cmd, args, cwd) {
  const out = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
  if (out.error) fail(`${cmd} is not installed.`, { fix: cmd === 'gh' ? 'brew install gh, then gh auth login' : `Install ${cmd}.` });
  if (out.status !== 0) fail(`${cmd} ${args[0]} failed.`, { command: [cmd, ...args].join(' '), stderr: out.stderr.trim().slice(-600) });
  return out.stdout.trim();
}

if (process.argv.includes('--help')) {
  print(SPEC);
  process.exit(0);
}

let values;
try {
  ({ values } = parseArgs({
    options: { path: { type: 'string' }, owner: { type: 'string' }, visibility: { type: 'string' }, template: { type: 'string' } },
    strict: true,
  }));
} catch (error) {
  fail(error.message, { fix: 'node create.mjs --help' });
}

const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18))
  fail('Node 22.18 or newer is needed: the project scripts run as TypeScript.', { found: process.versions.node, fix: 'Install the current LTS from https://nodejs.org' });

const path = values.path;
const visibility = values.visibility ?? 'private';
const template = values.template ?? 'milesroxas/design-hub';
if (!path || !isAbsolute(path)) fail('--path takes an absolute folder.', { got: path });
if (!['private', 'public', 'none'].includes(visibility)) fail('--visibility takes private, public or none.', { got: visibility });
if (!/^[\w.-]+\/[\w.-]+$/.test(template)) fail('--template takes owner/repo.', { got: template });
const name = basename(path);
if (!/^[\w.-]+$/.test(name)) fail('The folder name becomes the repo name: letters, digits, dot, dash, underscore.', { got: name });

const next = `pnpm --dir "${join(path, 'prototypes')}" bootstrap`;

// A second run finds the project already there and changes nothing.
if (existsSync(join(path, 'prototypes', 'package.json')) && existsSync(join(path, '.git'))) {
  const remote = spawnSync('git', ['-C', path, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).stdout?.trim() || null;
  print({ ok: true, path, repo: remote, created: false, next });
  process.exit(0);
}
if (existsSync(path) && readdirSync(path).length) fail(`${path} exists and is not empty.`, { fix: 'Pick another --path.' });
mkdirSync(dirname(path), { recursive: true });

if (visibility === 'none') {
  run('git', ['clone', '--depth', '1', `https://github.com/${template}.git`, path]);
  rmSync(join(path, '.git'), { recursive: true, force: true });
  run('git', ['init', '-b', 'main'], path);
  print({ ok: true, path, repo: null, created: true, next });
} else {
  run('gh', ['auth', 'status']);
  const owner = values.owner ?? run('gh', ['api', 'user', '--jq', '.login']);
  // gh clones into ./<name> of the working directory, which is the folder asked for.
  run('gh', ['repo', 'create', `${owner}/${name}`, '--template', template, `--${visibility}`, '--clone'], dirname(path));
  if (!existsSync(join(path, 'prototypes'))) fail('The clone did not land where expected.', { path });
  print({ ok: true, path, repo: `https://github.com/${owner}/${name}`, created: true, next });
}
