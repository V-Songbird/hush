'use strict';

// ROADMAP 176: the release gate, under test.
//
// A gate that cannot fail proves nothing about the release it guards, so every
// check here is fed broken evidence on purpose and the matching point is
// asserted to flip — and only that point. Two kinds of case:
//
//   * test-backed points get an injected runner that reports one named file as
//     failing. No `node --test` is spawned, so the whole falsifiability matrix
//     costs milliseconds.
//   * artifact-backed points (5, 7, 8, 10) get a fixture checkout on disk with
//     the artifact genuinely broken — a README that stopped documenting the
//     sidecar lifecycle, a hook that starts an on-demand surface, a stale or
//     tampered record set.
//
// One end-to-end spawn covers the CLI itself: real `node --test` runs against
// stub test files, mixed verdicts, exit code 1.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const gate = require('../scripts/readiness-gate.js');
const { writeRecord, readRecords } = require('../benchmarks/runner/records.js');
const { buildClaims } = require('../benchmarks/runner/publish.js');

const PLUGIN_ROOT = path.join(__dirname, '..');
const GATE_SCRIPT = path.join(PLUGIN_ROOT, 'scripts', 'readiness-gate.js');

const scratch = [];
after(() => {
  for (const dir of scratch) {
    // Records are written read-only, so cleanup has to unlock them first.
    const walk = (d) => {
      for (const e of fs.readdirSync(d, { withFileTypes: true })) {
        const f = path.join(d, e.name);
        if (e.isDirectory()) walk(f);
        else try { fs.chmodSync(f, 0o666); } catch { /* best effort */ }
      }
    };
    try { walk(dir); } catch { /* already gone */ }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/** An injected runner: everything passes except the files named. */
const runnerFailing = (...broken) => (file) => ({ pass: !broken.includes(file), tests: 7, fail: broken.includes(file) ? 1 : 0, ms: 0 });
const ALL_PASS = runnerFailing();

const verdicts = (report) => Object.fromEntries(report.results.map((r) => [r.n, r.met]));
const point = (report, n) => report.results.find((r) => r.n === n);
/** Points that were met in `before` and are not met in `after`. */
const flipped = (before, after_) => Object.keys(verdicts(before))
  .filter((n) => verdicts(before)[n] && !verdicts(after_)[n]).map(Number);

// --------------------------------------------------------------- the checklist

describe('the checklist is the contract, in the gate itself', () => {
  test('the ten points are the ten, in order and verbatim', () => {
    assert.deepStrictEqual(gate.POINTS.map((p) => `${p.n}. ${p.point}`), [
      '1. Disable means no Hush behavior.',
      '2. Every lossy view is recoverable until its disclosed expiry.',
      '3. Structured transforms preserve all metadata.',
      '4. Deletions and failures cannot be silently hidden.',
      '5. Sidecars have a documented lifecycle.',
      '6. Statistics distinguish observation from estimation.',
      '7. Core, Quiet, Voices, and Draft have separate contracts.',
      '8. Public claims match workload-segment evidence.',
      '9. Configuration and stock-style recovery are stable across updates.',
      '10. The benchmark suite reports uncertainty and publishes auditable run data.',
    ]);
  });

  test('every test file the gate names as evidence exists in this checkout', () => {
    const files = gate.evidenceFiles();
    assert.ok(files.length >= 9, `only ${files.length} evidence files`);
    for (const f of files) assert.ok(fs.existsSync(path.join(PLUGIN_ROOT, f)), `gate names a missing file: ${f}`);
  });

  test('a check that throws fails closed instead of passing', () => {
    const report = gate.runGate({
      root: PLUGIN_ROOT,
      runTestFile: ALL_PASS,
      points: [{ n: 1, point: 'x', check: () => { throw new Error('boom'); } }],
    });
    assert.strictEqual(report.ok, false);
    assert.match(point(report, 1).missing, /the check itself failed: boom/);
  });
});

// ------------------------------------------------------- this checkout, today

describe('this checkout: eight points stand on committed evidence, two wait on a paid batch', () => {
  const report = gate.runGate({ root: PLUGIN_ROOT, runTestFile: ALL_PASS });

  test('points 1-7 and 9 are met from artifacts already in the tree', () => {
    for (const n of [1, 2, 3, 4, 5, 6, 7, 9]) {
      assert.strictEqual(point(report, n).met, true, `point ${n}: ${point(report, n).missing}`);
    }
  });

  test('point 8 is not met, and says which figures nothing generates', () => {
    const p = point(report, 8);
    assert.strictEqual(p.met, false);
    assert.match(p.missing, /no run records under benchmarks\/records\//);
    assert.match(p.missing, /\$\d+\.\d+/, 'the unmet point has to name a claim it cannot back');
    assert.ok(p.evidence.some((e) => /README\.md — \d+ public cost figures/.test(e)));
  });

  test('point 10 is not met, and says the run data is what is missing', () => {
    const p = point(report, 10);
    assert.strictEqual(p.met, false);
    assert.match(p.missing, /holds no run data/);
  });

  test('an unmet point is a failure, never a warning', () => {
    assert.strictEqual(report.ok, false);
    assert.match(gate.render(report), /NOT READY FOR 1\.0 — point\(s\) 8, 10 unmet/);
  });
});

// ------------------------------------------------- falsifiability: test-backed

describe('falsifiability: breaking an evidence test flips its point and no other', () => {
  const baseline = gate.runGate({ root: PLUGIN_ROOT, runTestFile: ALL_PASS });

  // The point-to-evidence map, stated once, checked in both directions.
  const MAP = [
    ['tests/disable_conformance.test.js', [1]],
    ['tests/transform_properties.test.js', [2]],
    ['tests/compress_tool_output.test.js', [3, 4]],
    ['tests/preserve_exit_code.test.js', [4]],
    ['tests/sidecar_lifecycle.test.js', [5]],
    ['tests/stats.test.js', [6]],
    ['tests/surface_conformance.test.js', [7]],
    ['tests/activate_style.test.js', [9]],
    ['tests/safe_write.test.js', [9]],
  ];

  for (const [file, points] of MAP) {
    test(`${file} failing takes down point(s) ${points.join(', ')}`, () => {
      const broken = gate.runGate({ root: PLUGIN_ROOT, runTestFile: runnerFailing(file) });
      assert.deepStrictEqual(flipped(baseline, broken), points);
      for (const n of points) assert.match(point(broken, n).missing, new RegExp(`${file.replace(/[.]/g, '\\.')} does not pass`));
    });
  }

  test('the map is complete — no evidence file is unaccounted for', () => {
    const mapped = new Set(MAP.map(([f]) => f));
    // benchmark_evidence.test.js belongs to point 10, which this checkout cannot
    // meet yet; it is falsified against the complete fixture below instead.
    mapped.add('tests/benchmark_evidence.test.js');
    assert.deepStrictEqual(gate.evidenceFiles().filter((f) => !mapped.has(f)), []);
  });
});

// -------------------------------------------------- fixture checkouts on disk

const SEGMENTS = { 'noisy-output': 'noisy build and test output', coding: 'ordinary coding' };

/** Two segments, two arms, two reps. Baseline's median on the noisy task is 0.42. */
function synthRuns() {
  const plan = {
    'noisy-output': { 'noisy-build': { baseline: [0.40, 0.44], hush: [0.28, 0.30] } },
    coding: { 'write-validator': { baseline: [0.02, 0.02], hush: [0.03, 0.03] } },
  };
  const out = [];
  for (const [segment, tasks] of Object.entries(plan)) {
    for (const [task, arms] of Object.entries(tasks)) {
      for (const [arm, reps] of Object.entries(arms)) {
        reps.forEach((costUsd, i) => out.push({
          key: `${task}__${arm}__r${i + 1}`,
          batchId: 'fixture-0001', seed: '4242', model: 'haiku',
          task, segment, arm, rep: i + 1, costUsd,
          usage: { output_tokens: Math.round(costUsd * 4000) },
          contextTraffic: Math.round(costUsd * 90000),
          narrationWords: arm === 'hush' ? 12 : 90,
          wallMs: 40000 + i * 1000,
          check: { pass: true },
        }));
      }
    }
  }
  return out;
}

const README_FIXTURE = [
  '# hush',
  '',
  'The suite average lands at **$0.42** for a session without the plugin.',
  '',
  "- **Where the parked output lives.** hush deletes that folder when the session ends, and clears anything",
  "  a crashed session left behind once it's a day old.",
  '',
].join('\n');

const HOOKS_FIXTURE = {
  hooks: {
    PostToolUse: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/compress-tool-output.js"' }] }],
  },
};

/**
 * A checkout with only the artifacts the gate reads. Test-backed points are
 * carried by the injected runner, so nothing here has to be a real test file.
 */
function fixtureRoot(tag, opts = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `hush-gate-${tag}-`));
  scratch.push(root);
  fs.mkdirSync(path.join(root, 'hooks'), { recursive: true });
  fs.mkdirSync(path.join(root, 'benchmarks'), { recursive: true });
  for (const skill of ['craft-style', 'hush-compress', 'hush-stats', 'pick-style']) {
    fs.mkdirSync(path.join(root, 'skills', skill), { recursive: true });
  }
  fs.writeFileSync(path.join(root, 'README.md'), opts.readme === undefined ? README_FIXTURE : opts.readme);
  fs.writeFileSync(path.join(root, 'hooks', 'hooks.json'), JSON.stringify(opts.hooks || HOOKS_FIXTURE, null, 2));
  fs.writeFileSync(path.join(root, 'benchmarks', 'config.json'), JSON.stringify({ segments: opts.segments || SEGMENTS }, null, 2));

  const recordsDir = path.join(root, gate.RECORDS_DIR);
  const runs = opts.runs === undefined ? synthRuns() : opts.runs;
  for (const r of runs) writeRecord(recordsDir, r.key, r);

  if (runs.length && opts.published !== 'none') {
    const claims = buildClaims(readRecords(recordsDir).runs);
    const file = path.join(root, gate.PUBLISHED_CLAIMS);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, claims.markdown + (opts.published === 'stale' ? '\nhand-edited afterwards\n' : ''));
  }
  return root;
}

const runFixture = (root, runner = ALL_PASS) => gate.runGate({ root, runTestFile: runner });

describe('falsifiability: a complete evidence set passes, and each break costs its point', () => {
  test('with records, a generated claim set and traceable figures, all ten points are met', () => {
    const report = runFixture(fixtureRoot('complete'));
    assert.deepStrictEqual(report.results.filter((r) => !r.met).map((r) => `${r.n}: ${r.missing}`), []);
    assert.strictEqual(report.ok, true);
    assert.match(gate.render(report), /READY FOR 1\.0 — every point met/);
    assert.ok(point(report, 8).evidence.some((e) => /regenerated 2 segment tables from batch fixture-0001/.test(e)));
  });

  const complete = () => runFixture(fixtureRoot('base'));

  test('point 5 flips when the README stops documenting the sidecar lifecycle', () => {
    const report = runFixture(fixtureRoot('nolifecycle', {
      readme: README_FIXTURE.replace(/hush deletes that folder when the session ends/, 'output is parked in a file'),
    }));
    assert.deepStrictEqual(flipped(complete(), report), [5]);
    assert.match(point(report, 5).missing, /README\.md no longer states when parked output is deleted/);
  });

  test('point 7 flips when a hook starts an on-demand surface', () => {
    const report = runFixture(fixtureRoot('selfstart', {
      hooks: { hooks: { SessionStart: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/skills/hush-compress/run.js"' }] }] } },
    }));
    assert.deepStrictEqual(flipped(complete(), report), [7]);
    assert.match(point(report, 7).missing, /runs hush-compress — an optional surface that starts itself/);
  });

  test('point 8 flips when the published claims no longer match the records', () => {
    const report = runFixture(fixtureRoot('stale', { published: 'stale' }));
    assert.deepStrictEqual(flipped(complete(), report), [8]);
    assert.match(point(report, 8).missing, /is stale — it does not match what the records regenerate/);
  });

  test('points 8 and 10 flip when the records were never published', () => {
    const report = runFixture(fixtureRoot('unpublished', { published: 'none' }));
    assert.deepStrictEqual(flipped(complete(), report), [8, 10]);
    assert.match(point(report, 8).missing, /has never been generated/);
    assert.match(point(report, 10).missing, /retained but not published/);
  });

  test('point 8 flips when a declared workload segment has no runs', () => {
    const report = runFixture(fixtureRoot('onesegment', { runs: synthRuns().filter((r) => r.segment === 'coding') }));
    assert.deepStrictEqual(flipped(complete(), report), [8]);
    assert.match(point(report, 8).missing, /no records for segment\(s\) noisy-output/);
  });

  test('point 8 flips when the README prints a figure no record produces', () => {
    const report = runFixture(fixtureRoot('untraceable', {
      readme: README_FIXTURE.replace('$0.42', '$9.99'),
    }));
    assert.deepStrictEqual(flipped(complete(), report), [8]);
    assert.match(point(report, 8).missing, /1 README figure\(s\) no record produces: \$9\.99/);
  });

  test('point 10 flips when a record carries no batch, seed or segment', () => {
    // The key is left out rather than set to undefined: records.js hashes an
    // undefined value as null but drops the key on write, so such a record can
    // never verify again (reported, not fixed here — it is 175's module).
    const anonymous = synthRuns().map((r) => {
      if (r.key !== 'noisy-build__hush__r1') return r;
      const { seed, ...rest } = r;
      return rest;
    });
    const report = runFixture(fixtureRoot('anonymous', { runs: anonymous }));
    assert.strictEqual(point(report, 10).met, false);
    assert.match(point(report, 10).missing, /carry no batch\/seed\/segment stamp/);
  });

  test('points 8 and 10 flip when a retained record was edited after the fact', () => {
    const root = fixtureRoot('tampered');
    const file = path.join(root, gate.RECORDS_DIR, 'noisy-build__hush__r1.json');
    const edited = JSON.parse(fs.readFileSync(file, 'utf8'));
    edited.costUsd = 0.01;
    fs.chmodSync(file, 0o666);
    fs.writeFileSync(file, JSON.stringify(edited));
    const report = runFixture(root);
    assert.deepStrictEqual(flipped(complete(), report), [8, 10]);
    assert.match(point(report, 10).missing, /hash mismatch/);
  });

  test('point 10 flips when the uncertainty tests themselves fail', () => {
    const report = runFixture(fixtureRoot('nouncertainty'), runnerFailing('tests/benchmark_evidence.test.js'));
    assert.deepStrictEqual(flipped(complete(), report), [10]);
    assert.match(point(report, 10).missing, /tests\/benchmark_evidence\.test\.js does not pass/);
  });
});

// ------------------------------------------------------------- the CLI itself

describe('end to end: the gate runs real tests and exits on the verdict', () => {
  test('a checkout with one failing evidence test reports mixed verdicts and exits 1', () => {
    const root = fixtureRoot('e2e', { runs: [] });
    const files = gate.evidenceFiles();
    const broken = 'tests/disable_conformance.test.js';
    fs.mkdirSync(path.join(root, 'tests'), { recursive: true });
    for (const f of files) {
      fs.writeFileSync(path.join(root, f), f === broken
        ? "require('node:test').test('stub', () => { throw new Error('broken on purpose'); });\n"
        : "require('node:test').test('stub', () => {});\n");
    }

    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_CHANNEL_FD;
    const r = spawnSync(process.execPath, [GATE_SCRIPT, '--root', root], { encoding: 'utf8', env, timeout: 300000 });

    assert.strictEqual(r.status, 1, `expected a blocking exit, got ${r.status}: ${r.stderr}`);
    assert.match(r.stdout, /\[NOT MET\] 1\. Disable means no Hush behavior\./);
    assert.match(r.stdout, /tests\/disable_conformance\.test\.js — 1 of 1 test FAILING/);
    assert.match(r.stdout, /\[MET\]\s+2\. Every lossy view is recoverable/);
    assert.match(r.stdout, /NOT READY FOR 1\.0 — point\(s\) 1, 8, 10 unmet\./);
  });
});
