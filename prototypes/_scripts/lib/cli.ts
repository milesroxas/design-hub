/// <reference types="node" />
// The contract every script in _scripts/ keeps, because its reader is an
// agent, not a person: every input is a flag, nothing prompts, stdout is one
// JSON object, `--help` prints the command's schema as JSON, and a failure is
// `{ ok: false, error, fix? }` with exit code 1. `pnpm commands` lists every
// schema, so an agent discovers the commands without reading their source.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

export type Flag =
  | { type: 'string'; description: string; required?: boolean; default?: string; choices?: readonly string[] }
  | { type: 'number'; description: string; required?: boolean; default?: number }
  | { type: 'boolean'; description: string }
  | { type: 'list'; description: string };

export type CommandSpec = {
  name: string;
  summary: string;
  flags: Record<string, Flag>;
  positionals?: { name: string; description: string; required?: boolean; variadic?: boolean }[];
  output: string;
};

type ValueOf<F extends Flag> = F extends { type: 'number' }
  ? number
  : F extends { type: 'boolean' }
    ? boolean
    : F extends { type: 'list' }
      ? string[]
      : string;
type Defined<F extends Flag> = F extends { type: 'boolean' | 'list' }
  ? true
  : F extends { required: true }
    ? true
    : F extends { default: unknown }
      ? true
      : false;

export type Args<S extends CommandSpec> = {
  flags: {
    [K in keyof S['flags']]: Defined<S['flags'][K]> extends true
      ? ValueOf<S['flags'][K]>
      : ValueOf<S['flags'][K]> | undefined;
  };
  positionals: string[];
};

export type Result = Record<string, unknown> & { ok?: boolean };

/** A failure the caller can act on: the message, and the fix when there is one. */
export class CliError extends Error {
  detail: Record<string, unknown>;
  constructor(message: string, detail: Record<string, unknown> = {}) {
    super(message);
    this.detail = detail;
  }
}

export function schema(spec: CommandSpec) {
  return {
    command: `pnpm ${spec.name}`,
    summary: spec.summary,
    positionals: spec.positionals ?? [],
    flags: Object.fromEntries(Object.entries(spec.flags).map(([name, flag]) => [`--${name}`, flag])),
    output: spec.output,
  };
}

type Raw = string | boolean | (string | boolean)[] | undefined;

/** One flag's value, typed by its spec; a missing optional flag takes its default. */
function flagValue(name: string, f: Flag, raw: Raw): unknown {
  if (f.type === 'boolean') return raw === true;
  if (f.type === 'list') return (raw as string[] | undefined) ?? [];
  if (raw === undefined) {
    if (f.required) throw new CliError(`--${name} is required.`, { fix: f.description });
    return f.default;
  }
  if (f.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new CliError(`--${name} takes a number.`, { got: raw });
    return n;
  }
  if (f.choices && !f.choices.includes(raw as string))
    throw new CliError(`--${name} takes one of: ${f.choices.join(', ')}.`, { got: raw });
  return raw;
}

function parse<S extends CommandSpec>(spec: S, argv: string[]): Args<S> {
  const options = Object.fromEntries(
    Object.entries(spec.flags).map(([name, f]) => [
      name,
      { type: f.type === 'boolean' ? 'boolean' : 'string', multiple: f.type === 'list' } as const,
    ]),
  );
  const help = { fix: `Run pnpm ${spec.name} --help for the flags and arguments.` };
  let parsed: ReturnType<typeof parseArgs>;
  try {
    parsed = parseArgs({ args: argv, options, allowPositionals: true, strict: true });
  } catch (error) {
    throw new CliError(error instanceof Error ? error.message : String(error), help);
  }
  const flags = Object.fromEntries(
    Object.entries(spec.flags).map(([name, f]) => [name, flagValue(name, f, parsed.values[name])]),
  );
  const required = (spec.positionals ?? []).filter((p) => p.required).length;
  if (parsed.positionals.length < required)
    throw new CliError(`Missing ${spec.positionals?.[parsed.positionals.length]?.name}.`, help);
  // flagValue gave every flag the type its spec declares, which is what Args<S> describes.
  return { flags, positionals: parsed.positionals } as Args<S>;
}

const print = (value: unknown) => console.log(JSON.stringify(value, null, 2));

/** Parses argv, runs the command, prints its JSON and sets the exit code. */
export async function runCommand<S extends CommandSpec>(
  spec: S,
  main: (args: Args<S>) => Result | Promise<Result>,
  argv = process.argv.slice(2),
): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) return print(schema(spec));
  try {
    const { ok = true, ...rest } = await main(parse(spec, argv));
    print({ ok, ...rest });
    if (!ok) process.exitCode = 1;
  } catch (error) {
    // A domain error (the review service's) carries its problems by path; print them the same way.
    const problems = (error as { problems?: unknown })?.problems;
    const detail =
      error instanceof CliError
        ? error.detail
        : Array.isArray(problems) && problems.length
          ? { problems }
          : {};
    print({ ok: false, error: error instanceof Error ? error.message : String(error), ...detail });
    process.exitCode = 1;
  }
}

/** True when this module is the script Node was started with, not an import. */
export function isMain(moduleUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(moduleUrl));
  } catch {
    return false;
  }
}
