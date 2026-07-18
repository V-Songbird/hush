'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { HOOKS_DIR } = require('./helpers');

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
