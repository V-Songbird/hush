'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { isRealUserPrompt, lastUserPromptText } = require('../hooks/lib/transcript');

const dirs = [];
after(() => {
  for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
});

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-tx-'));
  dirs.push(dir);
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  return file;
}

const human = (text, uuid) => ({ type: 'user', uuid: uuid || 'u', origin: { kind: 'human' }, message: { role: 'user', content: text } });
const assistant = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] } });
const taskNotification = (text) => ({ type: 'user', message: { role: 'user', content: `<task-notification>${text}</task-notification>` }, origin: { kind: 'task-notification' } });
const wakeup = (text) => ({ type: 'user', message: { role: 'user', content: text }, isMeta: true });

describe('isRealUserPrompt: only human-typed turns', () => {
  test('accepts a plain human prompt', () => {
    assert.strictEqual(isRealUserPrompt(human('hi')), true);
  });
  test('rejects task-notification and isMeta wakeup injections', () => {
    assert.strictEqual(isRealUserPrompt(taskNotification('done')), false);
    assert.strictEqual(isRealUserPrompt(wakeup('continue')), false);
  });
  test('rejects tool_result user lines', () => {
    assert.strictEqual(isRealUserPrompt(toolResult()), false);
  });
});

describe('lastUserPromptText', () => {
  test('returns the most recent human prompt text', () => {
    const file = writeTranscript([human('first', 'a'), assistant('...'), human('report every warning', 'b'), assistant('...')]);
    assert.strictEqual(lastUserPromptText(file), 'report every warning');
  });

  test('skips harness-injected continuations, returning the real prompt before them', () => {
    const file = writeTranscript([
      human('list all the files', 'a'),
      assistant('working'),
      taskNotification('bg task done'),
      assistant('still working'),
      wakeup('continue'),
    ]);
    assert.strictEqual(lastUserPromptText(file), 'list all the files');
  });

  test('joins text blocks of an array-content prompt', () => {
    const file = writeTranscript([
      { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'line one' }, { type: 'text', text: 'line two' }] } },
    ]);
    assert.strictEqual(lastUserPromptText(file), 'line one\nline two');
  });

  test('returns empty string when the file is missing (fail-safe)', () => {
    assert.strictEqual(lastUserPromptText(path.join(os.tmpdir(), 'hush-does-not-exist-xyz.jsonl')), '');
    assert.strictEqual(lastUserPromptText(undefined), '');
  });

  test('returns empty string when the tail holds no human prompt', () => {
    const file = writeTranscript([toolResult(), assistant('orphan')]);
    assert.strictEqual(lastUserPromptText(file), '');
  });
});
