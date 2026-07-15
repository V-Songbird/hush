'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { HOOKS_DIR } = require('./helpers');
const { STATIC_BLOCK, buildSidecarBlock, SIDECAR_DIR, SIDECAR_CAP } = require('../hooks/precompact-summary');

/** Run precompact-summary.js with raw stdin (not necessarily JSON); returns spawnSync result. */
function runRaw(stdinData, env) {
  return spawnSync('node', [path.join(HOOKS_DIR, 'precompact-summary.js')], {
    input: stdinData,
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
  });
}

function runHook(stdinObj, env) {
  return runRaw(JSON.stringify(stdinObj), env);
}

// Unique 12-hex-char session ids so each test's sess8 prefix (first 8 chars)
// never collides with another test's sidecar fixtures.
const freshSessionId = () => crypto.randomBytes(6).toString('hex');

const createdFiles = [];

function writeSidecarFile(sessionId, suffix) {
  fs.mkdirSync(SIDECAR_DIR, { recursive: true });
  const file = path.join(SIDECAR_DIR, `${sessionId.slice(0, 8)}-${suffix}.txt`);
  fs.writeFileSync(file, 'full output');
  createdFiles.push(file);
  return file;
}

after(() => {
  for (const f of createdFiles) fs.rmSync(f, { force: true });
});

describe('precompact-summary hook', () => {
  test('static block emitted when enabled, no session_id', () => {
    const r = runHook({ hook_event_name: 'PreCompact', trigger: 'manual' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), STATIC_BLOCK);
  });

  test('no session_id -> static block only, even with sidecar files present elsewhere', () => {
    const other = freshSessionId();
    writeSidecarFile(other, 'aaa');
    const r = runHook({ hook_event_name: 'PreCompact' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), STATIC_BLOCK);
  });

  test('sidecar block lists only this session\'s files', () => {
    const sessionA = freshSessionId();
    const sessionB = freshSessionId();
    const fileA1 = writeSidecarFile(sessionA, 'one');
    const fileA2 = writeSidecarFile(sessionA, 'two');
    const fileB = writeSidecarFile(sessionB, 'other');

    const r = runHook({ hook_event_name: 'PreCompact', session_id: sessionA });
    assert.strictEqual(r.status, 0);
    const out = r.stdout;
    assert.match(out, new RegExp(STATIC_BLOCK.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(out, new RegExp(fileA1.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(out, new RegExp(fileA2.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(out, new RegExp(fileB.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.match(out, /Keep these paths in the summary; do not reproduce their content\./);
  });

  test('HUSH_COMPACT=off -> empty stdout', () => {
    const sessionA = freshSessionId();
    writeSidecarFile(sessionA, 'off-test');
    const r = runHook({ hook_event_name: 'PreCompact', session_id: sessionA }, { HUSH_COMPACT: 'off' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('HUSH_DISABLE=1 -> empty stdout', () => {
    const r = runHook({ hook_event_name: 'PreCompact' }, { HUSH_DISABLE: '1' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('malformed stdin -> empty stdout, exit 0', () => {
    const r = runRaw('not json at all {{{');
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('file list caps at 20', () => {
    const session = freshSessionId();
    for (let i = 0; i < 25; i++) writeSidecarFile(session, `n${i}`);

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(r.status, 0);
    const block = buildSidecarBlock(session);
    const listedCount = (r.stdout.match(new RegExp(`${session.slice(0, 8)}-n\\d+\\.txt`, 'g')) || []).length;
    assert.strictEqual(listedCount, SIDECAR_CAP);
    assert.ok(block);
  });
});
