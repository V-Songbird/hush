'use strict';

// Conformance fixture: hush keeps its own copy of isRealUserPrompt
// (turn-boundary detection) because each plugin that needs it is an
// independent repo with no shared code to import from. Every copy must stay
// behaviorally identical, so this exact fixture is duplicated verbatim in
// each of those plugins' test suites — a future edit that drifts one copy
// away from the others fails that plugin's own suite immediately instead of
// silently desyncing per-turn accounting across the set. Do not resolve a
// failure here by editing this fixture; edit the plugin whose
// isRealUserPrompt actually diverged.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { isRealUserPrompt } = require('../hooks/lib/transcript');

const FIXTURES = [
  {
    name: 'string content, origin absent',
    entry: { type: 'user', message: { role: 'user', content: 'do the thing' } },
    expected: true,
  },
  {
    name: 'human prompt',
    entry: { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: 'do the thing' } },
    expected: true,
  },
  {
    name: 'array content, text block only',
    entry: { type: 'user', origin: { kind: 'human' }, message: { role: 'user', content: [{ type: 'text', text: 'do the thing' }] } },
    expected: true,
  },
  {
    name: 'task-notification',
    entry: {
      type: 'user',
      origin: { kind: 'task-notification' },
      message: { role: 'user', content: '<task-notification>done</task-notification>' },
    },
    expected: false,
  },
  {
    name: 'isMeta wakeup (no origin key)',
    entry: { type: 'user', isMeta: true, message: { role: 'user', content: 'continue' } },
    expected: false,
  },
  {
    name: 'sidechain',
    entry: { type: 'user', isSidechain: true, origin: { kind: 'human' }, message: { role: 'user', content: 'do the thing' } },
    expected: false,
  },
  {
    name: 'array content, tool_result block',
    entry: {
      type: 'user',
      message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
    },
    expected: false,
  },
  {
    name: 'assistant entry',
    entry: { type: 'assistant', message: { role: 'assistant', content: 'ok' } },
    expected: false,
  },
  {
    name: 'empty/undefined content',
    entry: { type: 'user', origin: { kind: 'human' }, message: { role: 'user' } },
    expected: false,
  },
];

describe('trio conformance: isRealUserPrompt turn-boundary fixture', () => {
  for (const { name, entry, expected } of FIXTURES) {
    test(`${name} -> ${expected}`, () => {
      assert.strictEqual(isRealUserPrompt(entry), expected);
    });
  }
});
