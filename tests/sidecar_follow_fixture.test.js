'use strict';

// Probe 9, Spec 3: sidecar-follow eval task (benchmarks/tasks.json id
// "sidecar-follow", fixture benchmarks/fixtures/sidecar-follow/). This is a
// free, local, non-API check that the fixture actually has the shape the
// task's check assumes — it never invokes `claude`, just compress() directly
// on the fixture file, the same log-shaped transform a Read of it gets.
//
// The eval task itself is DEFINITION ONLY: run it later with
//   node runner/run.js --tasks sidecar-follow --model <model>

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const { compress } = require('../hooks/compress-tool-output');

const FIXTURE = path.join(__dirname, '..', 'benchmarks', 'fixtures', 'sidecar-follow', 'logs', 'test-output.log');
const TASKS = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'benchmarks', 'tasks.json'), 'utf8'));

describe('sidecar-follow eval task definition', () => {
  test('the task and its fixture both exist', () => {
    const task = TASKS.find((t) => t.id === 'sidecar-follow');
    assert.ok(task, 'tasks.json must define sidecar-follow');
    assert.strictEqual(task.fixture, 'sidecar-follow');
    assert.strictEqual(task.check.type, 'keywords');
    assert.ok(fs.existsSync(FIXTURE), 'fixture log file must exist');
  });

  test('the fixture is large enough to trip the sidecar (not just the inline cap)', () => {
    const content = fs.readFileSync(FIXTURE, 'utf8');
    assert.ok(content.length >= 15000, `fixture should clear SIDECAR_MIN_CHARS (was ${content.length})`);
  });

  describe('digest shape: the census surfaces a failure among many passes, but the names require a follow-up read', () => {
    const created = [];
    after(() => { for (const f of created) fs.rmSync(f, { force: true }); });

    test('census reports exactly 2 failures among ~700 lines', () => {
      const content = fs.readFileSync(FIXTURE, 'utf8');
      const prev = process.env.HUSH_SIDECAR;
      delete process.env.HUSH_SIDECAR;
      let digest;
      try {
        digest = compress(content, undefined, true, false, [], 1, 'sidecar-follow-fixture-test');
      } finally {
        process.env.HUSH_SIDECAR = prev;
      }
      const m = digest.match(/saved in full to ([^;]+);/);
      if (m) created.push(m[1].trim());

      assert.match(digest, /this output is \d+ non-empty lines \(2 failures\)/, 'census names exactly 2 failures');
      assert.match(digest, /Signal lines \(2 total: 2 failures\)/);
      // The bare FAIL lines (and their line numbers) are visible directly...
      assert.match(digest, /L\d+: FAIL\b/);
      // ...but the identifying test NAME sits on the line right after each
      // bare "FAIL" and does not itself match any signal pattern, so it is
      // NOT in the digest — a model that only reads the digest cannot name
      // which tests failed. It has to Read the sidecar file, offset/limit
      // around the L<n> numbers the digest gives it.
      assert.strictEqual(digest.includes('refreshToken silently accepts'), false, 'the failing test name must NOT leak into the digest');
      assert.strictEqual(digest.includes('sessionCleanup leaves orphaned'), false, 'the failing test name must NOT leak into the digest');

      assert.ok(m, 'a real sidecar file path should be present in the digest');
      const saved = fs.readFileSync(m[1].trim(), 'utf8');
      assert.ok(saved.includes('refreshToken silently accepts an already-revoked token'), 'the full file DOES have both names — that is what the follow-up read recovers');
      assert.ok(saved.includes('sessionCleanup leaves orphaned rows after a rollback'));
    });
  });
});
