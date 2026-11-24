import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  type Board,
  chromeCandidates,
  devtoolsUrl,
  exportUrl,
  fileNames,
  pdfFiles,
  plan,
  readDevtools,
} from './export.ts';
import { fitZoom, pageSize, sizeLabel, zoomFor } from './formats.ts';

const board = (name: string, format: string, output: 'png' | 'pdf'): Board => ({
  index: 0,
  name,
  format,
  output,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
});

test('formats know their size, page and screen zoom', () => {
  assert.equal(sizeLabel('story'), '1080 × 1920');
  assert.equal(pageSize('a4'), '210mm 297mm');
  assert.equal(pageSize('slide'), '1920px 1080px');
  assert.equal(fitZoom('post-square', { width: 2000, height: 2000 }), 1);
  assert.equal(fitZoom('post-square', { width: 540, height: 2000 }), 0.5);
  assert.equal(fitZoom('story', { width: 2000, height: 960 }), 0.5);
  assert.equal(zoomFor('fit', 'post-square', { width: 540, height: 2000 }), 0.5);
  assert.equal(zoomFor('25%', 'slide', { width: 1, height: 1 }), 0.25);
  assert.equal(zoomFor('odd', 'slide', { width: 1, height: 1 }), 1);
});

test('Chrome is looked for where each system keeps it, $CHROME_PATH first', () => {
  assert.equal(chromeCandidates('darwin', { CHROME_PATH: '/x/chrome' })[0], '/x/chrome');
  assert.match(chromeCandidates('darwin', {})[0], /Google Chrome\.app/);
  assert.ok(chromeCandidates('linux', {}).includes('/usr/bin/chromium'));
  assert.match(chromeCandidates('win32', { PROGRAMFILES: 'C:\\PF' })[0], /^C:\\PF\\Google/);
});

test("the DevTools address comes from Chrome's start line", () => {
  assert.equal(
    devtoolsUrl('x\nDevTools listening on ws://127.0.0.1:5555/devtools/browser/ab-cd\n'),
    'ws://127.0.0.1:5555/devtools/browser/ab-cd',
  );
  assert.equal(devtoolsUrl('nothing yet'), null);
});

test('auto follows each format; png or pdf sends everything one way', () => {
  const boards = [board('a', 'post-square', 'png'), board('b', 'slide', 'pdf')];
  assert.deepEqual(
    plan(boards, 'auto').png.map((b) => b.name),
    ['a'],
  );
  assert.deepEqual(
    plan(boards, 'auto').pdf.map((b) => b.name),
    ['b'],
  );
  assert.equal(plan(boards, 'pdf').pdf.length, 2);
  assert.equal(plan(boards, 'png').png.length, 2);
});

test('file names are the slug and the artboard name, unique, with the format when unnamed', () => {
  assert.deepEqual(
    fileNames(
      'launch',
      [
        board('Square', 'post-square', 'png'),
        board('Square', 'post-square', 'png'),
        board('', 'story', 'png'),
      ],
      'png',
    ),
    ['launch-square.png', 'launch-square-2.png', 'launch-story-3.png'],
  );
});

test('the export URL carries the dial state and theme', () => {
  assert.equal(exportUrl('http://localhost:1', 'launch', {}), 'http://localhost:1/launch/?export=1');
  assert.equal(
    exportUrl('http://localhost:1', 'launch', { dials: '{"Review":{"fixtures":"longest"}}', theme: 'dark' }),
    'http://localhost:1/launch/?export=1&dials=%7B%22Review%22%3A%7B%22fixtures%22%3A%22longest%22%7D%7D&theme=dark',
  );
});

test('one PDF per format, named after the format only when there are several', () => {
  assert.deepEqual(pdfFiles('deck', [board('a', 'slide', 'pdf'), board('b', 'slide', 'pdf')]), [
    { format: 'slide', file: 'deck.pdf' },
  ]);
  assert.deepEqual(
    pdfFiles('deck', [board('a', 'slide', 'pdf'), board('b', 'a4', 'pdf'), board('c', 'slide', 'pdf')]),
    [
      { format: 'slide', file: 'deck-slide.pdf' },
      { format: 'a4', file: 'deck-a4.pdf' },
    ],
  );
});

test('DevTools messages are replies, page exceptions, or ignored', () => {
  assert.deepEqual(readDevtools('{"id":3,"result":{"a":1}}'), {
    kind: 'reply',
    id: 3,
    result: { a: 1 },
    error: undefined,
  });
  assert.deepEqual(readDevtools('{"id":4,"error":{"message":"No target"}}'), {
    kind: 'reply',
    id: 4,
    result: undefined,
    error: 'No target',
  });
  assert.deepEqual(
    readDevtools(
      '{"method":"Runtime.exceptionThrown","params":{"exceptionDetails":{"exception":{"description":"TypeError: x"}}}}',
    ),
    { kind: 'exception', text: 'TypeError: x' },
  );
  assert.deepEqual(readDevtools('{"method":"Runtime.exceptionThrown","params":{}}'), {
    kind: 'exception',
    text: 'An exception',
  });
  assert.deepEqual(readDevtools('{"method":"Page.loadEventFired"}'), { kind: 'other' });
});
