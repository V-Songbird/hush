'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { HOOKS_DIR } = require('./helpers');
const { insideTmp } = require('../hooks/postcompact-rearm');
const { sessionDir } = require('../hooks/lib/sidecar-store');

/** Run postcompact-rearm.js with raw stdin (not necessarily JSON); returns spawnSync result. */
function runRaw(stdinData, env) {
  return spawnSync('node', [path.join(HOOKS_DIR, 'postcompact-rearm.js')], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
  });
}

function runHook(stdinObj, env) {
  return runRaw(JSON.stringify(stdinObj), env);
}

const freshSessionId = () => crypto.randomBytes(6).toString('hex');

function notePath(sessionId) {
  return path.join(os.tmpdir(), `hush-note-${sessionId}`);
}

function meterPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(os.tmpdir(), `hush-meter-${safe}.json`);
}

function deltaPath(sessionId) {
  const safe = String(sessionId).replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(os.tmpdir(), `hush-delta-${safe}.json`);
}

describe('postcompact-rearm hook', () => {
  test('removes sentinel, meter, and re-read-delta state when present', () => {
    const sessionId = freshSessionId();
    fs.writeFileSync(notePath(sessionId), '');
    fs.writeFileSync(meterPath(sessionId), '{}');
    fs.writeFileSync(deltaPath(sessionId), '{}');

    const r = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(fs.existsSync(notePath(sessionId)), false);
    assert.strictEqual(fs.existsSync(meterPath(sessionId)), false);
    assert.strictEqual(fs.existsSync(deltaPath(sessionId)), false);
  });

  test('absent files -> silent success', () => {
    const sessionId = freshSessionId();
    const r = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(fs.existsSync(notePath(sessionId)), false);
    assert.strictEqual(fs.existsSync(meterPath(sessionId)), false);
    assert.strictEqual(fs.existsSync(deltaPath(sessionId)), false);
  });

  test('no session_id -> no-op, exit 0', () => {
    const r = runHook({ hook_event_name: 'PostCompact' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('malformed stdin -> exit 0, no output', () => {
    const r = runRaw('not json at all {{{');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('HUSH_DISABLE=1 -> files left untouched', () => {
    const sessionId = freshSessionId();
    fs.writeFileSync(notePath(sessionId), '');
    fs.writeFileSync(meterPath(sessionId), '{}');
    fs.writeFileSync(deltaPath(sessionId), '{}');

    const r = runHook({ hook_event_name: 'PostCompact', session_id: sessionId }, { HUSH_DISABLE: '1' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(fs.existsSync(notePath(sessionId)), true);
    assert.strictEqual(fs.existsSync(meterPath(sessionId)), true);
    assert.strictEqual(fs.existsSync(deltaPath(sessionId)), true);

    fs.rmSync(notePath(sessionId), { force: true });
    fs.rmSync(meterPath(sessionId), { force: true });
    fs.rmSync(deltaPath(sessionId), { force: true });
  });
});

// Re-arm is deletion, so "only verified live entries are re-armed" holds by
// construction: nothing survives to be treated as live. These pin that for the
// two shapes that would otherwise be re-armed as if live — a baseline whose
// watched file is gone, and state that no longer parses.
describe('postcompact-rearm: nothing stale survives as live', () => {
  const sidecarDirs = new Set();
  after(() => {
    for (const d of sidecarDirs) fs.rmSync(d, { recursive: true, force: true });
  });

  test('a delta baseline whose watched file no longer exists is not carried past compaction', () => {
    const sessionId = freshSessionId();
    const goneFile = path.join(os.tmpdir(), `hush-watched-${sessionId}.log`);
    fs.writeFileSync(deltaPath(sessionId), JSON.stringify({
      [goneFile]: { hashes: ['a', 'b'], rereads: 2 },
      [path.join(os.tmpdir(), 'still-here.log')]: { hashes: ['c'], rereads: 1 },
    }));
    assert.strictEqual(fs.existsSync(goneFile), false, 'the watched file was never created');

    const r = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.existsSync(deltaPath(sessionId)), false,
      'no baseline survives — the next read of any tracked path goes out full');
  });

  test('unparsable state is removed, not left behind for the next read to trust', () => {
    const sessionId = freshSessionId();
    fs.writeFileSync(deltaPath(sessionId), '{not json at all');
    fs.writeFileSync(meterPath(sessionId), 'truncated');

    const r = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
    assert.strictEqual(fs.existsSync(deltaPath(sessionId)), false);
    assert.strictEqual(fs.existsSync(meterPath(sessionId)), false);
  });

  test('repeated compactions: the second is a silent no-op, and a note re-claimed between them still re-arms', () => {
    const sessionId = freshSessionId();
    fs.writeFileSync(notePath(sessionId), '');

    const first = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(first.status, 0);
    assert.strictEqual(fs.existsSync(notePath(sessionId)), false);

    const second = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(second.status, 0);
    assert.strictEqual(second.stdout, '');

    fs.writeFileSync(notePath(sessionId), ''); // the note fired again after compaction
    const third = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(third.status, 0);
    assert.strictEqual(fs.existsSync(notePath(sessionId)), false);
  });

  test('recovery artifacts survive compaction — the summary just promised those paths', () => {
    const sessionId = freshSessionId();
    const dir = sessionDir(sessionId);
    fs.mkdirSync(dir, { recursive: true });
    sidecarDirs.add(dir);
    const parked = path.join(dir, 'abc123.txt');
    fs.writeFileSync(parked, 'full output');
    fs.writeFileSync(notePath(sessionId), '');

    const r = runHook({ hook_event_name: 'PostCompact', session_id: sessionId });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.existsSync(notePath(sessionId)), false, 'sentinel re-armed');
    assert.strictEqual(fs.readFileSync(parked, 'utf-8'), 'full output',
      'sidecars are removed at session end, never at compaction');
  });

  test('a session_id that resolves outside tmpdir is not a hush file and is not deleted', () => {
    const escaping = `../../../hush-168-escape-${freshSessionId()}`;
    assert.strictEqual(insideTmp(path.join(os.tmpdir(), `hush-note-${escaping}`)), false);
    assert.strictEqual(insideTmp(path.join(os.tmpdir(), `hush-note-${freshSessionId()}`)), true);

    const r = runHook({ hook_event_name: 'PostCompact', session_id: escaping });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });
});
