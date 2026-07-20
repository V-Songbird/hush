'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runHook, hookOutput } = require('./helpers.js');
const { nudgeFor, STEP, TOOL, TURN } = require('../hooks/silence-nudge.js');

test('PostToolUse gets the step reminder', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' }));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TOOL);
});

test('UserPromptSubmit gets the turn reminder', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN);
});

// Twice measured better than once and better than three times; a refactor that
// collapses the repetition would silently give back the measured improvement.
test('the tool reminder states the step rule exactly twice', () => {
  assert.strictEqual(TOOL, `${STEP} ${STEP}`);
  assert.strictEqual(TOOL.split(STEP).length - 1, 2);
});

test('an unknown event falls back to the tool reminder', () => {
  assert.strictEqual(nudgeFor('SomethingElse'), TOOL);
});

test('a malformed payload still nudges', () => {
  const out = hookOutput(runHook('silence-nudge.js', undefined));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TOOL);
});

test('HUSH_NUDGE=off silences the hook', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' }, { HUSH_NUDGE: 'off' });
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('the reminder never names the behavior it is preventing', () => {
  // Wording that describes narrating primes narrating — measured twice.
  for (const text of [TURN, TOOL]) {
    assert.ok(!/narrat|preface|commentary|do not write|don't write/i.test(text), text);
  }
});

test('both hook events are registered in hooks.json', () => {
  const hooks = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf-8')
  );
  const registered = (list) =>
    (list || []).some((entry) =>
      (entry.hooks || []).some((h) => (h.command || '').includes('silence-nudge.js'))
    );
  assert.ok(registered(hooks.hooks.UserPromptSubmit), 'UserPromptSubmit');
  assert.ok(registered(hooks.hooks.PostToolUse), 'PostToolUse');
});

test('every registered command has a Windows counterpart', () => {
  const hooks = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'hooks', 'hooks.json'), 'utf-8')
  );
  for (const list of Object.values(hooks.hooks)) {
    for (const entry of list) {
      for (const h of entry.hooks || []) {
        assert.ok(h.commandWindows, `missing commandWindows: ${h.command}`);
      }
    }
  }
});
