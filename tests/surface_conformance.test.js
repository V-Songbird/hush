'use strict';

// Core and Quiet are two independent capability switches, both on by default:
//
//   HUSH_CORE=off   Core off — compression, exit-code preservation, the
//                   compaction note, its re-arm, and session-end cleanup all
//                   stop; Quiet keeps injecting.
//   HUSH_QUIET=off  Quiet off — the turn nudge and the subagent brief both
//                   stop; Core keeps compressing, writing sidecars, and
//                   recording transforms.
//   HUSH_DISABLE=1  beats both, in every combination.
//
// Precedence is pinned here too: a surface switch beats every per-hook flag
// inside that surface (HUSH_NUDGE=1 cannot resurrect a Quiet that is off),
// while per-hook flags keep deciding their own hook whenever their surface
// is on.
//
// Same discipline as the product-wide disable conformance: every hook runs
// against a payload that provably triggers it, in a scratch TEMP tree
// snapshotted before and after, and every "inert" assertion has an active
// control on the same payload so it cannot pass vacuously.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { HOOKS_DIR } = require('./helpers');

const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-surface-'));
const FIXTURES = path.join(SCRATCH_ROOT, 'fixtures');
fs.mkdirSync(FIXTURES, { recursive: true });

after(() => {
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
});

let seq = 0;
const freshSessionId = () => `s${crypto.randomBytes(4).toString('hex')}${++seq}`;

/** A scratch TEMP holding the hush-owned files a live session would have. */
function plantedTemp(sessionId) {
  const dir = path.join(SCRATCH_ROOT, `temp-${sessionId}-${++seq}`);
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

// Every per-hook flag a surface owns is forced ON, so a surface switch is the
// only thing that can produce silence — which is exactly the precedence rule
// under test. HUSH_SIDECAR is pinned alongside them because the disk half of
// the active-control assertion depends on it. HUSH_DISABLE, HUSH_CORE and
// HUSH_QUIET are pinned to their default-on state so an ambient value in the
// developer's shell cannot decide the result; each case overrides what it
// means to test.
const BASE = {
  HUSH_DEBUG: '1',
  HUSH_WRAP: '1',
  HUSH_NUDGE: 'max',
  HUSH_COMPACT: 'on',
  HUSH_SUBAGENT: 'on',
  HUSH_SIDECAR: 'on',
  HUSH_DISABLE: '0',
  HUSH_CORE: '',
  HUSH_QUIET: '',
};

function runHook(name, tempDir, stdinData, env) {
  return spawnSync('node', [path.join(HOOKS_DIR, name)], {
    input: JSON.stringify(stdinData),
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, ...BASE, ...(env || {}), TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
  });
}

// ~18KB across 300 unique lines: past the sidecar threshold (a disk write) and
// well past the line cap (a rewritten tool output).
const NOISY_OUTPUT = Array.from(
  { length: 300 },
  (_, i) => `2026-07-28T10:00:${String(i % 60).padStart(2, '0')} worker-${i} step ${i} of the build finished, artifact ${i} written to disk ok`
).join('\n');

const NARRATION = Array.from({ length: 200 }, (_, i) => `w${i}`).join(' ');

const TRANSCRIPT = path.join(FIXTURES, 'narration.jsonl');
fs.writeFileSync(
  TRANSCRIPT,
  [
    JSON.stringify({ type: 'user', uuid: 'u1', message: { role: 'user', content: 'go' } }),
    JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: NARRATION }] } }),
  ].join('\n') + '\n'
);

/**
 * One triggering payload per hook, tagged with the surface that owns it.
 * `writes` marks a hook whose active run must touch disk; `silent` marks one
 * that never prints even when active (deletion-only work).
 */
function cases() {
  const mk = (over) => {
    const session = freshSessionId();
    return { session, ...over(session) };
  };
  return [
    mk((session) => ({
      surface: 'core',
      name: 'compress-tool-output.js',
      input: {
        hook_event_name: 'PostToolUse',
        tool_name: 'Bash',
        session_id: session,
        transcript_path: TRANSCRIPT,
        tool_input: { command: 'node build.js' },
        tool_response: NOISY_OUTPUT,
      },
      writes: true,
    })),
    mk(() => ({
      surface: 'core',
      name: 'preserve-exit-code.js',
      input: {
        hook_event_name: 'PreToolUse',
        tool_name: 'Bash',
        permission_mode: 'bypassPermissions',
        tool_input: { command: 'node build.js' },
      },
    })),
    mk((session) => ({
      surface: 'core',
      name: 'precompact-summary.js',
      input: { hook_event_name: 'PreCompact', session_id: session },
    })),
    mk((session) => ({
      surface: 'core',
      name: 'postcompact-rearm.js',
      input: { hook_event_name: 'PostCompact', session_id: session },
      writes: true,
      silent: true,
    })),
    mk((session) => ({
      surface: 'core',
      name: 'session-end-cleanup.js',
      input: { hook_event_name: 'SessionEnd', session_id: session, reason: 'exit' },
      writes: true,
      silent: true,
    })),
    mk(() => ({
      surface: 'quiet',
      name: 'silence-nudge.js',
      label: 'silence-nudge.js (UserPromptSubmit)',
      input: { hook_event_name: 'UserPromptSubmit' },
    })),
    mk(() => ({
      surface: 'quiet',
      name: 'silence-nudge.js',
      label: 'silence-nudge.js (PostToolUse)',
      input: { hook_event_name: 'PostToolUse' },
    })),
    mk(() => ({
      surface: 'quiet',
      name: 'subagent-brief.js',
      input: { hook_event_name: 'SubagentStart', agent_type: 'claude' },
    })),
  ];
}

const ALL = cases();
const label = (c) => c.label || c.name;

/** Runs the case and asserts it did nothing at all — no stdout, no file touched. */
function assertInert(c, env) {
  const temp = plantedTemp(c.session);
  const before = snapshot(temp);
  const r = runHook(c.name, temp, c.input, env);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  assert.strictEqual(r.stdout, '', `stdout leaked: ${r.stdout}`);
  assert.deepStrictEqual(snapshot(temp), before, 'filesystem changed under a switched-off surface');
}

/** Runs the case and asserts it really did its job on that same payload. */
function assertActive(c, env) {
  const temp = plantedTemp(c.session);
  const before = snapshot(temp);
  const r = runHook(c.name, temp, c.input, env);
  assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
  if (!c.silent) assert.ok(r.stdout !== '', 'active run printed nothing — the payload does not trigger this hook');
  if (c.writes) {
    assert.notDeepStrictEqual(snapshot(temp), before, 'active run touched no file — the payload misses the disk path');
  }
}

const COMBOS = [
  { name: 'both on (default)', env: {}, coreOn: true, quietOn: true },
  { name: 'Core on, Quiet off', env: { HUSH_QUIET: 'off' }, coreOn: true, quietOn: false },
  { name: 'Core off, Quiet on', env: { HUSH_CORE: 'off' }, coreOn: false, quietOn: true },
  { name: 'both off', env: { HUSH_CORE: 'off', HUSH_QUIET: 'off' }, coreOn: false, quietOn: false },
];

describe('Core and Quiet are independent capability switches', () => {
  for (const combo of COMBOS) {
    for (const c of ALL) {
      const on = c.surface === 'core' ? combo.coreOn : combo.quietOn;
      test(`${combo.name}: ${label(c)} (${c.surface}) is ${on ? 'active' : 'inert'}`, () => {
        if (on) assertActive(c, combo.env);
        else assertInert(c, combo.env);
      });
    }
  }

  test('an unset surface variable is on, and a non-off value stays on', () => {
    const core = ALL.find((c) => c.name === 'compress-tool-output.js');
    const quiet = ALL.find((c) => c.name === 'subagent-brief.js');
    assertActive(core, { HUSH_CORE: '1' });
    assertActive(quiet, { HUSH_QUIET: 'on' });
  });

  for (const token of ['0', 'off', 'OFF', 'false']) {
    test(`"${token}" turns a surface off`, () => {
      assertInert(ALL.find((c) => c.name === 'compress-tool-output.js'), { HUSH_CORE: token });
      assertInert(ALL.find((c) => c.name === 'subagent-brief.js'), { HUSH_QUIET: token });
    });
  }
});

describe('HUSH_DISABLE=1 beats every Core/Quiet combination', () => {
  const core = ALL.find((c) => c.name === 'compress-tool-output.js');
  const quiet = ALL.find((c) => c.label === 'silence-nudge.js (PostToolUse)');
  const overlays = [
    ...COMBOS.map((combo) => ({ name: combo.name, env: combo.env })),
    { name: 'both explicitly on', env: { HUSH_CORE: '1', HUSH_QUIET: '1' } },
  ];
  for (const overlay of overlays) {
    test(`over ${overlay.name}: nothing runs`, () => {
      assertInert(core, { ...overlay.env, HUSH_DISABLE: '1' });
      assertInert(quiet, { ...overlay.env, HUSH_DISABLE: '1' });
    });
  }
});

describe('a surface switch outranks the per-hook flags inside it', () => {
  const nudge = ALL.find((c) => c.label === 'silence-nudge.js (PostToolUse)');
  const brief = ALL.find((c) => c.name === 'subagent-brief.js');
  const compact = ALL.find((c) => c.name === 'precompact-summary.js');
  const compress = ALL.find((c) => c.name === 'compress-tool-output.js');

  test('HUSH_NUDGE=max does not resurrect a Quiet that is off', () => {
    assertActive(nudge, { HUSH_NUDGE: 'max' });
    assertInert(nudge, { HUSH_NUDGE: 'max', HUSH_QUIET: 'off' });
  });

  test('an on-valued per-hook flag does not resurrect either surface', () => {
    assertActive(brief, { HUSH_SUBAGENT: 'on' });
    assertInert(brief, { HUSH_SUBAGENT: 'on', HUSH_QUIET: 'off' });
    assertActive(compact, { HUSH_COMPACT: 'on' });
    assertInert(compact, { HUSH_COMPACT: 'on', HUSH_CORE: 'off' });
  });

  test('per-hook flags still decide their own hook while the surface is on', () => {
    assertInert(nudge, { HUSH_NUDGE: 'off' });
    assertInert(compact, { HUSH_COMPACT: 'off' });
    // ...and only their own hook: the rest of each surface keeps working.
    assertActive(brief, { HUSH_NUDGE: 'off' });
    assertActive(compress, { HUSH_COMPACT: 'off' });
  });
});
