'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runHook, hookOutput } = require('./helpers.js');
const { nudgeFor, STEP, TOOL, TURN, TURN_DIAL, TERSE } = require('../hooks/silence-nudge.js');

// lean's per-turn cap counts tool results inside one session; a shared id
// would let one test spend another's budget, so each case that touches the
// cap gets its own fresh one.
let sessionSeq = 0;
const freshSession = () => `nudge-test-${process.pid}-${sessionSeq++}`;

// --- default: one reminder at the top of the turn, nothing mid-turn -------

test('the default gets the dial reminder at the top of the turn', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN_DIAL);
});

test('the default stays silent on a tool result', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' });
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('an unknown event under the default stays silent too', () => {
  assert.strictEqual(nudgeFor('SomethingElse'), null);
});

// An empty/malformed payload has no hook_event_name, which resolves to
// PostToolUse (the common case) — and the default is silent there.
test('a malformed payload resolves to PostToolUse and stays silent under the default', () => {
  const r = runHook('silence-nudge.js', undefined);
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('a malformed payload still gets the reminder under max', () => {
  const out = hookOutput(runHook('silence-nudge.js', undefined, { HUSH_NUDGE: 'max' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TOOL);
});

test('HUSH_NUDGE=off silences the hook', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' }, { HUSH_NUDGE: 'off' });
  assert.strictEqual((r.stdout || '').trim(), '');
});

// `turn` predates the default switch and is now a no-op synonym for it —
// anyone who already set it keeps the exact behavior they opted into.
test('HUSH_NUDGE=turn is a synonym for the default', () => {
  const step = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' }, { HUSH_NUDGE: 'turn' });
  assert.strictEqual((step.stdout || '').trim(), '');
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }, { HUSH_NUDGE: 'turn' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN_DIAL);
});

// "until the work is done" is the measured loophole: the model calls the
// work done and announces the verification step. The dial's boundary is the
// final message itself — a refactor that reintroduces the work-done boundary
// would silently give back the measured leak cut.
test('the dial wording closes the work-done boundary', () => {
  assert.ok(/until the final message/.test(TURN_DIAL), TURN_DIAL);
  assert.ok(!/work is done/.test(TURN_DIAL), TURN_DIAL);
});

test('HUSH_DISABLE=1 beats the default', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }, { HUSH_DISABLE: '1' });
  assert.strictEqual((r.stdout || '').trim(), '');
});

// --- max: every tool result, doubled, plus the turn's own reminder --------

test('HUSH_NUDGE=max gets the step reminder on a tool result', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' }, { HUSH_NUDGE: 'max' }));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TOOL);
});

test('HUSH_NUDGE=max uses TURN, not the dial, at the top of the turn', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }, { HUSH_NUDGE: 'max' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN);
});

// Twice measured better than once and better than three times; a refactor
// that collapses the repetition would silently give back the measured win.
test('max states the step rule exactly twice', () => {
  assert.strictEqual(TOOL, `${STEP} ${STEP}`);
  assert.strictEqual(TOOL.split(STEP).length - 1, 2);
});

test('an unknown event under max falls back to the step reminder', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'SomethingElse' }, { HUSH_NUDGE: 'max' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TOOL);
});

test('HUSH_DISABLE=1 beats HUSH_NUDGE=max', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse' }, { HUSH_DISABLE: '1', HUSH_NUDGE: 'max' });
  assert.strictEqual((r.stdout || '').trim(), '');
});

// --- lean: the default's reminder, plus one short mid-turn ping -----------

test('HUSH_NUDGE=lean fires TERSE on the first tool result of a turn', () => {
  const out = hookOutput(runHook('silence-nudge.js', {
    hook_event_name: 'PostToolUse', session_id: freshSession(),
  }, { HUSH_NUDGE: 'lean' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TERSE);
});

test('HUSH_NUDGE=lean silences later tool results in the same turn', () => {
  const session = freshSession();
  const first = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session }, { HUSH_NUDGE: 'lean' }));
  assert.strictEqual(first.hookSpecificOutput.additionalContext, TERSE);
  const second = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session }, { HUSH_NUDGE: 'lean' });
  assert.strictEqual((second.stdout || '').trim(), '');
});

test('HUSH_NUDGE=lean refills the cap on a new turn', () => {
  const session = freshSession();
  runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session }, { HUSH_NUDGE: 'lean' });
  runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit', session_id: session }, { HUSH_NUDGE: 'lean' });
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session }, { HUSH_NUDGE: 'lean' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TERSE);
});

test('HUSH_NUDGE=lean uses the dial wording for the turn reminder', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit', session_id: freshSession() }, { HUSH_NUDGE: 'lean' }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN_DIAL);
});

test("the terse payload is the step rule's own first sentence", () => {
  assert.ok(STEP.startsWith(TERSE), `${TERSE} does not open ${STEP}`);
});

test('HUSH_DISABLE=1 beats HUSH_NUDGE=lean', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: freshSession() }, { HUSH_DISABLE: '1', HUSH_NUDGE: 'lean' });
  assert.strictEqual((r.stdout || '').trim(), '');
});

// --- cross-cutting ----------------------------------------------------------

// Both registrations inject context, so both have to answer to the
// product-wide disable — and it wins over an explicit HUSH_NUDGE=1.
for (const event of ['UserPromptSubmit', 'PostToolUse']) {
  test(`HUSH_DISABLE=1 silences the ${event} path even with HUSH_NUDGE=1`, () => {
    const r = runHook('silence-nudge.js', { hook_event_name: event }, { HUSH_DISABLE: '1', HUSH_NUDGE: '1' });
    assert.strictEqual((r.stdout || '').trim(), '');
  });
}

test('the reminder never names the behavior it is preventing', () => {
  // Wording that describes narrating primes narrating — measured twice.
  for (const text of [TURN, TOOL, TURN_DIAL, TERSE]) {
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
