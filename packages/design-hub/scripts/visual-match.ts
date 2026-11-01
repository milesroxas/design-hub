#!/usr/bin/env node
/// <reference types="node" />
// Experimental, TypeSafe on: compares a Paper frame's export with a
// screenshot of the prototype in the same state and asks Jev three narrow
// questions: is an element of the comp missing, is there one the comp does
// not have, is the order different. It never judges sizes or colours; those
// come from get_computed_styles, because Jev is weak on numbers and a
// screenshot drifts by pixels. TypeSafe marks image input as subject to
// change, so this warns and never blocks. Threshold: checks.json visual.warnAt.
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { reaches } from '../core/checks.ts';
import { imageSize } from '../core/image.ts';
import { type ImageAsset, noulOf } from '../core/jev.ts';
import { checks } from '../server/checks.ts';
import { type Args, CliError, type CommandSpec } from './lib/cli.ts';
import { judge, typesafeKey } from './lib/judge.ts';

export const spec = {
  name: 'visual-match',
  summary:
    'Experimental: ask Jev whether a prototype screenshot is missing, adds or reorders elements of its Paper comp.',
  positionals: [{ name: 'prototype', description: 'The prototype slug, for the log', required: true }],
  flags: {
    comp: { type: 'string', required: true, description: 'The Paper frame export (PNG or JPEG).' },
    shot: {
      type: 'string',
      required: true,
      description: 'The prototype screenshot in the same state (PNG or JPEG).',
    },
  },
  output: '{ ok, experimental, findings: [{ question, p, id }] }',
} as const satisfies CommandSpec;

// TypeSafe's image limits: each side 280 to 1568 px, 78,400 to 2,458,624 pixels, 16 MiB a file.
export const IMAGE_LIMITS = {
  side: [280, 1568],
  pixels: [78_400, 2_458_624],
  bytes: 16 * 1024 * 1024,
} as const;

const QUESTIONS = {
  missing: 'Is any element that is visible in the image `comp` missing from the image `prototype`?',
  extra: 'Does the image `prototype` show an element that the image `comp` does not have?',
  order:
    'Are the elements in the image `prototype` in a different order or arrangement than in the image `comp`?',
} as const;

export function asset(path: string, flag: string): ImageAsset {
  const file = resolve(path);
  if (!existsSync(file)) throw new CliError(`${flag} ${path} does not exist.`);
  if (statSync(file).size > IMAGE_LIMITS.bytes) throw new CliError(`${flag} is over 16 MiB.`);
  const data = readFileSync(file);
  const size = imageSize(data);
  if (!size || !['.png', '.jpg', '.jpeg'].includes(extname(file).toLowerCase()))
    throw new CliError(`${flag} must be a PNG or JPEG.`, { got: path });
  const { width, height } = size;
  const [minSide, maxSide] = IMAGE_LIMITS.side;
  const [minPx, maxPx] = IMAGE_LIMITS.pixels;
  if (
    width < minSide ||
    height < minSide ||
    width > maxSide ||
    height > maxSide ||
    width * height < minPx ||
    width * height > maxPx
  )
    throw new CliError(
      `${flag} is ${width}×${height}; TypeSafe takes 280 to 1568 px a side and rejects anything else.`,
      {
        fix: `sips -Z ${maxSide} "${path}" on macOS shrinks the long side to ${maxSide} px.`,
      },
    );
  return { type: 'image', format: size.format, data_base64: data.toString('base64') };
}

export async function main({ positionals: [prototype], flags }: Args<typeof spec>) {
  if (!typesafeKey())
    throw new CliError('TypeSafe is off.', { fix: 'design-hub bootstrap --typesafe-key <key>' });
  if (!checks)
    throw new CliError('checks.json is invalid; every Jev check is off.', {
      fix: 'design-hub preflight names the problem.',
    });
  // Opaque references, as TypeSafe asks: the image travels once in `assets` and is named where it is meant.
  const comp = randomUUID();
  const shot = randomUUID();
  const judged = await judge({
    check: 'visual',
    subject: prototype,
    state: { comp, prototype: shot },
    assets: { [comp]: asset(flags.comp, '--comp'), [shot]: asset(flags.shot, '--shot') },
    questions: Object.fromEntries(
      Object.entries(QUESTIONS).map(([k, q]) => [k, { type: 'noul', instructions: q }]),
    ),
  });
  if (!judged) return { ok: false, error: 'Jev did not answer; the log has the reason.', experimental: true };
  const { warnAt } = checks.visual;
  const findings = (Object.keys(QUESTIONS) as (keyof typeof QUESTIONS)[]).flatMap((q) => {
    const p = noulOf(judged.answers, q);
    return p !== null && reaches(p, warnAt) ? [{ question: QUESTIONS[q], p, id: judged.ids[q] }] : [];
  });
  return { experimental: true, findings };
}
