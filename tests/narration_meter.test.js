'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHook, hookOutput } = require('./helpers');
const { measureCurrentTurn, wordCount, stepMeter } = require('../hooks/narration-meter');

function userPrompt(text, uuid) {
  return JSON.stringify({ type: 'user', uuid: uuid || 'u1', message: { role: 'user', content: text } });
}

function assistantText(text, extra) {
  return JSON.stringify({
    type: 'assistant',
    message: { role: 'assistant', content: [{ type: 'text', text }] },
    ...(extra || {}),
  });
}

function toolResult() {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'ok' }] },
  });
}

// Background Task-tool completion: type:"user", string content, origin.kind
// marks it as harness-injected rather than typed by a person.
function taskNotification(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: `<task-notification>${text}</task-notification>` },
    origin: { kind: 'task-notification' },
  });
}

// ScheduleWakeup firing: type:"user", string content (the wakeup's reason/
// prompt), isMeta:true, no origin field at all.
function wakeupFired(text) {
  return JSON.stringify({
    type: 'user',
    message: { role: 'user', content: text },
    isMeta: true,
  });
}

const transcriptDirs = [];

function writeTranscript(lines) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-'));
  transcriptDirs.push(dir);
  const file = path.join(dir, 't.jsonl');
  fs.writeFileSync(file, lines.join('\n') + '\n');
  return file;
}

const words = (n) => Array.from({ length: n }, (_, i) => `w${i}`).join(' ');

let seq = 0;
const freshSession = () => `hush-test-${process.pid}-${++seq}`;

// The hook writes its dedup state into os.tmpdir(); without cleanup a stale
// state file can collide with a later run (or, for a session_id-less input,
// with the shared "unknown" key).
after(() => {
  for (let i = 1; i <= seq; i++) {
    fs.rmSync(path.join(os.tmpdir(), `hush-meter-hush-test-${process.pid}-${i}.json`), { force: true });
  }
  for (const dir of transcriptDirs) fs.rmSync(dir, { recursive: true, force: true });
});

describe('unit: measureCurrentTurn', () => {
  test('counts every block — mid-turn has no deliverable yet', () => {
    const { narration, blocks, turnKey } = measureCurrentTurn([
      userPrompt('go', 'turn-a'),
      assistantText(words(30)),
      toolResult(),
      assistantText(words(25)),
    ]);
    assert.strictEqual(narration, 55);
    assert.strictEqual(blocks, 2);
    assert.strictEqual(turnKey, 'turn-a');
  });

  test('previous turns are excluded', () => {
    const { narration } = measureCurrentTurn([
      userPrompt('first'),
      assistantText(words(999)),
      userPrompt('second'),
      assistantText(words(10)),
      assistantText(words(5)),
    ]);
    assert.strictEqual(narration, 15);
  });

  test('sidechain (subagent) entries are ignored', () => {
    const { narration } = measureCurrentTurn([
      userPrompt('go'),
      assistantText(words(40)),
      assistantText(words(500), { isSidechain: true }),
      assistantText(words(5)),
    ]);
    assert.strictEqual(narration, 45);
  });

  test('wordCount ignores extra whitespace', () => {
    assert.strictEqual(wordCount('  a\n b\tc  '), 3);
  });

  test('task-notification does not reset the turn: pings across it accumulate', () => {
    const { narration, blocks } = measureCurrentTurn([
      userPrompt('run the four audits'),
      assistantText(words(20)), // status ping after audit 1
      taskNotification('audit 2 done'),
      assistantText(words(20)), // status ping after audit 2
      taskNotification('audit 3 done'),
      assistantText(words(20)), // status ping after audit 3
      taskNotification('audit 4 done'),
      assistantText(words(30)), // final synthesis
    ]);
    assert.strictEqual(narration, 90);
    assert.strictEqual(blocks, 4);
  });

  test('ScheduleWakeup firing (isMeta) does not reset the turn either', () => {
    const { narration } = measureCurrentTurn([
      userPrompt('go'),
      assistantText(words(15)), // "waiting on it, will report back"
      wakeupFired('check background agent and continue'),
      assistantText(words(10)), // final message
    ]);
    assert.strictEqual(narration, 25);
  });

  test('turnKey changes when a new real prompt starts a turn', () => {
    const a = measureCurrentTurn([userPrompt('one', 'turn-a'), assistantText(words(5))]);
    const b = measureCurrentTurn([userPrompt('one', 'turn-a'), userPrompt('two', 'turn-b'), assistantText(words(5))]);
    assert.notStrictEqual(a.turnKey, b.turnKey);
  });
});

describe('unit: stepMeter firing decision', () => {
  test('first crossing of the budget fires and records where', () => {
    assert.strictEqual(stepMeter(undefined, 't1', 120, 120).fire, false);
    assert.deepStrictEqual(stepMeter(undefined, 't1', 149, 120), {
      fire: true,
      nextState: { turnKey: 't1', firedAt: 149 },
    });
  });

  test('after a correction, growth below a quarter-budget stays silent', () => {
    const state = { turnKey: 't1', firedAt: 149 };
    assert.strictEqual(stepMeter(state, 't1', 178, 120).fire, false);
  });

  test('a quarter-budget of fresh narration re-fires and re-anchors', () => {
    const state = { turnKey: 't1', firedAt: 149 };
    assert.deepStrictEqual(stepMeter(state, 't1', 179, 120), {
      fire: true,
      nextState: { turnKey: 't1', firedAt: 179 },
    });
  });

  test('a new turn starts the ladder over at the full budget', () => {
    const state = { turnKey: 't1', firedAt: 500 };
    assert.strictEqual(stepMeter(state, 't2', 100, 120).fire, false);
    assert.strictEqual(stepMeter(state, 't2', 121, 120).fire, true);
  });

  test('legacy once-per-turn state (no firedAt) anchors at current narration', () => {
    const state = { turnKey: 't1' };
    assert.strictEqual(stepMeter(state, 't1', 400, 120).fire, false);
  });
});

describe('hook: end to end (PostToolUse)', () => {
  test('under budget stays silent', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(10))]);
    const r = runHook('narration-meter.js', {
      transcript_path: file,
      session_id: freshSession(),
      hook_event_name: 'PostToolUse',
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('fires inside the turn the moment budget is crossed', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(200))]);
    const r = runHook('narration-meter.js', {
      transcript_path: file,
      session_id: freshSession(),
      hook_event_name: 'PostToolUse',
    });
    const out = hookOutput(r);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /200 words/);
  });

  test('budget is tunable via HUSH_NARRATION_BUDGET', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(30))]);
    const r = runHook(
      'narration-meter.js',
      { transcript_path: file, session_id: freshSession(), hook_event_name: 'PostToolUse' },
      { HUSH_NARRATION_BUDGET: '10' }
    );
    assert.match(hookOutput(r).hookSpecificOutput.additionalContext, /30 words/);
  });

  test('does not repeat without new narration', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(200))]);
    const session = freshSession();
    const input = { transcript_path: file, session_id: session, hook_event_name: 'PostToolUse' };
    assert.notStrictEqual(hookOutput(runHook('narration-meter.js', input)), null);
    assert.strictEqual(hookOutput(runHook('narration-meter.js', input)), null);
  });

  test('re-arms after a quarter-budget of fresh narration since the last correction', () => {
    const session = freshSession();
    const turn = [userPrompt('go', 't1'), assistantText(words(200))];
    const first = writeTranscript(turn);
    assert.notStrictEqual(
      hookOutput(runHook('narration-meter.js', { transcript_path: first, session_id: session, hook_event_name: 'PostToolUse' })),
      null
    );
    // +20 words since the correction: under the 30-word re-arm step, silent.
    const under = writeTranscript([...turn, toolResult(), assistantText(words(20))]);
    assert.strictEqual(
      hookOutput(runHook('narration-meter.js', { transcript_path: under, session_id: session, hook_event_name: 'PostToolUse' })),
      null
    );
    // +30 words total since the correction: re-arm step reached, fires again.
    const over = writeTranscript([...turn, toolResult(), assistantText(words(20)), toolResult(), assistantText(words(10))]);
    const r = hookOutput(runHook('narration-meter.js', { transcript_path: over, session_id: session, hook_event_name: 'PostToolUse' }));
    assert.match(r.hookSpecificOutput.additionalContext, /230 words/);
  });

  test('a new turn re-arms the meter', () => {
    const session = freshSession();
    const turn1 = writeTranscript([userPrompt('go', 't1'), assistantText(words(200))]);
    runHook('narration-meter.js', { transcript_path: turn1, session_id: session, hook_event_name: 'PostToolUse' });
    const turn2 = writeTranscript([
      userPrompt('go', 't1'),
      assistantText(words(200)),
      userPrompt('next', 't2'),
      assistantText(words(200)),
    ]);
    const r = runHook('narration-meter.js', { transcript_path: turn2, session_id: session, hook_event_name: 'PostToolUse' });
    assert.notStrictEqual(hookOutput(r), null);
  });

  test('missing transcript stays silent', () => {
    const r = runHook('narration-meter.js', {
      transcript_path: 'Z:\\nope\\missing.jsonl',
      hook_event_name: 'PostToolUse',
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('HUSH_DISABLE=1 bypasses', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(200))]);
    const r = runHook(
      'narration-meter.js',
      { transcript_path: file, hook_event_name: 'PostToolUse' },
      { HUSH_DISABLE: '1' }
    );
    assert.strictEqual(hookOutput(r), null);
  });

  test('HUSH_NARRATION=off disables the meter alone', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(200))]);
    const r = runHook(
      'narration-meter.js',
      { transcript_path: file, session_id: freshSession(), hook_event_name: 'PostToolUse' },
      { HUSH_NARRATION: 'off' }
    );
    assert.strictEqual(hookOutput(r), null);
  });

  test('tail window: current turn at the end of a >1MB transcript still measures', () => {
    const filler = assistantText('x'.repeat(2 * 1024 * 1024)); // old turn, one giant block
    const file = writeTranscript([userPrompt('old', 't1'), filler, userPrompt('new', 't2'), assistantText(words(200))]);
    const r = runHook('narration-meter.js', {
      transcript_path: file,
      session_id: freshSession(),
      hook_event_name: 'PostToolUse',
    });
    assert.match(hookOutput(r).hookSpecificOutput.additionalContext, /200 words/);
  });
});

describe('hook: Stop is a deliberate no-op', () => {
  // A Stop hook can only give feedback via hookSpecificOutput.additionalContext,
  // and Claude Code forces the conversation to continue whenever that's set —
  // there's no way to attach context at Stop without triggering another model
  // turn. By Stop time the real work is already done, so that forced turn has
  // nothing to act on but the correction itself and reliably degenerates into
  // an unsolicited acknowledgment reply. The meter must never fire here,
  // regardless of how far over budget the turn ran.
  test('over-budget turn produces no output when hook_event_name is Stop', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(300)), assistantText(words(5))]);
    const r = runHook('narration-meter.js', {
      transcript_path: file,
      session_id: freshSession(),
      hook_event_name: 'Stop',
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('missing hook_event_name is also a no-op', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(300))]);
    const r = runHook('narration-meter.js', { transcript_path: file, session_id: freshSession() });
    assert.strictEqual(hookOutput(r), null);
  });
});
