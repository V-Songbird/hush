'use strict';

// How a sidecar digest can fail a node --test run:
// F1 A TAP digest names only a few failed tests, because each failure's
//    error, code and name lines use up the signal sample.
// F2 A failed TAP suite's own `not ok` line takes a test's place in the sample.
// F3 A spec digest omits the failed test names from its `failing tests` section.
// F4 A spec digest omits the pass or skipped count printed mid-output.
// F5 A digest of node --test failures loses the first failure's error detail.
// F6 The failed names fall past the 2 KB preview the host shows for a cut output.
// F7 Many failures make the digest grow without a bound.
// F8 A ✖ line outside a `failing tests` section, such as ESLint's, becomes signal.
// F9 A digest of another runner's output changes.
// F10 A stray `not ok` in a log that is no TAP stream replaces its signal sample.
// F11 The digest's census counts a spec run's `ℹ` score lines as failure evidence.

const { test } = require('node:test');
const assert = require('node:assert');
const { buildSidecarDigest } = require('../hooks/compress-tool-output');

const nameOf = (i) => `computes invoice-case-${String(i).padStart(4, '0')} totals`;

function tapOutput(failed, padding = 40) {
  const out = ['TAP version 13'];
  for (let i = 0; i < padding; i++) out.push(`    ok ${i + 1} - passing case ${i}`, '      ---', '      duration_ms: 0.1', "      type: 'test'", '      ...');
  for (let i = 0; i < failed; i++) {
    out.push(
      `    not ok ${i + 1} - ${nameOf(i)}`, '      ---', '      duration_ms: 0.6', "      type: 'test'",
      "      failureType: 'testCodeFailure'", '      error: |-', '        Expected values to be strictly equal:',
      `        ${i + 1} !== ${i}`, "      code: 'ERR_ASSERTION'", "      name: 'AssertionError'", '      ...',
      `not ok ${i + 1} - billing group ${i}`, '  ---', '  duration_ms: 1', "  type: 'suite'", "  error: '1 subtest failed'", "  code: 'ERR_TEST_FAILURE'", '  ...'
    );
  }
  out.push(`# tests ${failed + padding}`, `# pass ${padding}`, `# fail ${failed}`, '# cancelled 0', '# skipped 0', '# todo 0', '# duration_ms 12');
  return out.join('\n');
}

function specOutput(failed, padding = 300) {
  const out = [];
  for (let i = 0; i < padding; i++) out.push(`  ✔ passing case ${i} (0.1ms)`);
  out.push(`ℹ tests ${failed + padding + 3}`, 'ℹ suites 4', `ℹ pass ${padding}`, `ℹ fail ${failed}`, 'ℹ cancelled 0', 'ℹ skipped 3', 'ℹ todo 0', 'ℹ duration_ms 12', '', '✖ failing tests:', '');
  for (let i = 0; i < failed; i++) {
    out.push(
      `test at C:\\work\\billing.test.js:${i + 7}:3`, `✖ ${nameOf(i)} (0.7ms)`,
      '  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:', '  ', `  ${i + 1} !== ${i}`, '  ',
      `      at TestContext.<anonymous> (C:\\work\\billing.test.js:${i + 7}:58)`, '      at Test.run (node:internal/test_runner/test:1047:25)',
      "    code: 'ERR_ASSERTION',", '  }', ''
    );
  }
  return out.join('\n');
}

const named = (body, count) => Array.from({ length: count }, (_, i) => i).filter((i) => body.includes(nameOf(i))).length;
const leadOf = (body) => body.split('Structure (')[0];

test('F1 guard: a TAP digest names up to twenty failed tests', () => {
  assert.strictEqual(named(leadOf(buildSidecarDigest(tapOutput(12)).body), 12), 12);
});

test('F2 guard: a failed TAP suite line takes no place in the name sample', () => {
  const lead = leadOf(buildSidecarDigest(tapOutput(12)).body);
  assert.ok(!/not ok \d+ - billing group/.test(lead), lead);
});

test('F3 guard: a spec digest names the failed tests', () => {
  assert.strictEqual(named(leadOf(buildSidecarDigest(specOutput(12)).body), 12), 12);
});

test('F4 guard: a spec digest keeps the pass, fail and skipped counts', () => {
  const lead = leadOf(buildSidecarDigest(specOutput(12)).body);
  for (const count of ['ℹ pass 300', 'ℹ fail 12', 'ℹ skipped 3']) assert.ok(lead.includes(count), count);
});

test('F5 guard: the first failure keeps its error detail', () => {
  assert.match(leadOf(buildSidecarDigest(tapOutput(12)).body), /error: \|-/);
  assert.match(leadOf(buildSidecarDigest(specOutput(12)).body), /AssertionError \[ERR_ASSERTION\]/);
});

test('F6 guard: twelve failed names fit a 2 KB preview', () => {
  for (const output of [tapOutput(12), specOutput(12)]) {
    assert.strictEqual(named(buildSidecarDigest(output, [], true).body.slice(0, 1400), 12), 12);
  }
});

test('F7 guard: two hundred failures keep the lead bounded', () => {
  for (const output of [tapOutput(200), specOutput(200)]) {
    const lead = leadOf(buildSidecarDigest(output).body);
    assert.strictEqual(named(lead, 200), 20);
    assert.ok(lead.split('\n').length <= 40, `${lead.split('\n').length} lead lines`);
    assert.match(lead, /Other signal lines \(not shown\)/);
  }
});

test('F8 guard: an ESLint ✖ summary does not become signal', () => {
  const warnings = (from) => Array.from({ length: 20 }, (_, i) => `  ${from + i}:1  warning  unused value  no-unused-vars`);
  const lint = [...warnings(0), '✖ 3 problems', 'ℹ pass 3', ...warnings(20)];
  const lead = leadOf(buildSidecarDigest(lint.join('\n')).body);
  assert.ok(!lead.includes('✖ 3 problems'), lead);
  assert.ok(!lead.includes('ℹ pass 3'), lead);
});

test('F10 guard: a stray not ok leaves a plain log on its signal sample', () => {
  const log = Array.from({ length: 12 }, (_, i) => `ERROR worker ${i} lost its socket`);
  log.splice(6, 0, 'not ok 7 - parses the receipt');
  const lead = leadOf(buildSidecarDigest(log.join('\n')).body);
  for (let i = 0; i < 12; i++) assert.ok(lead.includes(`ERROR worker ${i} lost`), `worker ${i}`);
});

test('F11 guard: a spec census counts no score line', () => {
  const lines = specOutput(2).split('\n');
  const withScores = buildSidecarDigest(lines.join('\n')).signalCount;
  const withoutScores = buildSidecarDigest(lines.filter((l) => !/^ℹ (?:tests|pass|cancelled|skipped|todo) /.test(l)).join('\n')).signalCount;
  assert.strictEqual(withScores, withoutScores);
});

test('F9 guard: a jest digest still samples its first and last signal lines', () => {
  const jest = ['FAIL tests/a.test.js'];
  for (let i = 0; i < 30; i++) jest.push(`    ✕ ${nameOf(i)} (2 ms)`);
  jest.push('Tests:       30 failed, 30 total');
  const lead = leadOf(buildSidecarDigest(jest.join('\n')).body);
  assert.ok(lead.includes(nameOf(0)) && lead.includes(nameOf(8)) && lead.includes(nameOf(29)));
  assert.ok(!lead.includes(nameOf(15)));
});
