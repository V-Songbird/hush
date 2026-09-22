'use strict';

// A ~700-line test log, the shape a real Read of a build log has. This is a
// free, local, non-API check — it never invokes `claude`, just compress()
// directly on the fixture file, the same log-shaped transform a Read of it
// gets.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { compress } = require('../hooks/compress-tool-output');
const { sessionDir } = require('../hooks/lib/sidecar-store');

const FIXTURE = path.join(__dirname, 'fixtures', 'sidecar-follow-test-output.log');

describe('a long test log follows through to the sidecar', () => {
  test('the fixture exists', () => {
    assert.ok(fs.existsSync(FIXTURE), 'fixture log file must exist');
  });

  test('the fixture is large enough to trip the sidecar (not just the inline cap)', () => {
    const content = fs.readFileSync(FIXTURE, 'utf8');
    assert.ok(content.length >= 15000, `fixture should clear SIDECAR_MIN_CHARS (was ${content.length})`);
  });

  describe('digest shape: the census surfaces a failure among many passes, and the digest names the failing tests', () => {
    const SESSION = 'sidecar-follow-fixture-test';
    // The whole session namespace goes, the way session end takes it.
    after(() => fs.rmSync(sessionDir(SESSION), { recursive: true, force: true }));

    test('census reports exactly 2 failures among ~700 lines', () => {
      const content = fs.readFileSync(FIXTURE, 'utf8');
      const prev = process.env.HUSH_SIDECAR;
      delete process.env.HUSH_SIDECAR;
      let digest;
      try {
        digest = compress(content, undefined, true, false, [], 1, SESSION);
      } finally {
        process.env.HUSH_SIDECAR = prev;
      }
      const m = digest.match(/saved in full to ([^;]+);/);

      assert.match(digest, /this output is \d+ non-empty lines \(2 failures, 2 failure-evidence lines\)/, 'census names exactly 2 failures');
      assert.match(digest, /Signal lines \(4 total: 2 failures, 2 failure-evidence lines\)/);
      // The bare FAIL lines (and their line numbers) are visible directly...
      assert.match(digest, /L\d+: FAIL\b/);
      // ...and so is the cross-marked line right after each one. A cross mark
      // is failure evidence, so the digest names the failing test with its
      // file and line, and no follow-up read is needed to say which failed.
      assert.ok(digest.includes('L302:   ✗ refreshToken silently accepts an already-revoked token (auth/tokens.test.js:400)'));
      assert.ok(digest.includes('L553:   ✗ sessionCleanup leaves orphaned rows after a rollback (auth/tokens.test.js:650)'));

      assert.ok(m, 'a real sidecar file path should be present in the digest');
      const saved = fs.readFileSync(m[1].trim(), 'utf8');
      assert.ok(saved.includes('refreshToken silently accepts an already-revoked token'), 'the full file has both names too');
      assert.ok(saved.includes('sessionCleanup leaves orphaned rows after a rollback'));
    });
  });
});
