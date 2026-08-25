'use strict';

// Sidecar storage is session-owned, and its cleanup is a session
// event. A sidecar is only worth writing if a later Read still finds it — so
// what may delete it, and when, is as much of the contract as what it holds.
//
// Two kinds of test here. The isolation and write-failure cases run compress()
// in-process against the real tmpdir (cleaned per session in `after`). The
// cleanup cases run the hook as a subprocess with TEMP/TMP/TMPDIR pointed at a
// scratch tree, so the sweep can never reach the developer's own temp files.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { HOOKS_DIR } = require('./helpers');
const { compress } = require('../hooks/compress-tool-output');
const { buildSidecarBlock } = require('../hooks/precompact-summary');
const { sessionDir, isSidecarPath, SIDECAR_ROOT, savedPath, addSaved } = require('../hooks/lib/sidecar-store');

const SCRATCH_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-lifecycle-'));
const realSessions = [];

after(() => {
  fs.rmSync(SCRATCH_ROOT, { recursive: true, force: true });
  for (const id of realSessions) fs.rmSync(sessionDir(id), { recursive: true, force: true });
});

let seq = 0;
function freshSessionId(tag) {
  const id = `hush-lifecycle-${tag}-${crypto.randomBytes(4).toString('hex')}-${++seq}`;
  realSessions.push(id);
  return id;
}

// ~18KB of one repeated-but-unique shape: over SIDECAR_MIN_CHARS, under
// SIDECAR_SHELL_MAX, and line-rich enough for the digest to be smaller.
const BIG = Array.from({ length: 500 }, (_, i) => `2026-07-28 10:00:00 worker step ${i} finished, artifact ${i} written`).join('\n');

function sidecarOn(fn) {
  const prev = process.env.HUSH_SIDECAR;
  delete process.env.HUSH_SIDECAR;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env.HUSH_SIDECAR;
    else process.env.HUSH_SIDECAR = prev;
  }
}

const pathFrom = (digest) => {
  const m = digest.match(/saved in full to ([^;]+);/);
  assert.ok(m, 'the digest names the file it wrote');
  return m[1].trim();
};

/** A scratch temp tree; os.tmpdir() inside a hook run with it resolves here. */
function scratchTemp(tag) {
  const dir = path.join(SCRATCH_ROOT, `temp-${tag}-${++seq}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

const scratchSessionDir = (temp, sessionId) =>
  path.join(temp, 'hush-sidecar', String(sessionId).replace(/[^a-zA-Z0-9-]/g, '_'));

/** Plants one sidecar file for `sessionId` inside a scratch temp tree. */
function plantSidecar(temp, sessionId, name = 'deadbeef.txt') {
  const dir = scratchSessionDir(temp, sessionId);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name);
  fs.writeFileSync(file, 'full output');
  return file;
}

function ageEntry(target, hoursAgo) {
  const when = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);
  fs.utimesSync(target, when, when);
}

function runCleanup(temp, input) {
  return spawnSync('node', [path.join(HOOKS_DIR, 'session-end-cleanup.js')], {
    input: input === undefined ? undefined : JSON.stringify(input),
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, HUSH_DISABLE: '0', TEMP: temp, TMP: temp, TMPDIR: temp },
  });
}

describe('sidecar storage: a session owns its namespace', () => {
  test('two sessions producing identical output get a file each, in their own directories', () => {
    const a = freshSessionId('iso-a');
    const b = freshSessionId('iso-b');
    const fileA = sidecarOn(() => pathFrom(compress(BIG, 0, true, false, [], 1, a)));
    const fileB = sidecarOn(() => pathFrom(compress(BIG, 0, true, false, [], 1, b)));

    assert.notStrictEqual(fileA, fileB, 'identical content is no longer one shared file');
    assert.strictEqual(path.dirname(path.resolve(fileA)), path.resolve(sessionDir(a)));
    assert.strictEqual(path.dirname(path.resolve(fileB)), path.resolve(sessionDir(b)));
    assert.strictEqual(fs.readFileSync(fileA, 'utf8'), BIG);
    assert.strictEqual(fs.readFileSync(fileB, 'utf8'), BIG);
    assert.ok(isSidecarPath(fileA), 'a namespaced path is still recognized as a sidecar read');
  });

  // The path reaching isSidecarPath comes from the model, which may have
  // retyped what the digest printed. NTFS calls a case-only variant the same
  // file, and a full Read that reads as "not a sidecar" passes through
  // uncompressed -- the whole parked output back into context.
  test('a sidecar path in another case is still a sidecar read', { skip: process.platform !== 'win32' }, () => {
    const file = path.join(sessionDir('CaseFold1234'), 'abcd1234.txt');
    assert.ok(isSidecarPath(file));
    assert.ok(isSidecarPath(file.toUpperCase()), 'NTFS folds case, so the predicate must too');
    assert.ok(isSidecarPath(file.toLowerCase()));
  });

  test('a path outside the sidecar root is never a sidecar read', () => {
    assert.strictEqual(isSidecarPath(path.join(os.tmpdir(), 'not-hush', 'x.txt')), false);
    assert.strictEqual(isSidecarPath(SIDECAR_ROOT), false);
  });

  test('ids differing only in case share a directory where the filesystem folds case, and not where it does not', () => {
    const upper = path.resolve(sessionDir('ABCD1234'));
    const lower = path.resolve(sessionDir('abcd1234'));
    if (process.platform === 'win32') {
      assert.strictEqual(upper, lower, 'NTFS ignores case, so one id must not be able to delete the other');
    } else {
      assert.notStrictEqual(upper, lower, 'posix keeps case distinct, so the ids stay separate namespaces');
    }
  });

  test('a session id with separators in it stays one directory under the root', () => {
    const dir = path.resolve(sessionDir('../../escape/attempt'));
    assert.strictEqual(path.dirname(dir), path.resolve(SIDECAR_ROOT));
  });

  test('the same output twice in one session reuses the one file', () => {
    const id = freshSessionId('idempotent');
    const first = sidecarOn(() => pathFrom(compress(BIG, 0, true, false, [], 1, id)));
    const second = sidecarOn(() => pathFrom(compress(BIG, 0, true, false, [], 1, id)));
    assert.strictEqual(first, second);
    assert.strictEqual(fs.readdirSync(sessionDir(id)).length, 1);
  });
});

describe('sidecar storage: a failed write never costs the output', () => {
  test('when the namespace cannot be created, the capped view is delivered instead', () => {
    const id = freshSessionId('blocked');
    // A plain file where the session directory belongs: mkdir fails, and with
    // it every path to persisting this output.
    fs.mkdirSync(SIDECAR_ROOT, { recursive: true });
    fs.writeFileSync(sessionDir(id), 'not a directory');

    // Template collapse is pinned off so the fallback is demonstrably the
    // ordinary line cap: every line in BIG shares one shape, and collapsing
    // them would keep the view under the cap and hide which path ran.
    const prevTemplate = process.env.HUSH_TEMPLATE;
    process.env.HUSH_TEMPLATE = 'off';
    let out;
    try {
      out = sidecarOn(() => compress(BIG, 0, true, false, [], 1, id));
    } finally {
      if (prevTemplate === undefined) delete process.env.HUSH_TEMPLATE;
      else process.env.HUSH_TEMPLATE = prevTemplate;
    }
    assert.doesNotMatch(out, /saved in full to/, 'no pointer to a file that was never written');
    assert.match(out, /lines omitted from this view/, 'falls through to the ordinary inline cap');
    assert.ok(out.includes('worker step 0 finished'), 'the original output is still what the model sees');
    fs.rmSync(sessionDir(id), { force: true });
  });
});

describe('sidecar cleanup: session end', () => {
  test('the ending session loses its files, a concurrent session keeps all of its own', () => {
    const temp = scratchTemp('end');
    const mine = 'aaaa1111';
    const theirs = 'bbbb2222';
    const myFile = plantSidecar(temp, mine);
    const theirFile = plantSidecar(temp, theirs);

    const r = runCleanup(temp, { hook_event_name: 'SessionEnd', session_id: mine, reason: 'exit' });
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.strictEqual(r.stdout, '', 'cleanup is a side effect, not a message');
    assert.strictEqual(fs.existsSync(myFile), false, 'the ending session took its sidecars with it');
    assert.strictEqual(fs.existsSync(scratchSessionDir(temp, mine)), false, 'and its directory');
    assert.strictEqual(fs.existsSync(theirFile), true, 'another live session is untouched');
  });

  test('a partly-written temp file in the namespace goes with it', () => {
    const temp = scratchTemp('partial');
    const id = 'cccc3333';
    const partial = plantSidecar(temp, id, '.abc123.txt.4242.9f8e7d6c.tmp');
    const finished = plantSidecar(temp, id);

    const r = runCleanup(temp, { hook_event_name: 'SessionEnd', session_id: id });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.existsSync(partial), false, 'an interrupted write leaves nothing behind');
    assert.strictEqual(fs.existsSync(finished), false);
  });

  test('missing directories are a no-op: no output, no error, nothing created', () => {
    const temp = scratchTemp('missing');
    const before = fs.readdirSync(temp);

    const r = runCleanup(temp, { hook_event_name: 'SessionEnd', session_id: 'never-wrote-anything' });
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.strictEqual(r.stdout, '');
    assert.deepStrictEqual(fs.readdirSync(temp), before, 'cleanup does not create the directories it looks for');
  });

  test('no session id, empty stdin, and malformed stdin all exit 0 without deleting anything', () => {
    const temp = scratchTemp('degenerate');
    const kept = plantSidecar(temp, 'dddd4444');

    for (const r of [
      runCleanup(temp, { hook_event_name: 'SessionEnd' }),
      runCleanup(temp, undefined),
      spawnSync('node', [path.join(HOOKS_DIR, 'session-end-cleanup.js')], {
        input: 'not json at all {{{',
        encoding: 'utf-8',
        timeout: 30000,
        env: { ...process.env, TEMP: temp, TMP: temp, TMPDIR: temp },
      }),
    ]) {
      assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
      assert.strictEqual(r.stdout, '');
    }
    assert.strictEqual(fs.existsSync(kept), true, 'a fresh namespace survives every degenerate input');
  });
});

describe('sidecar cleanup: crash leftovers', () => {
  test('a stale namespace is swept, a recently written one is not', () => {
    const temp = scratchTemp('stale');
    const crashed = plantSidecar(temp, 'eeee5555');
    const live = plantSidecar(temp, 'ffff6666');
    // A loose file from the older flat scheme, stale by the same measure.
    const loose = path.join(temp, 'hush-sidecar', 'old-flat-scheme.txt');
    fs.writeFileSync(loose, 'leftover');
    ageEntry(loose, 48);
    ageEntry(scratchSessionDir(temp, 'eeee5555'), 48);

    const r = runCleanup(temp, { hook_event_name: 'SessionEnd', session_id: 'gggg7777' });
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.strictEqual(fs.existsSync(crashed), false, 'a day-old namespace is a crash leftover');
    assert.strictEqual(fs.existsSync(loose), false, 'loose stale files go too');
    assert.strictEqual(fs.existsSync(live), true, 'a recently written namespace is left alone');
  });

  test('an hours-old namespace is inside the grace and survives', () => {
    const temp = scratchTemp('grace');
    const recent = plantSidecar(temp, 'hhhh8888');
    ageEntry(scratchSessionDir(temp, 'hhhh8888'), 6);

    const r = runCleanup(temp, { hook_event_name: 'SessionEnd', session_id: 'iiii9999' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(fs.existsSync(recent), true);
  });
});

describe('sidecar lifetime: compaction keeps every path valid', () => {
  test('the PreCompact summary names this session\'s files and they are still there afterwards', () => {
    const id = freshSessionId('compact');
    const file = sidecarOn(() => pathFrom(compress(BIG, 0, true, false, [], 1, id)));

    const block = buildSidecarBlock(id);
    assert.ok(block, 'the summary gets a block naming the parked output');
    assert.ok(block.includes(file.replace(/\\/g, '/')), 'and names this exact file');

    // PostCompact clears the session's re-armable state; sidecars are not
    // state, they are the recovery location that block just handed the model.
    const r = spawnSync('node', [path.join(HOOKS_DIR, 'postcompact-rearm.js')], {
      input: JSON.stringify({ hook_event_name: 'PostCompact', session_id: id }),
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, HUSH_DISABLE: '0' },
    });
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.strictEqual(fs.existsSync(file), true, 'compaction never deletes a sidecar');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), BIG);
  });

  test('a partly-written temp file is never offered as recoverable output', () => {
    const id = freshSessionId('partial-list');
    fs.mkdirSync(sessionDir(id), { recursive: true });
    fs.writeFileSync(path.join(sessionDir(id), '.abc123.txt.4242.1a2b3c4d.tmp'), 'half a wri');
    assert.strictEqual(buildSidecarBlock(id), null, 'an unfinished write is not a recovery location');
  });
});

// The running savings total is the one thing hush persists for somebody else
// to read: Claude Code has a single statusline slot, hush does not take it, so
// the number goes to a file a user's own script can pick up. It is stored in
// the session's sidecar directory, which means it inherits that directory's
// whole lifetime — and must not be mistaken for one of the parked outputs
// living beside it.
describe('savings total: a running count a statusline can read', () => {
  function runCompress(temp, sessionId, response, toolName = 'Bash') {
    return spawnSync('node', [path.join(HOOKS_DIR, 'compress-tool-output.js')], {
      input: JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: toolName, tool_response: response, session_id: sessionId }),
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, HUSH_DISABLE: '0', TEMP: temp, TMP: temp, TMPDIR: temp },
    });
  }

  const readTotal = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

  test('every handled tool output adds to the total, and a compressed one adds less out than in', () => {
    const temp = scratchTemp('saved-accumulate');
    const id = 'eeee5555';
    const file = path.join(scratchSessionDir(temp, id), 'saved.json');

    const first = runCompress(temp, id, BIG);
    assert.strictEqual(first.status, 0, `exit ${first.status}: ${first.stderr}`);
    const one = readTotal(file);
    assert.strictEqual(one.in, BIG.length, 'the total counts what the tool actually produced');
    assert.ok(one.out < one.in, `a compressed output delivers less than it was given: ${one.out} vs ${one.in}`);

    const second = runCompress(temp, id, BIG);
    assert.strictEqual(second.status, 0, `exit ${second.status}: ${second.stderr}`);
    const two = readTotal(file);
    assert.strictEqual(two.in, one.in * 2, 'a second call adds to the running total rather than replacing it');
    assert.strictEqual(two.out, one.out * 2);
  });

  test('an untouched output still counts, with nothing saved', () => {
    const temp = scratchTemp('saved-passthrough');
    const id = 'ffff6666';
    const short = ['ok', 'done'].join(String.fromCharCode(10));

    const r = runCompress(temp, id, short);
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    const total = readTotal(path.join(scratchSessionDir(temp, id), 'saved.json'));
    assert.deepStrictEqual(total, { in: short.length, out: short.length }, 'a passthrough is honest about saving nothing');
  });

  test('the total goes away with the session that wrote it', () => {
    const temp = scratchTemp('saved-cleanup');
    const id = 'aaaa7777';
    runCompress(temp, id, BIG);
    const file = path.join(scratchSessionDir(temp, id), 'saved.json');
    assert.strictEqual(fs.existsSync(file), true, 'the total was written in the first place');

    const r = runCleanup(temp, { hook_event_name: 'SessionEnd', session_id: id });
    assert.strictEqual(r.status, 0, `exit ${r.status}: ${r.stderr}`);
    assert.strictEqual(fs.existsSync(file), false, 'session end takes the total with the parked copies');
  });

  test('the total is never offered to the summarizer as recoverable output', () => {
    const id = freshSessionId('saved-not-recovery');
    assert.strictEqual(addSaved(id, 4000, 1800), true);
    assert.strictEqual(fs.existsSync(savedPath(id)), true);
    assert.strictEqual(buildSidecarBlock(id), null, 'a count of characters is not a copy of anything');
  });

  test('a missing session, a zero-length output and a corrupt file all fail open', () => {
    const id = freshSessionId('saved-degenerate');
    assert.strictEqual(addSaved('', 100, 50), false, 'a session-less call would write to a shared file nobody cleans up');
    assert.strictEqual(addSaved(id, 0, 0), false, 'nothing arrived, so there is nothing to count');
    assert.strictEqual(fs.existsSync(savedPath(id)), false, 'and neither call created the file');

    assert.strictEqual(addSaved(id, 100, 40), true);
    fs.writeFileSync(savedPath(id), 'not json at all');
    assert.strictEqual(addSaved(id, 100, 40), true, 'a hand-edited file is replaced, not thrown over');
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(savedPath(id), 'utf8')), { in: 100, out: 40 });
  });
});
