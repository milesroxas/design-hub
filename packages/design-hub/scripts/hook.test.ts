import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mdWriting } from './hook.ts';

test('the writing pass is asked for on a Markdown file only', () => {
  const out = mdWriting({ tool_input: { file_path: '/p/docs/sprints/x/guide.md' } });
  assert.match(out?.systemMessage ?? '', /guide\.md/);
  assert.equal(out?.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.equal(mdWriting({ tool_input: { file_path: '/p/prototypes/x/index.tsx' } }), null);
  assert.equal(mdWriting({ tool_input: { file_path: '/p/node_modules/x/README.md' } }), null);
  assert.equal(mdWriting({}), null);
});
