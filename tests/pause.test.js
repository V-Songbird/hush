'use strict';

const { test, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { runHook, hookOutput } = require('./helpers.js');
const { PAUSED, RESUMED, isPaused } = require('../hooks/pause.js');
const { sessionDir } = require('../hooks/lib/sidecar-store.js');

// The pause flag lives in the session's sidecar directory; a shared id would
// let one test spend another's state, so each case gets a fresh one.
let sessionSeq = 0;
const freshSession = () => `pause-test-${process.pid}-${sessionSeq++}`;

after(() => {
  for (let i = 0; i < sessionSeq; i++) fs.rmSync(sessionDir(`pause-test-${process.pid}-${i}`), { recursive: true, force: true });
});

const run = (session, text, env) =>
  runHook('pause.js', { hook_event_name: 'UserPromptSubmit', session_id: session, prompt: text }, env);
const say = (session, text, env) => hookOutput(run(session, text, env));
const context = (out) => out.hookSpecificOutput.additionalContext;
const silent = (r) => assert.strictEqual((r.stdout || '').trim(), '');

// --- a turn outside a pause ---------------------------------------------------

// The hook once re-stated a silence rule on every turn. That request is gone:
// an ordinary prompt adds nothing to the session.
test('an ordinary prompt gets nothing', () => {
  silent(run(freshSession(), 'fix the failing suite'));
});

test('a malformed payload gets nothing', () => {
  silent(runHook('pause.js', undefined));
});

test('an event other than UserPromptSubmit gets nothing, even in a paused session', () => {
  const s = freshSession();
  say(s, 'hush off');
  silent(runHook('pause.js', { hook_event_name: 'PostToolUse', session_id: s }));
});

// HUSH_NUDGE picked the reminder level; with the reminders gone it is read
// nowhere, so a value someone still has set changes nothing.
for (const value of ['off', 'max']) {
  test(`a leftover HUSH_NUDGE=${value} changes nothing`, () => {
    const s = freshSession();
    silent(run(s, 'go', { HUSH_NUDGE: value }));
    assert.ok(context(say(s, 'hush off', { HUSH_NUDGE: value })).startsWith(PAUSED));
  });
}

// --- the pause switch ---------------------------------------------------------

test('"hush off" pauses the voice and asks for a one-line confirmation', () => {
  const s = freshSession();
  const text = context(say(s, 'hush off'));
  assert.ok(text.startsWith(PAUSED), text);
  assert.match(text, /confirm in one line that Hush is paused/);
  assert.ok(isPaused(s));
});

test('a paused session gets the pause text on every later turn, without the confirmation', () => {
  const s = freshSession();
  say(s, 'hush off');
  assert.strictEqual(context(say(s, 'now explain the cache layer in depth')), PAUSED);
});

test('"hush on" ends the pause, asks for a one-line confirmation, then goes quiet', () => {
  const s = freshSession();
  say(s, 'hush off');
  const text = context(say(s, 'hush on'));
  assert.strictEqual(text, RESUMED);
  assert.match(text, /Confirm in one line that Hush is back/);
  assert.ok(!isPaused(s));
  silent(run(s, 'next task'));
});

test('"hush on" with no pause is an ordinary prompt', () => {
  silent(run(freshSession(), 'hush on'));
});

test('the switch reads the whole prompt, in any case, with a slash or "stop hush"', () => {
  for (const text of ['Hush Off', ' /hush off. ', 'stop hush', 'HUSH OFF!']) {
    const s = freshSession();
    say(s, text);
    assert.ok(isPaused(s), text);
  }
  for (const text of ['turn hush off for the build step', 'hush off and then fix the test', 'what does hush off do?']) {
    const s = freshSession();
    silent(run(s, text));
    assert.ok(!isPaused(s), text);
  }
});

test('one session\'s pause leaves another session alone', () => {
  say(freshSession(), 'hush off');
  silent(run(freshSession(), 'go'));
});

test('the pause keeps the items no setting removes', () => {
  assert.match(PAUSED, /A blocker, a failed check, an unverified claim and a pending approval still get said/);
});

for (const off of [{ HUSH_QUIET: 'off' }, { HUSH_DISABLE: '1' }]) {
  test(`${JSON.stringify(off)} leaves the pause switch off too`, () => {
    const s = freshSession();
    silent(run(s, 'hush off', off));
    assert.ok(!isPaused(s));
  });
}

// --- the voice and the registration ---------------------------------------------

const read = (...parts) => fs.readFileSync(path.join(__dirname, '..', ...parts), 'utf-8');

// The silence request was removed on a measured result. A rewording that
// brings it back should be a decision, not a drift.
test('the shipped voice carries no silence request', () => {
  const voice = read('output-styles', 'hush.md') + read('hooks', 'voice-app.md');
  assert.ok(!/between tool calls|Quiet while you work|stay silent/i.test(voice));
});

const HOOKS = JSON.parse(read('hooks', 'hooks.json')).hooks;

test('the pause hook is registered for UserPromptSubmit only', () => {
  const events = Object.keys(HOOKS).filter((event) =>
    HOOKS[event].some((entry) => (entry.hooks || []).some((h) => (h.args || []).some((a) => a.includes('pause.js'))))
  );
  assert.deepStrictEqual(events, ['UserPromptSubmit']);
});

// Exec form spawns node directly with the script as its one argument, so no
// shell runs and no platform needs its own command line.
test('every registered hook runs node in exec form', () => {
  for (const list of Object.values(HOOKS)) {
    for (const entry of list) {
      for (const h of entry.hooks || []) {
        assert.strictEqual(h.command, 'node', JSON.stringify(h));
        assert.match((h.args || []).join(' '), /^\$\{CLAUDE_PLUGIN_ROOT\}\/hooks\/[a-z-]+\.js$/, JSON.stringify(h));
        assert.ok(!('commandWindows' in h), `commandWindows is never read: ${h.args}`);
      }
    }
  }
});
