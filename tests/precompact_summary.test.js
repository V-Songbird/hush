'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { HOOKS_DIR } = require('./helpers');
const { STATIC_BLOCK, buildSidecarBlock, liveSidecarFiles, SIDECAR_CAP, sessionDir } = require('../hooks/precompact-summary');

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

// Unique session ids so no test can see another's sidecar directory.
const freshSessionId = () => crypto.randomBytes(6).toString('hex');

const createdDirs = new Set();

function writeSidecarFile(sessionId, suffix) {
  const dir = sessionDir(sessionId);
  fs.mkdirSync(dir, { recursive: true });
  createdDirs.add(dir);
  const file = path.join(dir, `${suffix}.txt`);
  fs.writeFileSync(file, 'full output');
  return file;
}

after(() => {
  for (const d of createdDirs) fs.rmSync(d, { recursive: true, force: true });
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

  test('a session that parked nothing has no directory and gets the static block only', () => {
    const r = runHook({ hook_event_name: 'PreCompact', session_id: freshSessionId() });
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

  test('the block names both artifact shapes, and promises regeneration only for a search', () => {
    const session = freshSessionId();
    writeSidecarFile(session, 'shapes');
    const block = buildSidecarBlock(session);
    // A parked file is either a digested long output or a complete match
    // list; calling every one of them a digested tool output is false for
    // half of them.
    assert.match(block, /a digest of a long output or a collapsed list of matches/);
    assert.match(block, /re-running a search over unchanged files reproduces its matches/);
    assert.match(block, /no other command is guaranteed to produce the same output twice/);
    // The unconditional claim this replaced must not come back.
    assert.doesNotMatch(block, /re-running the producing command regenerates/);
  });

  test('a file deleted before compaction is not listed, and the rest still are', () => {
    const session = freshSessionId();
    const kept = writeSidecarFile(session, 'kept');
    const gone = writeSidecarFile(session, 'gone');
    fs.rmSync(gone, { force: true });

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, /kept\.txt/);
    assert.doesNotMatch(r.stdout, /gone\.txt/);
  });

  test('every artifact vanishing leaves the static block only, no crash', () => {
    const session = freshSessionId();
    const only = writeSidecarFile(session, 'solo');
    fs.rmSync(only, { force: true });

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), STATIC_BLOCK);
    assert.strictEqual(buildSidecarBlock(session), null);
  });

  test('a directory that happens to end in .txt is not a recovery artifact', () => {
    const session = freshSessionId();
    const real = writeSidecarFile(session, 'real');
    fs.mkdirSync(path.join(sessionDir(session), 'notafile.txt'), { recursive: true });

    const block = buildSidecarBlock(session);
    assert.match(block, new RegExp(real.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(block, /notafile\.txt/);
  });

  test('repeated compactions in one session: same listing, then the newly parked file too', () => {
    const session = freshSessionId();
    writeSidecarFile(session, 'first');

    const one = runHook({ hook_event_name: 'PreCompact', session_id: session });
    const two = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(one.status, 0);
    assert.strictEqual(two.status, 0);
    // Compaction never removes sidecars, so the second summary must still
    // carry the same reference — identical output, not a shrinking one.
    assert.strictEqual(two.stdout, one.stdout);
    assert.match(two.stdout, /first\.txt/);

    writeSidecarFile(session, 'second');
    const three = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.match(three.stdout, /first\.txt/);
    assert.match(three.stdout, /second\.txt/);
  });

  test('another live session\'s artifacts never leak into this summary', () => {
    const mine = freshSessionId();
    const stale = freshSessionId();
    writeSidecarFile(mine, 'mine');
    for (let i = 0; i < 3; i++) writeSidecarFile(stale, `stale${i}`);

    const r = runHook({ hook_event_name: 'PreCompact', session_id: mine });
    assert.match(r.stdout, /mine\.txt/);
    assert.doesNotMatch(r.stdout, /stale\d\.txt/);
    assert.strictEqual(liveSidecarFiles(sessionDir(mine)).length, 1);
  });

  test('a session that transformed output without parking any gets the static block only', () => {
    // Mixed run: caps, template collapses and passthroughs leave nothing on
    // disk. Only parked artifacts are referenced, so there is nothing to say.
    const session = freshSessionId();
    fs.mkdirSync(sessionDir(session), { recursive: true });
    createdDirs.add(sessionDir(session));

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), STATIC_BLOCK);
  });

  test('end to end mixed session: the parked output is named, the capped and untouched ones leave nothing to name', () => {
    const { compress } = require('../hooks/compress-tool-output');
    const session = freshSessionId();
    const prevSidecar = process.env.HUSH_SIDECAR;
    delete process.env.HUSH_SIDECAR;
    const big = Array.from({ length: 2000 }, (_, i) => `02:00 info handled req ${i} in ${i % 90}ms`).join('\n');
    const medium = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const tiny = 'done\n';
    let digest;
    try {
      digest = compress(big, 0, true, false, [], 1, session); // parks a sidecar
      compress(medium, 0, false, false, [], 1, session); // capped, nothing parked
      assert.strictEqual(compress(tiny, 0, false, false, [], 1, session), tiny, 'small output untouched');
    } finally {
      if (prevSidecar === undefined) delete process.env.HUSH_SIDECAR;
      else process.env.HUSH_SIDECAR = prevSidecar;
    }
    createdDirs.add(sessionDir(session));
    const parked = digest.match(/saved in full to ([^;]+);/)[1].trim();

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, new RegExp(parked.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.strictEqual(liveSidecarFiles(sessionDir(session)).length, 1,
      'only the output that was actually parked has an artifact');
  });

  test('mixed run: only the parked artifacts are named, partial writes are not', () => {
    const session = freshSessionId();
    const parked = writeSidecarFile(session, 'parked');
    const dir = sessionDir(session);
    fs.writeFileSync(path.join(dir, 'interrupted.tmp'), 'half a write');

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.match(r.stdout, new RegExp(parked.replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.doesNotMatch(r.stdout, /interrupted\.tmp/);
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

  test('file list caps at 20 and says how many it left out', () => {
    const session = freshSessionId();
    for (let i = 0; i < 25; i++) writeSidecarFile(session, `n${i}`);

    const r = runHook({ hook_event_name: 'PreCompact', session_id: session });
    assert.strictEqual(r.status, 0);
    const block = buildSidecarBlock(session);
    const listedCount = (r.stdout.match(/\bn\d+\.txt/g) || []).length;
    assert.strictEqual(listedCount, SIDECAR_CAP);
    // Over the cap the drop is stated, not silent, and the remainder is still
    // reachable through the directory.
    assert.match(block, new RegExp(`and ${25 - SIDECAR_CAP} more in `));
    assert.match(block, new RegExp(sessionDir(session).replace(/\\/g, '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  });

  test('at or under the cap there is no "more" line', () => {
    const session = freshSessionId();
    for (let i = 0; i < SIDECAR_CAP; i++) writeSidecarFile(session, `c${i}`);
    assert.doesNotMatch(buildSidecarBlock(session), / more in /);
  });

  test('listing order is stable, not filesystem order', () => {
    const session = freshSessionId();
    for (const s of ['zzz', 'aaa', 'mmm']) writeSidecarFile(session, s);
    assert.deepStrictEqual(liveSidecarFiles(sessionDir(session)), ['aaa.txt', 'mmm.txt', 'zzz.txt']);
  });
});
