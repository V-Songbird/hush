'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHook, hookOutput } = require('./helpers');
const { measureLastTurn, measureCurrentTurn, wordCount } = require('../hooks/narration-meter');

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

describe('unit: measureLastTurn', () => {
  test('final block is the deliverable, not narration', () => {
    const { narration, blocks } = measureLastTurn([
      userPrompt('do thing'),
      assistantText(words(50)),
      toolResult(),
      assistantText(words(200)),
    ]);
    assert.strictEqual(narration, 50);
    assert.strictEqual(blocks, 1);
  });

  test('single-block turn counts zero narration', () => {
    const { narration } = measureLastTurn([userPrompt('q'), assistantText(words(500))]);
    assert.strictEqual(narration, 0);
  });

  test('tool_result user lines do not end the turn scan', () => {
    const { narration } = measureLastTurn([
      userPrompt('go'),
      assistantText(words(30)),
      toolResult(),
      assistantText(words(30)),
      toolResult(),
      assistantText(words(5)),
    ]);
    assert.strictEqual(narration, 60);
  });

  test('previous turns are excluded', () => {
    const { narration } = measureLastTurn([
      userPrompt('first'),
      assistantText(words(999)),
      userPrompt('second'),
      assistantText(words(10)),
      assistantText(words(5)),
    ]);
    assert.strictEqual(narration, 10);
  });

  test('sidechain (subagent) entries are ignored', () => {
    const { narration } = measureLastTurn([
      userPrompt('go'),
      assistantText(words(40)),
      assistantText(words(500), { isSidechain: true }),
      assistantText(words(5)),
    ]);
    assert.strictEqual(narration, 40);
  });

  test('wordCount ignores extra whitespace', () => {
    assert.strictEqual(wordCount('  a\n b\tc  '), 3);
  });

  test('task-notification does not reset the turn: pings across it accumulate', () => {
    const { narration, blocks } = measureLastTurn([
      userPrompt('run the four audits'),
      assistantText(words(20)), // status ping after audit 1
      taskNotification('audit 2 done'),
      assistantText(words(20)), // status ping after audit 2
      taskNotification('audit 3 done'),
      assistantText(words(20)), // status ping after audit 3
      taskNotification('audit 4 done'),
      assistantText(words(30)), // final synthesis
    ]);
    assert.strictEqual(narration, 60);
    assert.strictEqual(blocks, 3);
  });

  test('ScheduleWakeup firing (isMeta) does not reset the turn either', () => {
    const { narration } = measureLastTurn([
      userPrompt('go'),
      assistantText(words(15)), // "waiting on it, will report back"
      wakeupFired('check background agent and continue'),
      assistantText(words(10)), // final message
    ]);
    assert.strictEqual(narration, 15);
  });

  test('measureCurrentTurn counts every block — mid-turn has no deliverable yet', () => {
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

  test('turnKey changes when a new real prompt starts a turn', () => {
    const a = measureCurrentTurn([userPrompt('one', 'turn-a'), assistantText(words(5))]);
    const b = measureCurrentTurn([userPrompt('one', 'turn-a'), userPrompt('two', 'turn-b'), assistantText(words(5))]);
    assert.notStrictEqual(a.turnKey, b.turnKey);
  });
});

describe('hook: end to end', () => {
  test('under budget stays silent', () => {
    const file = writeTranscript([userPrompt('go'), assistantText(words(10)), assistantText(words(5))]);
    const r = runHook('narration-meter.js', { transcript_path: file });
    assert.strictEqual(hookOutput(r), null);
  });

  test('over budget injects one corrective line', () => {
    const file = writeTranscript([userPrompt('go'), assistantText(words(300)), assistantText(words(5))]);
    const r = runHook('narration-meter.js', { transcript_path: file, session_id: freshSession() });
    const out = hookOutput(r);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'Stop');
    assert.match(out.hookSpecificOutput.additionalContext, /300 words/);
  });

  test('budget is tunable via HUSH_NARRATION_BUDGET', () => {
    const file = writeTranscript([userPrompt('go'), assistantText(words(30)), assistantText(words(5))]);
    const r = runHook(
      'narration-meter.js',
      { transcript_path: file, session_id: freshSession() },
      { HUSH_NARRATION_BUDGET: '10' }
    );
    assert.match(hookOutput(r).hookSpecificOutput.additionalContext, /30 words/);
  });

  test('consecutive Stops in the same turn fire only once (wakeup chain)', () => {
    // A ScheduleWakeup continuation stops several times without a new human
    // prompt; the second and later Stops must not re-fire.
    const session = freshSession();
    const turn = [userPrompt('go', 't1'), assistantText(words(300)), assistantText(words(5))];
    const first = runHook('narration-meter.js', { transcript_path: writeTranscript(turn), session_id: session });
    assert.notStrictEqual(hookOutput(first), null);
    const grown = writeTranscript([...turn, wakeupFired('continue'), assistantText(words(50)), assistantText(words(5))]);
    const second = runHook('narration-meter.js', { transcript_path: grown, session_id: session });
    assert.strictEqual(hookOutput(second), null);
  });

  test('missing transcript stays silent', () => {
    const r = runHook('narration-meter.js', { transcript_path: 'Z:\\nope\\missing.jsonl' });
    assert.strictEqual(hookOutput(r), null);
  });

  test('HUSH_DISABLE=1 bypasses', () => {
    const file = writeTranscript([userPrompt('go'), assistantText(words(300)), assistantText(words(5))]);
    const r = runHook('narration-meter.js', { transcript_path: file }, { HUSH_DISABLE: '1' });
    assert.strictEqual(hookOutput(r), null);
  });

  test('HUSH_NARRATION=off disables the meter alone', () => {
    const file = writeTranscript([userPrompt('go'), assistantText(words(300)), assistantText(words(5))]);
    const r = runHook(
      'narration-meter.js',
      { transcript_path: file, session_id: freshSession() },
      { HUSH_NARRATION: 'off' }
    );
    assert.strictEqual(hookOutput(r), null);
  });
});

describe('hook: mid-turn mode (PostToolUse)', () => {
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

  test('fires at most once per turn', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(200))]);
    const session = freshSession();
    const input = { transcript_path: file, session_id: session, hook_event_name: 'PostToolUse' };
    assert.notStrictEqual(hookOutput(runHook('narration-meter.js', input)), null);
    assert.strictEqual(hookOutput(runHook('narration-meter.js', input)), null);
  });

  test('Stop stays silent when mid-turn already corrected this turn', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(200)), assistantText(words(5))]);
    const session = freshSession();
    runHook('narration-meter.js', { transcript_path: file, session_id: session, hook_event_name: 'PostToolUse' });
    const r = runHook('narration-meter.js', { transcript_path: file, session_id: session, hook_event_name: 'Stop' });
    assert.strictEqual(hookOutput(r), null);
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

  test('under budget stays silent mid-turn', () => {
    const file = writeTranscript([userPrompt('go', 't1'), assistantText(words(10))]);
    const r = runHook('narration-meter.js', {
      transcript_path: file,
      session_id: freshSession(),
      hook_event_name: 'PostToolUse',
    });
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
