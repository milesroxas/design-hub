/// <reference types="node" />
// Just enough of the Chrome DevTools Protocol to export artboards: start a
// headless browser on a throwaway profile, open one page, send commands to
// it, and close everything. Node's own WebSocket carries it, so the package
// adds no browser-automation dependency; the user's installed Chrome does the
// rendering.
import { type ChildProcess, spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { devtoolsUrl, readDevtools } from '../../core/export.ts';
import { CliError } from './cli.ts';

const START_TIMEOUT_MS = 20_000;
const CLOSE_TIMEOUT_MS = 2_000;

/** A promise that settles by `ms` at the latest; for shutdown steps that may never answer. */
export const within = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([promise, new Promise<void>((resolve) => setTimeout(resolve, ms).unref())]);

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

export type Browser = {
  /** Sends a command to the open page and resolves with its result. */
  send: <T = Record<string, unknown>>(method: string, params?: Record<string, unknown>) => Promise<T>;
  /** Exceptions the page threw, for the error report. */
  errors: string[];
  close: () => Promise<void>;
};

function waitForDevtools(child: ChildProcess): Promise<string> {
  return new Promise((resolve, reject) => {
    let text = '';
    const timer = setTimeout(
      () => reject(new CliError('Chrome did not start in time.', { stderr: text.slice(-400) })),
      START_TIMEOUT_MS,
    );
    child.stderr?.on('data', (d) => {
      text += d;
      const url = devtoolsUrl(text);
      if (url) {
        clearTimeout(timer);
        resolve(url);
      }
    });
    child.on('exit', (code) => {
      clearTimeout(timer);
      reject(new CliError(`Chrome exited (${code}) before it was ready.`, { stderr: text.slice(-400) }));
    });
  });
}

/** Starts headless Chrome and attaches to one fresh page. */
export async function launch(chrome: string): Promise<Browser> {
  const profile = mkdtempSync(join(tmpdir(), 'design-hub-export-'));
  const child = spawn(
    chrome,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--no-default-browser-check',
      // No component updates or background fetches: an export needs neither, and their fetcher leaves a temp folder.
      '--disable-component-update',
      '--disable-background-networking',
      '--hide-scrollbars',
      '--mute-audio',
      '--force-color-profile=srgb',
      'about:blank',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  // The profile goes once Chrome has let go of it; a leftover temp folder is not worth failing an export over.
  const cleanup = async () => {
    // Let Chrome exit on its own first: killed, it leaves its temp folders behind.
    await within(exited, CLOSE_TIMEOUT_MS);
    if (child.exitCode === null && child.signalCode === null) child.kill('SIGKILL');
    await within(exited, CLOSE_TIMEOUT_MS);
    try {
      rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    } catch {
      // The OS clears its temp folder.
    }
  };
  let ws: WebSocket;
  try {
    ws = new WebSocket(await waitForDevtools(child));
    await new Promise((resolve, reject) => {
      ws.onopen = resolve;
      ws.onerror = () => reject(new CliError('Could not reach Chrome over DevTools.'));
    });
  } catch (error) {
    await cleanup();
    throw error;
  }

  let next = 0;
  let sessionId: string | undefined;
  const pending = new Map<number, Pending>();
  const errors: string[] = [];
  ws.onmessage = (event) => {
    const msg = readDevtools(String(event.data));
    if (msg.kind === 'exception') errors.push(msg.text);
    if (msg.kind !== 'reply') return;
    const waiting = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) waiting?.reject(new CliError(`Chrome refused: ${msg.error}`));
    else waiting?.resolve(msg.result);
  };
  const raw = <T>(method: string, params: Record<string, unknown> = {}, session?: string) =>
    new Promise<T>((resolve, reject) => {
      const id = ++next;
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      ws.send(JSON.stringify({ id, method, params, ...(session ? { sessionId: session } : {}) }));
    });

  const { targetId } = await raw<{ targetId: string }>('Target.createTarget', { url: 'about:blank' });
  ({ sessionId } = await raw<{ sessionId: string }>('Target.attachToTarget', { targetId, flatten: true }));
  await raw('Runtime.enable', {}, sessionId);
  await raw('Page.enable', {}, sessionId);

  return {
    send: (method, params) => raw(method, params, sessionId),
    errors,
    close: async () => {
      // Chrome often drops the socket before it answers Browser.close.
      await within(
        raw('Browser.close').catch(() => undefined),
        CLOSE_TIMEOUT_MS,
      );
      ws.close();
      await cleanup();
    },
  };
}
