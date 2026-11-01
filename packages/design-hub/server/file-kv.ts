/// <reference types="node" />
// The review store on this machine: the in-memory store, saved to
// .design-hub/review.json after every write. The dev server and the CLI's
// --local use it, so the review UI works with no account and no network.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { type KV, memoryKV, type Snapshot } from '../core/review/store.ts';

export function fileKV(file: string): KV {
  let initial: Snapshot = { hashes: {}, sets: {} };
  if (existsSync(file)) {
    try {
      initial = JSON.parse(readFileSync(file, 'utf8')) as Snapshot;
    } catch {
      throw new Error(`${file} is not valid JSON. Fix or delete it; it holds the local review data.`);
    }
  }
  return memoryKV(initial, (snapshot) => {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(snapshot, null, 2)}\n`);
    renameSync(tmp, file);
  });
}
