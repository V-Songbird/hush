'use strict';

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { runHook, hookOutput } = require('./helpers.js');
const { nudgeFor, STEP, TOOL, TURN, TURN_DIAL, countMidTurnText } = require('../hooks/silence-nudge.js');

// The default's corrective counts mid-turn text blocks per session; a shared
// id would let one test spend another's state, so each case that touches the
// counter gets its own fresh one.
let sessionSeq = 0;
const freshSession = () => `nudge-test-${process.pid}-${sessionSeq++}`;

// A synthetic session transcript the corrective can read. Entries are the
// real JSONL shapes: real prompts are type:user with plain content; tool
// results are type:user with tool_result blocks; leaks are type:assistant
// with text blocks.
function writeTranscript(entries) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-nudge-'));
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}
const prompt = (text) => ({ type: 'user', message: { role: 'user', content: text } });
const toolResult = () => ({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', content: 'ok' }] } });
const leak = (text) => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text }] } });
const toolUse = () => ({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash' }] } });

// --- default: one reminder at the top of the turn, corrective mid-turn ------

test('the default gets the dial reminder at the top of the turn', () => {
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }));
  assert.strictEqual(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
  assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN_DIAL);
});

test('a clean turn gets nothing on a tool result', () => {
  const tp = writeTranscript([prompt('go'), toolUse(), toolResult()]);
  const r = runHook('silence-nudge.js', {
    hook_event_name: 'PostToolUse', session_id: freshSession(), transcript_path: tp,
  });
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('a mid-turn text block draws the corrective, exactly once', () => {
  const session = freshSession();
  const tp = writeTranscript([prompt('go'), toolUse(), leak('Now verifying the change.'), toolUse()]);
  const first = hookOutput(runHook('silence-nudge.js', {
    hook_event_name: 'PostToolUse', session_id: session, transcript_path: tp,
  }));
  assert.strictEqual(first.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.strictEqual(first.hookSpecificOutput.additionalContext, STEP);
  const second = runHook('silence-nudge.js', {
    hook_event_name: 'PostToolUse', session_id: session, transcript_path: tp,
  });
  assert.strictEqual((second.stdout || '').trim(), '', 'same block answered twice');
});

test('a second text block re-arms the corrective', () => {
  const session = freshSession();
  const tp1 = writeTranscript([prompt('go'), leak('first slip')]);
  hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session, transcript_path: tp1 }));
  const tp2 = writeTranscript([prompt('go'), leak('first slip'), toolUse(), leak('second slip')]);
  const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session, transcript_path: tp2 }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, STEP);
});

test('a new turn resets the corrective and its counter', () => {
  const session = freshSession();
  const tp1 = writeTranscript([prompt('go'), leak('slip')]);
  hookOutput(runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session, transcript_path: tp1 }));
  runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit', session_id: session });
  // The new turn's transcript ends with a fresh real prompt: nothing mid-turn
  // yet, so nothing fires — the old turn's block does not carry over.
  const tp2 = writeTranscript([prompt('go'), leak('slip'), prompt('next task'), toolUse()]);
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: session, transcript_path: tp2 });
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('a tool result entry is not a turn boundary', () => {
  // The leak sits before a tool_result-shaped user entry; only a REAL prompt
  // ends the count window, so the corrective still fires.
  const tp = writeTranscript([prompt('go'), leak('slip'), toolResult(), toolUse()]);
  const out = hookOutput(runHook('silence-nudge.js', {
    hook_event_name: 'PostToolUse', session_id: freshSession(), transcript_path: tp,
  }));
  assert.strictEqual(out.hookSpecificOutput.additionalContext, STEP);
});

test('subagent text is not this session\'s slip', () => {
  const entries = [prompt('go'), { ...leak('sidechain text'), isSidechain: true }, toolUse()];
  const tp = writeTranscript(entries);
  const r = runHook('silence-nudge.js', {
    hook_event_name: 'PostToolUse', session_id: freshSession(), transcript_path: tp,
  });
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('no transcript means no corrective', () => {
  const r = runHook('silence-nudge.js', { hook_event_name: 'PostToolUse', session_id: freshSession() });
  assert.strictEqual((r.stdout || '').trim(), '');
});

test('countMidTurnText counts blocks since the last real prompt only', () => {
  const tp = writeTranscript([prompt('one'), leak('a'), prompt('two'), leak('b'), leak('c')]);
  assert.strictEqual(countMidTurnText(tp), 2);
});

test('an unknown event under the default stays silent too', () => {
  assert.strictEqual(nudgeFor('SomethingElse'), null);
});

// An empty/malformed payload has no hook_event_name (resolves to PostToolUse)
// and no transcript — the corrective has nothing to react to.
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

// `turn`, `lean`, and `react` are earlier dial names, all kept working as
// no-op synonyms for the default — anyone who set one keeps a behavior at
// least as quiet and at least as cheap as what they opted into.
for (const synonym of ['turn', 'lean', 'react']) {
  test(`HUSH_NUDGE=${synonym} is a synonym for the default`, () => {
    const out = hookOutput(runHook('silence-nudge.js', { hook_event_name: 'UserPromptSubmit' }, { HUSH_NUDGE: synonym }));
    assert.strictEqual(out.hookSpecificOutput.additionalContext, TURN_DIAL);
    const step = runHook('silence-nudge.js', {
      hook_event_name: 'PostToolUse', session_id: freshSession(),
    }, { HUSH_NUDGE: synonym });
    assert.strictEqual((step.stdout || '').trim(), '');
  });
}

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
  for (const text of [TURN, TOOL, TURN_DIAL, STEP]) {
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
