'use strict';

// ROADMAP 175: the benchmark suite is segmented, its ordering is seeded, its
// statistics are per segment, its records are sanitized and write-once, and
// its published claims are generated from those records.
//
// Everything here is local and pure — no `claude` CLI invocation, no cost.

const { test, describe } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const BENCH = path.join(__dirname, '..', 'benchmarks');
const CONFIG = JSON.parse(fs.readFileSync(path.join(BENCH, 'config.json'), 'utf8'));
const TASKS = JSON.parse(fs.readFileSync(path.join(BENCH, 'tasks.json'), 'utf8'));
const BENCH_README = fs.readFileSync(path.join(BENCH, 'README.md'), 'utf8');

const stats = require('../benchmarks/runner/stats.js');
const records = require('../benchmarks/runner/records.js');
const publish = require('../benchmarks/runner/publish.js');
const { barChartSvg } = require('../benchmarks/runner/chart.js');
const { assertUsableRun } = require('../benchmarks/runner/metrics.js');

const tmp = (name) => fs.mkdtempSync(path.join(os.tmpdir(), `hush-${name}-`));
/** Records are written read-only, so cleanup has to unlock them first. */
function rmTree(dir) {
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

// ---------------------------------------------------------------- segments

describe('segments: every task is placed, every segment is populated', () => {
  test('config declares the five segments the suite is evaluated over', () => {
    assert.deepStrictEqual(Object.keys(CONFIG.segments).sort(), [
      'coding', 'debugging', 'doc-editing', 'noisy-output', 'search-heavy',
    ]);
  });

  test('every task carries a segment config knows about', () => {
    for (const t of TASKS) {
      assert.ok(t.segment, `task ${t.id} has no segment`);
      assert.ok(CONFIG.segments[t.segment], `task ${t.id} has unknown segment "${t.segment}"`);
    }
  });

  test('every segment has at least one task', () => {
    const used = new Set(TASKS.map((t) => t.segment));
    for (const seg of Object.keys(CONFIG.segments)) assert.ok(used.has(seg), `segment ${seg} has no task`);
  });

  test('the default subset exists and covers all five segments', () => {
    const ids = new Set(TASKS.map((t) => t.id));
    for (const id of CONFIG.defaultTasks) assert.ok(ids.has(id), `defaultTasks names a missing task: ${id}`);
    const covered = new Set(TASKS.filter((t) => CONFIG.defaultTasks.includes(t.id)).map((t) => t.segment));
    assert.deepStrictEqual([...covered].sort(), Object.keys(CONFIG.segments).sort());
  });

  test('every fixture a task names exists on disk', () => {
    for (const t of TASKS) {
      if (!t.fixture) continue;
      assert.ok(fs.existsSync(path.join(BENCH, 'fixtures', t.fixture)), `missing fixture ${t.fixture}`);
    }
  });

  test('the search-heavy fixture is big enough that a grep genuinely collapses', () => {
    const dir = path.join(BENCH, 'fixtures', 'call-site-sweep');
    const walk = (d) => fs.readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
    let mentions = 0, legacyCalls = 0;
    for (const f of walk(dir).filter((f) => f.endsWith('.js'))) {
      for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
        if (line.includes('formatAmount')) mentions++;
        if (/return formatAmount\([^)]+,[^)]+\)/.test(line)) legacyCalls++;
      }
    }
    assert.ok(mentions > 200, `only ${mentions} matching lines — too small to be search-heavy`);
    assert.strictEqual(legacyCalls, 17, 'the ground-truth count of deprecated call sites drifted');
  });

  test('the doc-editing fixture ships a real document and a durability check', () => {
    const dir = path.join(BENCH, 'fixtures', 'runbook-edit');
    const doc = fs.readFileSync(path.join(dir, 'docs', 'runbook.md'), 'utf8');
    assert.ok(doc.split('\n').length > 100, 'the runbook is too short to be a durable document');
    assert.strictEqual((doc.match(/\b8081\b/g) || []).length, 3, 'the port the task rewrites drifted');
    assert.ok(fs.existsSync(path.join(dir, 'verify.js')));
    const task = TASKS.find((t) => t.id === 'runbook-edit');
    assert.ok(Array.isArray(task.prompts) && task.prompts.length >= 3, 'doc editing has to span turns');
  });
});

describe('benchmarks/README.md stays in step with the suite', () => {
  test('the stated task count matches tasks.json', () => {
    const m = BENCH_README.match(/The tasks: \*\*(\d+)\*\* in all/);
    assert.ok(m, 'README no longer states a task count in the expected shape');
    assert.strictEqual(Number(m[1]), TASKS.length);
  });

  test('the stated segment names match config.json', () => {
    for (const label of Object.values(CONFIG.segments)) {
      assert.ok(BENCH_README.includes(label), `README never names the segment "${label}"`);
    }
  });

  test('every per-segment task count in the README matches tasks.json', () => {
    for (const [id, label] of Object.entries(CONFIG.segments)) {
      const n = TASKS.filter((t) => t.segment === id).length;
      const re = new RegExp(`\\*\\*${label}\\*\\* \\((\\d+)\\)`);
      const m = BENCH_README.match(re);
      assert.ok(m, `README does not carry a count for "${label}"`);
      assert.strictEqual(Number(m[1]), n, `README says ${m[1]} tasks for "${label}", tasks.json has ${n}`);
    }
  });

  test('the flags the README documents are the flags the runner accepts', () => {
    const run = fs.readFileSync(path.join(BENCH, 'runner', 'run.js'), 'utf8');
    for (const f of ['--seed', '--ablations']) {
      assert.ok(BENCH_README.includes(f), `README never documents ${f}`);
      assert.ok(run.includes(f), `run.js never reads ${f}`);
    }
  });
});

// ---------------------------------------------------------- seeded ordering

describe('ordering: randomized, seeded, replayable', () => {
  const arms = ['baseline', 'hush', 'hush-core-only', 'hush-quiet-only'];

  test('the same seed replays the same order', () => {
    const a = stats.shuffled(arms, stats.makeRng('run-42'));
    const b = stats.shuffled(arms, stats.makeRng('run-42'));
    assert.deepStrictEqual(a, b);
  });

  test('a different seed generally gives a different order', () => {
    const first = stats.shuffled(arms, stats.makeRng(1)).join(',');
    const differing = Array.from({ length: 20 }, (_, i) => stats.shuffled(arms, stats.makeRng(i + 2)).join(','))
      .filter((o) => o !== first);
    assert.ok(differing.length >= 10, 'shuffle barely moves anything across seeds');
  });

  test('a shuffle is a permutation, never a resample', () => {
    const rng = stats.makeRng('perm');
    for (let i = 0; i < 50; i++) {
      assert.deepStrictEqual(stats.shuffled(arms, rng).slice().sort(), arms.slice().sort());
    }
  });

  test('every arm reaches every position across seeds — no arm is pinned first', () => {
    const firsts = new Set();
    for (let i = 0; i < 200; i++) firsts.add(stats.shuffled(arms, stats.makeRng(`s${i}`))[0]);
    assert.deepStrictEqual([...firsts].sort(), arms.slice().sort());
  });

  test('a numeric seed and its string form are the same stream', () => {
    assert.deepStrictEqual(stats.shuffled(arms, stats.makeRng(7)), stats.shuffled(arms, stats.makeRng('7')));
  });
});

// ------------------------------------------------------------- distributions

describe('distributions: hand-checkable statistics', () => {
  test('quantiles interpolate the way the R-7 definition does', () => {
    const xs = [1, 2, 3, 4];
    assert.strictEqual(stats.quantile(xs, 0.5), 2.5);
    assert.strictEqual(stats.quantile(xs, 0.25), 1.75);
    assert.strictEqual(stats.quantile(xs, 0.75), 3.25);
    assert.strictEqual(stats.quantile([5], 0.5), 5);
    assert.ok(Number.isNaN(stats.quantile([], 0.5)));
  });

  test('summarize reports centre, spread, and an interval', () => {
    const s = stats.summarize([2, 4, 4, 4, 5, 5, 7, 9]);
    assert.strictEqual(s.n, 8);
    assert.strictEqual(s.mean, 5);
    assert.strictEqual(s.median, 4.5);
    assert.strictEqual(s.min, 2);
    assert.strictEqual(s.max, 9);
    assert.ok(Math.abs(s.sd - 2.13809) < 0.001, `sd was ${s.sd}`);
    assert.ok(s.ci95[0] < s.mean && s.ci95[1] > s.mean);
  });

  test('a single data point gets no confidence interval instead of a fake one', () => {
    const s = stats.summarize([3]);
    assert.strictEqual(s.ci95, null);
    assert.ok(Number.isNaN(s.sd));
  });

  test('non-numeric values are dropped, not counted as zero', () => {
    assert.strictEqual(stats.summarize([2, undefined, 4, NaN, null]).n, 2);
    assert.strictEqual(stats.summarize([2, undefined, 4, NaN]).mean, 3);
  });
});

// --------------------------------------------------------------- synthetic runs

// One tidy synthetic batch: two segments, two tasks each, two arms, two reps.
// hush wins on the noisy segment and loses on the quiet one — the shape the
// suite average is known to hide.
function synthRuns() {
  const cost = {
    'noisy-output': {
      'log-triage': { baseline: [0.40, 0.44], hush: [0.28, 0.30] },
      'noisy-build': { baseline: [0.20, 0.22], hush: [0.16, 0.14] },
    },
    coding: {
      'explain-rebase': { baseline: [0.02, 0.02], hush: [0.03, 0.03] },
      'write-validator': { baseline: [0.04, 0.04], hush: [0.05, 0.05] },
    },
  };
  const out = [];
  for (const [segment, tasks] of Object.entries(cost)) {
    for (const [task, arms] of Object.entries(tasks)) {
      for (const [arm, reps] of Object.entries(arms)) {
        reps.forEach((c, i) => out.push({
          key: `${task}__${arm}__r${i + 1}`,
          batchId: 'synthetic-0001', seed: '12345', model: 'haiku',
          task, segment, arm, rep: i + 1,
          costUsd: c,
          usage: { output_tokens: Math.round(c * 4000) },
          contextTraffic: Math.round(c * 90000),
          narrationWords: arm === 'hush' ? 12 : 90,
          toolResultChars: Math.round(c * 50000),
          wallMs: 40000 + i * 1000,
          check: { pass: true, score: 1 },
        }));
      }
    }
  }
  return out;
}

describe('per-segment reporting, never one suite average', () => {
  const runs = synthRuns();

  test('segments are reported separately and both directions survive', () => {
    const report = stats.segmentReport(runs, { metric: 'cost' });
    assert.deepStrictEqual(report.map((r) => r.segment), ['coding', 'noisy-output']);

    const noisy = report.find((r) => r.segment === 'noisy-output').arms;
    assert.strictEqual(noisy.baseline.n, 4);
    assert.strictEqual(noisy.hush.n, 4);
    assert.strictEqual(noisy.baseline.median, 0.31);   // (0.22, 0.40) midpoint
    assert.ok(noisy.hush.vsBaseline.medianDeltaPct < -20, 'hush should win clearly on noisy output');
    assert.strictEqual(noisy.hush.vsBaseline.winRate, 1);
    assert.strictEqual(noisy.hush.vsBaseline.maxRegression, null);

    const coding = report.find((r) => r.segment === 'coding').arms;
    assert.ok(coding.hush.vsBaseline.medianDeltaPct > 0, 'hush should lose on quiet coding');
    assert.strictEqual(coding.hush.vsBaseline.winRate, 0);
  });

  test('the worst single regression is named, not averaged away', () => {
    const coding = stats.segmentReport(runs, { metric: 'cost' })
      .find((r) => r.segment === 'coding').arms;
    const worst = coding.hush.vsBaseline.maxRegression;
    assert.strictEqual(worst.task, 'explain-rebase');
    assert.ok(Math.abs(worst.deltaPct - 50) < 0.001, `expected +50%, got ${worst.deltaPct}`);
  });

  test('a per-task comparison uses medians, so one wild rep cannot flip it', () => {
    const wild = synthRuns();
    // Three reps, one of them wild: the mean chases the outlier, the median does not.
    const third = { ...wild.find((r) => r.task === 'noisy-build' && r.arm === 'hush' && r.rep === 1) };
    wild.push({ ...third, key: 'noisy-build__hush__r3', rep: 3, costUsd: 0.15 });
    const victim = wild.find((r) => r.task === 'noisy-build' && r.arm === 'hush' && r.rep === 2);
    victim.costUsd = 9.99;
    const noisy = stats.segmentReport(wild, { metric: 'cost' }).find((r) => r.segment === 'noisy-output').arms;
    assert.strictEqual(noisy.hush.vsBaseline.winRate, 1, 'one outlier rep should not lose the task');
    assert.ok(noisy.hush.mean > noisy.baseline.mean, 'the mean still shows the outlier');
    assert.ok(noisy.hush.median < noisy.baseline.median, 'the median stays robust');
  });

  test('latency and pass rate are reported per segment too', () => {
    const noisy = stats.segmentReport(runs, { metric: 'cost' }).find((r) => r.segment === 'noisy-output').arms;
    assert.strictEqual(noisy.hush.passRate, 1);
    assert.strictEqual(noisy.hush.latencyMedianS, 40.5);
  });

  test('other metrics report through the same path', () => {
    for (const metric of Object.keys(stats.METRICS)) {
      const r = stats.segmentReport(runs, { metric });
      assert.strictEqual(r.length, 2, `metric ${metric} lost a segment`);
    }
    assert.throws(() => stats.segmentReport(runs, { metric: 'nope' }), /unknown metric/);
  });

  test('errored runs never reach a statistic', () => {
    const withError = [...runs, { task: 'x', segment: 'coding', arm: 'hush', error: 'rate limited' }];
    const coding = stats.segmentReport(withError, { metric: 'cost' }).find((r) => r.segment === 'coding').arms;
    assert.strictEqual(coding.hush.n, 4);
  });
});

// ---------------------------------------------------------------- sanitizing

describe('records are sanitized before anything is written', () => {
  const identity = { username: 'songbird', hosts: ['DEV-BOX-01'] };
  const clean = (s) => records.sanitizeText(s, identity);

  test('absolute paths go, on both platforms', () => {
    assert.strictEqual(clean('read C:\\Users\\songbird\\secrets\\notes.txt ok'), 'read <path> ok');
    assert.ok(!clean('cd /home/songbird/work/hush && ls').includes('/home/'));
    assert.ok(!clean('spawned in /tmp/hush-bench/mine').includes('/tmp/'));
    assert.ok(!clean('share \\\\FILESRV\\build\\out.log').includes('FILESRV'));
  });

  test('the username and the machine name go', () => {
    assert.strictEqual(clean('user songbird on DEV-BOX-01'), 'user <user> on <host>');
    assert.strictEqual(clean('SONGBIRD logged in'), '<user> logged in');
  });

  test('env values go, the names stay', () => {
    assert.strictEqual(clean('ANTHROPIC_BASE_URL=https://internal.example'), 'ANTHROPIC_BASE_URL=<redacted-env>');
    assert.strictEqual(clean('HUSH_WRAP=1'), 'HUSH_WRAP=<redacted-env>');
  });

  test('secret-shaped text goes', () => {
    for (const secret of [
      'sk-ant-api03-AAAABBBBCCCCDDDD',
      'ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      'AKIAIOSFODNN7EXAMPLE',
      'xoxb-1234-5678-abcdefghijklmnop',
      'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
    ]) {
      assert.ok(clean(`token: ${secret}`).includes('<redacted-secret>'), `${secret} survived`);
      assert.ok(!clean(`token: ${secret}`).includes(secret.slice(-12)), `${secret} survived`);
    }
    assert.ok(!clean('key -----BEGIN RSA PRIVATE KEY-----\nMIIabc\n-----END RSA PRIVATE KEY-----').includes('MIIabc'));
    assert.ok(clean('mail me at dev@example.com').includes('<email>'));
  });

  test('a long unbroken token is redacted even when we cannot name it', () => {
    assert.ok(clean('id 9f3a7c1e9f3a7c1e9f3a7c1e9f3a7c1e9f3a7c1eXX').includes('<redacted-secret>'));
  });

  test('the whole record is walked, and sensitive keys lose their value outright', () => {
    const dirty = {
      key: 'log-triage__hush__r1',
      env: { ANTHROPIC_API_KEY: 'sk-ant-secret-value-here' },
      cwd: 'C:\\Users\\songbird\\repo',
      stderr: 'failed in /home/songbird/tmp with token ghp_0123456789abcdefghijklmnopqrstuvwxyz',
      nested: [{ finalText: 'wrote C:\\Users\\songbird\\out.md on DEV-BOX-01' }],
      costUsd: 0.12,
    };
    const out = records.sanitizeRecord(dirty, identity);
    const flat = JSON.stringify(out);
    assert.ok(!flat.includes('songbird'));
    assert.ok(!flat.includes('DEV-BOX-01'));
    assert.ok(!flat.includes('sk-ant'));
    assert.ok(!flat.includes('ghp_'));
    assert.strictEqual(out.env, '<redacted>');
    assert.strictEqual(out.cwd, '<redacted>');
    assert.strictEqual(out.costUsd, 0.12, 'numbers must survive intact');
    assert.strictEqual(out.key, 'log-triage__hush__r1');
  });

  test('the real machine identity is scrubbed by default', () => {
    const me = records.localIdentity();
    const text = records.sanitizeText(`ran as ${me.username || 'nobody'} on ${os.hostname()}`);
    if (me.username && me.username.length > 2) assert.ok(!text.includes(me.username));
    assert.ok(!text.includes(os.hostname()));
  });
});

// ---------------------------------------------------------------- immutability

describe('records are write-once and hash-stamped', () => {
  test('a record is hashed on write and verifies on read', () => {
    const dir = tmp('rec');
    try {
      records.writeRecord(dir, 'a__hush__r1', { task: 'a', arm: 'hush', costUsd: 0.5 });
      const { runs } = records.readRecords(dir);
      assert.strictEqual(runs.length, 1);
      assert.match(runs[0].contentSha256, /^[0-9a-f]{64}$/);
      assert.ok(records.verifyRecord(runs[0]));
    } finally { rmTree(dir); }
  });

  test('a second write to the same name is refused, and the first survives', () => {
    const dir = tmp('rec-once');
    try {
      records.writeRecord(dir, 'a__hush__r1', { costUsd: 0.5 });
      assert.throws(() => records.writeRecord(dir, 'a__hush__r1', { costUsd: 9.9 }),
        /refusing to overwrite/);
      assert.strictEqual(records.readRecords(dir).runs[0].costUsd, 0.5);
    } finally { rmTree(dir); }
  });

  test('an edited record is detected instead of quietly published', () => {
    const dir = tmp('rec-tamper');
    try {
      const file = records.writeRecord(dir, 'a__hush__r1', { costUsd: 0.5 });
      const edited = JSON.parse(fs.readFileSync(file, 'utf8'));
      edited.costUsd = 0.05;
      fs.chmodSync(file, 0o666);
      fs.writeFileSync(file, JSON.stringify(edited));
      assert.strictEqual(records.verifyRecord(edited), false);
      assert.throws(() => records.readRecords(dir), /hash mismatch/);
    } finally { rmTree(dir); }
  });

  test('the hash is over content, not key order or whitespace', () => {
    const a = { task: 'x', arm: 'hush', usage: { output_tokens: 4 } };
    const b = { usage: { output_tokens: 4 }, arm: 'hush', task: 'x' };
    assert.strictEqual(records.hashRecord(a), records.hashRecord(b));
    assert.notStrictEqual(records.hashRecord(a), records.hashRecord({ ...a, arm: 'baseline' }));
  });
});

// ---------------------------------------------------------------- publishing

describe('published claims are generated from records', () => {
  const runs = synthRuns();

  test('the claim table carries per-segment numbers that match the statistics', () => {
    const { markdown } = publish.buildClaims(runs);
    assert.match(markdown, /## By segment/);
    assert.match(markdown, /\| noisy-output \| hush \| 4 \|/);
    assert.match(markdown, /\| coding \| baseline \| 4 \|/);
    // The worst regression is printed, named, and matches segmentReport.
    const worst = stats.segmentReport(runs, { metric: 'cost' })
      .find((r) => r.segment === 'coding').arms.hush.vsBaseline.maxRegression;
    assert.ok(markdown.includes(`${worst.task} +${worst.deltaPct.toFixed(1)}%`), 'regression missing from claims');
    assert.match(markdown, /batch `synthetic-0001`/);
    assert.match(markdown, /seed `12345`/);
  });

  test('the suite total is present but labelled as a headline, not evidence', () => {
    const { markdown } = publish.buildClaims(runs);
    assert.match(markdown, /## Suite total/);
    assert.match(markdown, /not evidence/);
  });

  test('charts come out as standalone SVG, one bar per arm per segment', () => {
    const { charts } = publish.buildClaims(runs);
    const svg = charts['cost-by-segment.svg'];
    assert.ok(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"'));
    assert.ok(svg.endsWith('</svg>'));
    assert.strictEqual((svg.match(/<rect /g) || []).length, 1 + 2 * 2 + 2, 'background + 2 segments x 2 arms + legend');
    assert.ok(svg.includes('aria-label'));
    assert.ok(svg.includes('noisy-output') && svg.includes('coding'));
  });

  test('a chart of nothing still produces a valid file rather than crashing', () => {
    const svg = barChartSvg('empty', 'none', {}, []);
    assert.ok(svg.startsWith('<svg') && svg.endsWith('</svg>'));
  });

  test('records from two batches are refused — cost is not comparable across them', () => {
    const spliced = [...runs, { ...runs[0], key: 'other', batchId: 'other-batch' }];
    assert.throws(() => publish.buildClaims(spliced), /span 2 batches/);
    assert.throws(() => publish.buildClaims(spliced), /not comparable/);
  });

  test('publishing an empty record set is an error, not an empty claim', () => {
    assert.throws(() => publish.buildClaims([]), /no records/);
  });

  test('end to end: write records, read them back, publish from disk', () => {
    const dir = tmp('publish');
    try {
      for (const r of runs) records.writeRecord(dir, r.key, r);
      const { runs: back } = records.readRecords(dir);
      assert.strictEqual(back.length, runs.length);
      const { markdown, charts } = publish.buildClaims(back);
      assert.match(markdown, /Generated from 16 retained run records/);
      assert.strictEqual(Object.keys(charts).length, 3);
    } finally { rmTree(dir); }
  });
});

// ------------------------------------------------------------- data honesty

describe('a run that cannot be a data point is refused', () => {
  const ok = { costUsd: 0.02, finalText: 'here is the fix', resultSubtype: 'success' };

  test('a rate-limited reply never becomes a very terse answer in the averages', () => {
    for (const text of [
      "You've hit your session limit. Try again later.",
      'You’ve hit your usage limit — resets at 3pm',
      "you've hit your weekly limit",
    ]) {
      assert.throws(() => assertUsableRun([{ ...ok, finalText: text }]), /rate limited/);
    }
  });

  test('a zero-cost or cost-less call is refused', () => {
    assert.throws(() => assertUsableRun([{ ...ok, costUsd: 0 }]), /zero-cost/);
    assert.throws(() => assertUsableRun([{ ...ok, costUsd: null }]), /zero-cost/);
    assert.throws(() => assertUsableRun([{ ...ok, costUsd: undefined }]), /zero-cost/);
  });

  test('one poisoned call in a multi-turn session fails the whole run', () => {
    assert.throws(() => assertUsableRun([ok, { ...ok, costUsd: 0 }, ok]), /zero-cost/);
    assert.doesNotThrow(() => assertUsableRun([ok, ok, ok]));
  });
});

describe('batch provenance makes a splice detectable', () => {
  test('the runner stamps batch, seed and order onto every record', () => {
    const run = fs.readFileSync(path.join(BENCH, 'runner', 'run.js'), 'utf8');
    for (const field of ['batchId', 'seed', 'orderIndex', 'segment']) {
      assert.ok(run.includes(field), `run.js never records ${field}`);
    }
  });

  test('the batch id is derived from the run configuration, not the clock', () => {
    const run = fs.readFileSync(path.join(BENCH, 'runner', 'run.js'), 'utf8');
    const line = run.split('\n').find((l) => l.includes('const batchId ='));
    assert.ok(line && !/Date\.now|toISOString/.test(line), 'batchId must be reproducible across a --resume');
  });

  // --dry-run resolves the seed, prints the batch id and writes the tag's
  // manifest without spawning a single billable session, so the whole resume
  // contract is checkable for free.
  const planRun = (tag, ...args) => {
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    delete env.NODE_CHANNEL_FD;
    return spawnSync(process.execPath,
      [path.join(BENCH, 'runner', 'run.js'), '--tag', tag, '--dry-run', '--tasks', 'explain-rebase', ...args],
      { cwd: BENCH, encoding: 'utf8', env });
  };
  const batchLine = (r) => (r.stdout.match(/batch (\S+) · seed (\S+)/) || []).slice(1, 3);

  test('--resume with no --seed continues the same batch instead of forking it', () => {
    const tag = `resume-probe-${process.pid}`;
    const resDir = path.join(BENCH, 'results', tag);
    try {
      const first = planRun(tag);
      assert.strictEqual(first.status, 0, first.stderr);
      const [batch1, seed1] = batchLine(first);
      assert.ok(batch1 && seed1, `no batch line in: ${first.stdout}`);

      const resumed = planRun(tag, '--resume');
      assert.strictEqual(resumed.status, 0, resumed.stderr);
      const [batch2, seed2] = batchLine(resumed);
      assert.strictEqual(seed2, seed1, '--resume invented a new seed');
      assert.strictEqual(batch2, batch1, '--resume forked the batch — its records would split in two');
      assert.ok(fs.existsSync(path.join(resDir, 'batch.json')), 'the tag-scoped manifest was not written');

      // A run that is not resuming is a new batch, clock-seeded as before.
      const [batch3] = batchLine(planRun(tag));
      assert.notStrictEqual(batch3, batch1, 'a fresh run should not silently join an old batch');
    } finally { rmTree(resDir); }
  });

  test('--resume with no seed to be found fails loudly, naming --seed', () => {
    const tag = `resume-orphan-${process.pid}`;
    const resDir = path.join(BENCH, 'results', tag);
    try {
      const orphan = planRun(tag, '--resume');
      assert.notStrictEqual(orphan.status, 0, 'a resume with no findable seed must not quietly fork');
      assert.match(orphan.stderr, /--resume cannot find the seed/);
      assert.match(orphan.stderr, /--seed/);
    } finally { rmTree(resDir); }
  });

  test('arms are interleaved inside a task+rep block, not run arm by arm', () => {
    const arms = ['baseline', 'hush'];
    const rng = stats.makeRng('queue');
    const queue = [];
    for (const task of ['t1', 't2']) {
      for (let r = 1; r <= 2; r++) for (const a of stats.shuffled(arms, rng)) queue.push(`${task}__${a}__r${r}`);
    }
    // Within any window of one block, both arms appear — never all of one arm first.
    for (let i = 0; i < queue.length; i += 2) {
      const block = queue.slice(i, i + 2).map((k) => k.split('__')[1]);
      assert.deepStrictEqual(block.slice().sort(), arms.slice().sort());
    }
  });
});

// ---------------------------------------------------------------- ablations

describe('ablation arms reuse the rival plumbing', () => {
  const run = fs.readFileSync(path.join(BENCH, 'runner', 'run.js'), 'utf8');

  test('both surfaces get an arm, wired through the same addArm the rivals use', () => {
    assert.match(run, /addArm\('hush-core-only', HUSH_DIR,[\s\S]*?\{ HUSH_QUIET: 'off' \}\)/);
    assert.match(run, /addArm\('hush-quiet-only', HUSH_DIR,[\s\S]*?\{ HUSH_CORE: 'off' \}\)/);
    assert.match(run, /rivalDirs\.forEach\([\s\S]*?addArm\(name, dir/);
  });

  test('the off tokens the arms pass are the ones the gate honours', () => {
    const gate = require('../hooks/lib/gate.js');
    const prev = { core: process.env.HUSH_CORE, quiet: process.env.HUSH_QUIET };
    try {
      delete process.env.HUSH_CORE;
      delete process.env.HUSH_QUIET;
      assert.strictEqual(gate.coreOff(), false);
      assert.strictEqual(gate.quietOff(), false);
      process.env.HUSH_QUIET = 'off';
      assert.strictEqual(gate.quietOff(), true);
      assert.strictEqual(gate.coreOff(), false, 'Core-only means Core still runs');
      delete process.env.HUSH_QUIET;
      process.env.HUSH_CORE = 'off';
      assert.strictEqual(gate.coreOff(), true);
      assert.strictEqual(gate.quietOff(), false, 'Quiet-only means Quiet still runs');
    } finally {
      for (const [k, v] of [['HUSH_CORE', prev.core], ['HUSH_QUIET', prev.quiet]]) {
        if (v === undefined) delete process.env[k]; else process.env[k] = v;
      }
    }
  });
});
