'use strict';

// HUSH_DISABLE=1 is the product-wide runtime off switch: every hook must stay
// silent (no stdout at all, so no injected context and no rewritten tool
// output) and must leave the filesystem exactly as it found it — no state
// file, sidecar, debug manifest, or session sentinel created, mutated, or
// deleted.
//
// Each hook is exercised twice with the SAME payload: once disabled (must be
// inert) and once enabled (must actually do something). The enabled run is
// what keeps the disabled assertion honest — a payload that triggers nothing
// would pass the inert check vacuously.
//
// The subprocess's TEMP/TMP point at a fresh scratch directory per run, so
// os.tmpdir() inside the hook resolves there and the whole tree can be
// snapshotted before and after. Fixtures the hooks only READ (transcripts)
// live outside that tree so they never appear in the diff.
//
// The matrix is keyed on REGISTRATION — script plus the event it is registered
// for — and the key set is derived from hooks.json rather than written out
// here, so registering an existing script on a second event, or adding a new
// script entirely, fails this file until it has a payload of its own. One
// script registered twice is two entries in the contract, and the two can
// behave differently.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { HOOKS_DIR } = require('./helpers');

const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-disable-'));
const FIXTURES = path.join(SCRATCH_ROOT, 'fixtures');
fs.mkdirSync(FIXTURES, { recursive: true });

after(() => {
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

let seq = 0;
const freshSessionId = () => `d${crypto.randomBytes(4).toString('hex')}${++seq}`;

/**
 * A scratch TEMP tree pre-populated with the hush-owned files a live session
 * would already have, so deletion and mutation are both observable.
 */
function plantedTemp(sessionId, tag) {
  const dir = path.join(SCRATCH_ROOT, `temp-${sessionId}-${tag}`);
  const safe = sessionId.replace(/[^a-zA-Z0-9-]/g, '_');
  fs.mkdirSync(path.join(dir, 'hush-sidecar', safe), { recursive: true });
  fs.writeFileSync(path.join(dir, `hush-note-${sessionId}`), '');
  fs.writeFileSync(path.join(dir, `hush-debug-${safe}.jsonl`), '');
  fs.writeFileSync(path.join(dir, 'hush-sidecar', safe, 'planted.txt'), 'kept\n');
  return dir;
}

/** Recursive relpath -> content-hash map; catches creation, deletion, and mutation. */
function snapshot(dir) {
  const out = {};
  const walk = (current, prefix) => {
    for (const entry of fs.readdirSync(current, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const full = path.join(current, entry.name);
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(full, rel);
      } else {
        out[rel] = crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex');
      }
    }
  };
  walk(dir, '');
  return out;
}

function runHookIn(name, tempDir, stdinData, env) {
  return spawnSync('node', [path.join(HOOKS_DIR, name)], {
    input: stdinData === undefined ? undefined : JSON.stringify(stdinData),
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, ...(env || {}), TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
  });
}

// Every feature flag a hook consults is forced ON, so the disable gate is the
// only thing that can be producing the silence. HUSH_DISABLE is pinned off
// here too: an ambient HUSH_DISABLE=1 in the developer's shell would otherwise
// make every enabled control run inert. The disabled runs override it to '1'.
const LOUD = { HUSH_DEBUG: '1', HUSH_WRAP: '1', HUSH_NUDGE: 'max', HUSH_DISABLE: '0' };

function writeFixture(name, content) {
  const file = path.join(FIXTURES, name);
  fs.writeFileSync(file, content);
  return file;
}

// ~18KB across 300 unique lines: past the sidecar threshold (a disk write) and
// well past the line cap (a rewritten tool output), with signal lines in it.
const NOISY_OUTPUT = Array.from(
  { length: 300 },
  (_, i) => `2026-07-28T10:00:${String(i % 60).padStart(2, '0')} worker-${i} step ${i} of the build finished, artifact ${i} written to disk ok`
).join('\n');

const NARRATION = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');

const TRANSCRIPT = writeFixture(
  'narration.jsonl',
  [
    JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: NARRATION }] } }),
  ].join('\n') + '\n'
);

/**
 * Every hook, each with a payload that provably triggers it. `writes` marks
 * the hooks whose enabled run is expected to touch disk rather than (or as
 * well as) print.
 */
function cases() {
  const c = [];
  const compressSession = freshSessionId();
  c.push({
    name: 'compress-tool-output.js',
    session: compressSession,
    input: {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: compressSession,
      transcript_path: TRANSCRIPT,
      tool_input: { command: 'node build.js' },
      tool_response: NOISY_OUTPUT,
    },
    writes: true,
  });
  c.push({
    name: 'silence-nudge.js',
    session: freshSessionId(),
    input: { hook_event_name: 'UserPromptSubmit' },
  });
  c.push({
    name: 'silence-nudge.js',
    label: 'silence-nudge.js (PostToolUse)',
    session: freshSessionId(),
    input: { hook_event_name: 'PostToolUse' },
  });
  c.push({
    name: 'preserve-exit-code.js',
    session: freshSessionId(),
    input: {
      hook_event_name: 'PreToolUse',
      tool_name: 'Bash',
      permission_mode: 'bypassPermissions',
      tool_input: { command: 'node build.js' },
    },
  });
  c.push({
    name: 'subagent-brief.js',
    session: freshSessionId(),
    input: { hook_event_name: 'SubagentStart', agent_type: 'claude' },
  });
  const compactSession = freshSessionId();
  c.push({
    name: 'precompact-summary.js',
    session: compactSession,
    input: { hook_event_name: 'PreCompact', session_id: compactSession },
  });
  const rearmSession = freshSessionId();
  c.push({
    name: 'postcompact-rearm.js',
    session: rearmSession,
    input: { hook_event_name: 'PostCompact', session_id: rearmSession },
    writes: true,
    silentWhenEnabled: true, // its whole job is deletion; it never prints
  });
  const endSession = freshSessionId();
  c.push({
    name: 'session-end-cleanup.js',
    session: endSession,
    input: { hook_event_name: 'SessionEnd', session_id: endSession, reason: 'exit' },
    writes: true,
    silentWhenEnabled: true, // deletion only, and SessionEnd output goes nowhere
  });
  return c;
}

const ALL = cases();

/** Every `script.js@Event` pair hooks.json actually registers. */
function registeredPairs() {
  const hooks = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf-8'));
  const pairs = new Set();
  for (const [event, list] of Object.entries(hooks.hooks)) {
    for (const entry of list) {
      for (const h of entry.hooks || []) {
        const m = /([a-z-]+\.js)/.exec(h.command || '');
        if (m) pairs.add(`${m[1]}@${event}`);
      }
    }
  }
  return pairs;
}

const pairOf = (c) => `${c.name}@${c.input.hook_event_name}`;

describe('HUSH_DISABLE=1 conformance across every hook', () => {
  for (const c of ALL) {
    const label = c.label || c.name;

    test(`${label}: disabled emits nothing and touches no file`, () => {
      const temp = plantedTemp(c.session, 'off');
      const before = snapshot(temp);
      const r = runHookIn(c.name, temp, c.input, { ...LOUD, HUSH_DISABLE: '1' });
      assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
      // No stdout at all is the whole contract in one assertion: every channel
      // a hook has — updated tool input or output, injected additional
      // context, a decision — travels as JSON on stdout and nowhere else.
      assert.strictEqual(r.stdout, '', `stdout leaked: ${r.stdout}`);
      assert.deepStrictEqual(snapshot(temp), before, 'filesystem changed under a disabled session');
    });

    test(`${label}: the same payload is not inert when enabled`, () => {
      const temp = plantedTemp(c.session, 'on');
      const before = snapshot(temp);
      const r = runHookIn(c.name, temp, c.input, LOUD);
      assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
      const printed = (r.stdout || '') !== '';
      const touched = JSON.stringify(snapshot(temp)) !== JSON.stringify(before);
      if (!c.silentWhenEnabled) assert.ok(printed, 'enabled run printed nothing — payload does not trigger this hook');
      if (c.writes) assert.ok(touched, 'enabled run touched no file — payload does not exercise the disk path');
    });
  }

  test('every hook REGISTRATION in hooks.json has a payload here, event by event', () => {
    const registered = registeredPairs();
    const covered = new Set(ALL.map(pairOf));
    assert.deepStrictEqual([...registered].sort(), [...covered].sort());
  });

  test('each case really is registered for the event its payload names', () => {
    const registered = registeredPairs();
    for (const c of ALL) {
      assert.ok(c.input.hook_event_name, `${c.name} has no hook_event_name to key on`);
      assert.ok(registered.has(pairOf(c)), `${pairOf(c)} is exercised here but registered nowhere in hooks.json`);
    }
  });

  // The shared cases run against a TEMP that already holds a note sentinel, so
  // the once-per-session injected context never fires there. This one uses a
  // clean TEMP, where a single enabled run emits BOTH channels at once — which
  // is what makes "stdout is empty" above a statement about the injected
  // context as well as about the rewrite.
  test('a disabled run silences the injected-context channel, not only the rewrite', () => {
    const session = freshSessionId();
    const bare = () => {
      const dir = path.join(SCRATCH_ROOT, `bare-${session}-${++seq}`);
      fs.mkdirSync(dir, { recursive: true });
      return dir;
    };
    const input = {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: session,
      transcript_path: TRANSCRIPT,
      tool_input: { command: 'node build.js' },
      tool_response: NOISY_OUTPUT,
    };

    const onDir = bare();
    const on = runHookIn('compress-tool-output.js', onDir, input, LOUD);
    const emitted = JSON.parse(on.stdout).hookSpecificOutput;
    assert.ok(typeof emitted.updatedToolOutput === 'string', 'no rewritten output to be silenced');
    assert.ok(typeof emitted.additionalContext === 'string', 'no injected context to be silenced');
    assert.notDeepStrictEqual(snapshot(onDir), {}, 'no state to be silenced');

    const offDir = bare();
    const off = runHookIn('compress-tool-output.js', offDir, input, { ...LOUD, HUSH_DISABLE: '1' });
    assert.strictEqual(off.stdout, '', `stdout leaked: ${off.stdout}`);
    assert.deepStrictEqual(snapshot(offDir), {}, 'a disabled run created state');
  });
});
