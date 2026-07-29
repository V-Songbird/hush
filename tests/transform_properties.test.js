'use strict';

// Adversarial evidence for the transform layer: generated inputs instead of
// hand-picked ones, and the product invariants asserted over every case rather
// than over the examples someone thought of.
//
// The invariants under test, as the product contract states them:
//
//   1. A lossy transform without a retrievable full original is rejected.
//   2. A structured transform preserves every field or does not run.
//   3. A transform that is not smaller is rejected.
//
// All three are enforced in ONE place — deliver() in compress-tool-output.js —
// and the fallback for all three is the same: drop the rewrite and ship the
// original untouched. So the assertions below run on what deliver() actually
// SHIPS, not on what compress() happened to return.
//
// Determinism is not negotiable here. Every payload comes from a seeded PRNG,
// the seed is in every failure message, and nothing reads the clock or
// Math.random — a property suite that fails one run in twenty teaches nobody
// anything. A reported failure reproduces from its seed alone.
//
// The keep-line oracle compares against the CLEANED text (ANSI stripped,
// carriage returns resolved), not the raw input: cleaning is documented to
// collapse a `\r`-redrawn line to its final state, so a keep line overwritten
// by a later redraw was never in the view hush was asked to preserve.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const {
  compress,
  deliver,
  isKeepLine,
  looksLikeFailure,
  stripAnsi,
  resolveCarriageReturns,
  changedLineIndexes,
  renderDelta,
  compressGrep,
  claimSessionNote,
  FAILURE_RERUN_NOTE,
} = require('../hooks/compress-tool-output');
const { buildRecord, recoveryGap, sizeGap, fieldGap } = require('../hooks/lib/transform-manifest');
const sidecarStore = require('../hooks/lib/sidecar-store');
const { HOOKS_DIR } = require('./helpers');

const ESC = '\u001b';

// This file never wants the on-disk manifest: deliver() appends a record when
// HUSH_DEBUG=1, and a few hundred generated cases would write a few hundred
// lines into the developer's temp directory. The manifest's own behavior is
// exercised by the spawned hooks further down, each with its own scratch TEMP.
process.env.HUSH_DEBUG = '0';

const SCRATCH = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-props-'));
const SIDECAR_SESSION = `hushprops${crypto.randomBytes(4).toString('hex')}`;
after(() => {
  fs.rmSync(SCRATCH, { recursive: true, force: true });
  sidecarStore.removeSession(SIDECAR_SESSION);
});

// ---------------------------------------------------------------------------
// Seeded generation
// ---------------------------------------------------------------------------

// mulberry32: four lines, no dependency, identical output for identical seeds
// on every platform. A property-testing package would add shrinking; the seed
// in the failure message plus a fixed case count buys reproduction, which is
// the half that matters when this runs somewhere nobody is watching.
function prng(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pick = (r, arr) => arr[Math.min(arr.length - 1, Math.floor(r() * arr.length))];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));

// One generator per line SHAPE the transforms treat differently. Signal,
// failure, traceback and exit vocabulary each get their own kind, so a
// generated mix lands them at any position — head, tail, or the middle the cap
// cuts out.
const LINE_KINDS = {
  noise: (r, i) => `2026-07-28T10:00:${String(i % 60).padStart(2, '0')} worker-${i % 7} step ${i} finished, artifact written ok`,
  template: (r, i) => `INFO worker-${i % 4} processing job ${8000 + i} in region eu-west-${i % 3}`,
  repeat: () => 'the same line, over and over, byte for byte identical',
  short: (r) => pick(r, ['x', 'y', '.', '-', '::']),
  blank: () => '',
  signal: (r, i) =>
    pick(r, [
      `WARNING: api v${i} is deprecated`,
      `ERROR: connection refused on port ${9000 + i}`,
      `FAILED: step ${i} of 12`,
      `TypeError: cfg${i} is not a function`,
      `CRITICAL: disk ${i} full`,
      `Build FAILURE in module-${i}`,
    ]),
  traceback: (r, i) =>
    pick(r, [
      'Traceback (most recent call last):',
      `  File "/srv/app/mod_${i}.py", line ${i + 3}, in run`,
      '    do_the_thing(payload)',
      `ValueError: bad input at index ${i}`,
    ]),
  exitish: (r, i) =>
    pick(r, [`Command exited with code ${128 + (i % 16)}`, 'Killed', 'Segmentation fault (core dumped)', 'Terminated']),
  ansi: (r, i) => `${ESC}[31mred ${i}${ESC}[0m plain ${ESC}[1mbold${ESC}[0m`,
  cr: (r, i) => `progress ${i}%\rprogress ${i + 1}%\rprogress ${i + 2}% done`,
  unicode: (r, i) => `日本語 ✗ ${i} — ①②③ \u{1f600}`,
  wide: (r, i) => 'w'.repeat(180) + ` ${i}`,
  nul: (r, i) => `pre\u0000post ${i}`,
  surrogate: (r, i) => `lone \ud800 pair ${i}`,
  markerish: (r, i) => `[hush hook: ${i} lines omitted from this view, none with warnings/errors/failures]`,
};

// Line counts sit ON the thresholds (60 pass cap, 250 fail cap, 5 template-run
// minimum) and one either side of each, so an off-by-one in any of them is
// inside the generated space rather than next to it.
const COUNTS = [0, 1, 2, 4, 5, 6, 59, 60, 61, 62, 249, 250, 251, 300];
const KINDS = Object.keys(LINE_KINDS);

function generate(seed) {
  const r = prng(seed);
  const mix = Array.from({ length: int(r, 1, 4) }, () => pick(r, KINDS));
  const count = pick(r, COUNTS);
  const lines = Array.from({ length: count }, (_, i) => LINE_KINDS[pick(r, mix)](r, i));
  const eol = pick(r, ['\n', '\n', '\n', '\r\n', '\r']);
  return {
    seed,
    mix,
    count,
    text: lines.join(eol),
    exitCode: pick(r, [undefined, undefined, 0, 1, 137]),
    isDump: r() < 0.15,
    enumerate: r() < 0.15,
    relevance: r() < 0.2 ? ['worker-1'] : [],
  };
}

const BASE_SEED = 0x48555348; // "HUSH"
const CASES = 400;

// ---------------------------------------------------------------------------
// The delivery harness
// ---------------------------------------------------------------------------

/**
 * Runs deliver() and returns what actually reached the model — the rewrite it
 * shipped, or undefined when it dropped one and let the original stand. stdout
 * is captured in-process rather than spawned so a few hundred cases stay cheap;
 * the e2e cases below spawn the real hook on the same shapes, which is what
 * pins that main() really routes everything through this one function.
 */
function shipped(decision, updated, data) {
  const chunks = [];
  const real = process.stdout.write;
  process.stdout.write = (s) => {
    chunks.push(s);
    return true;
  };
  try {
    deliver(decision, updated, data);
  } finally {
    process.stdout.write = real;
  }
  if (!chunks.length) return undefined;
  return JSON.parse(chunks.join('')).hookSpecificOutput.updatedToolOutput;
}

/** main()'s Bash-string branch, in the order main() runs it. */
function deliverShellString(c) {
  const decision = { bytesIn: c.text.length };
  const out = compress(c.text, c.exitCode, c.isDump, c.enumerate, c.relevance, 1, null, true, false, decision);
  decision.bytesOut = out.length;
  if (!decision.recovery) decision.recovery = 'rerun-command';
  const updated = out !== c.text ? out : undefined;
  const data = { tool_name: 'Bash', tool_response: c.text };
  return { out, decision, updated, data, ship: shipped(decision, updated, data) };
}

const cleanOf = (text) => resolveCarriageReturns(stripAnsi(String(text)));
const keepLinesOf = (text) => cleanOf(text).split('\n').filter(isKeepLine);

// ---------------------------------------------------------------------------
// Properties of the transform itself
// ---------------------------------------------------------------------------

describe('property: compress() over generated output', () => {
  test('every warning, error, failure and traceback frame survives', () => {
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const d = {};
      const out = compress(c.text, c.exitCode, c.isDump, c.enumerate, c.relevance, 1, null, true, false, d);
      const outLines = new Set(out.split('\n'));
      for (const keep of keepLinesOf(c.text)) {
        assert.ok(
          outLines.has(keep),
          `seed ${c.seed} (${c.count} lines of ${c.mix.join('+')}, action ${d.action}): dropped keep line ${JSON.stringify(keep)}`
        );
      }
    }
  });

  test('no escape sequence and no bare carriage return reaches the view', () => {
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const out = compress(c.text, c.exitCode, c.isDump, c.enumerate, c.relevance, 1, null, true, false, {});
      assert.ok(!out.includes(ESC), `seed ${c.seed}: an ANSI escape survived`);
      assert.ok(!out.includes('\r'), `seed ${c.seed}: a carriage return survived`);
    }
  });

  test('the view never invents a content line, and the omitted count matches it', () => {
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const d = {};
      const out = compress(c.text, c.exitCode, c.isDump, c.enumerate, c.relevance, 1, null, true, false, d);
      const content = out.split('\n').filter((l) => !/^\[hush(?: hook)?: /.test(l));
      assert.ok(content.length <= d.linesIn, `seed ${c.seed}: ${content.length} content lines out of ${d.linesIn} in`);
      assert.strictEqual(d.omitted, Math.max(0, d.linesIn - content.length), `seed ${c.seed}: the omitted count disagrees with the view`);
    }
  });

  test('the same input compresses to the same bytes every time', () => {
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const once = compress(c.text, c.exitCode, c.isDump, c.enumerate, c.relevance, 1, null, true, false, {});
      const twice = compress(c.text, c.exitCode, c.isDump, c.enumerate, c.relevance, 1, null, true, false, {});
      assert.strictEqual(once, twice, `seed ${c.seed}: compress is not deterministic`);
      // ...and so is the generator, or none of the seeds above mean anything.
      assert.strictEqual(generate(c.seed).text, c.text, `seed ${c.seed}: the generator is not deterministic`);
    }
  });
});

// ---------------------------------------------------------------------------
// Properties of what deliver() ships
// ---------------------------------------------------------------------------

describe('property: the product invariants hold on what is actually shipped', () => {
  test('invariant 3: a shipped rewrite is always smaller than what it replaced', () => {
    let rejected = 0;
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const { out, ship } = deliverShellString(c);
      if (ship === undefined) {
        if (out !== c.text) rejected++;
        continue;
      }
      assert.ok(
        ship.length < c.text.length,
        `seed ${c.seed} (${c.count} lines of ${c.mix.join('+')}): shipped ${ship.length} bytes against ${c.text.length} in`
      );
    }
    // Anti-vacuity: the generated space has to contain rewrites the guard must
    // actually reject, or the assertion above proves nothing about the guard.
    assert.ok(rejected > 0, 'no generated case was ever rejected — this corpus does not exercise the guard');
  });

  test('invariant 1: a shipped lossy rewrite always names where the rest is', () => {
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const { decision, ship } = deliverShellString(c);
      if (ship === undefined) continue;
      const record = buildRecord({ ...decision, tool: 'Bash' });
      assert.strictEqual(recoveryGap(record), null, `seed ${c.seed}: shipped a ${record.action} with no recovery location`);
    }
  });

  test('a shipped rewrite never loses a keep line on its way through the boundary', () => {
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const { ship } = deliverShellString(c);
      if (ship === undefined) continue;
      const shipLines = new Set(ship.split('\n'));
      for (const keep of keepLinesOf(c.text)) {
        assert.ok(shipLines.has(keep), `seed ${c.seed}: the shipped view lost ${JSON.stringify(keep)}`);
      }
    }
  });

  test('every dropped rewrite was dropped for a reason the boundary can name', () => {
    const reasons = new Set();
    for (let n = 0; n < CASES; n++) {
      const c = generate(BASE_SEED + n);
      const { out, decision, ship } = deliverShellString(c);
      if (ship !== undefined || out === c.text) continue;
      const record = buildRecord({ ...decision, tool: 'Bash' });
      const size = sizeGap(record);
      const reason = recoveryGap(record) || fieldGap(c.text, out) || size;
      assert.ok(reason, `seed ${c.seed}: a rewrite was dropped for no stated reason`);
      reasons.add(reason === size ? 'not-smaller' : 'no-recovery');
    }
    assert.deepStrictEqual([...reasons].sort(), ['not-smaller']);
  });
});

// ---------------------------------------------------------------------------
// The delta renderer
// ---------------------------------------------------------------------------

describe('property: the delta renderer over generated shrink, grow and replace', () => {
  const GAP_RE = /^ {2}\.\.\. (\d+) unchanged lines \.\.\.$/;

  function deltaCase(seed) {
    const r = prng(seed);
    const prevLen = int(r, 1, 120);
    const prev = Array.from({ length: prevLen }, (_, i) => LINE_KINDS[pick(r, KINDS)](r, i));
    const shape = pick(r, ['shrink', 'grow', 'replace', 'truncate-all', 'identical']);
    let next = prev.slice();
    if (shape === 'shrink') next = prev.slice(0, int(r, 0, prevLen));
    else if (shape === 'grow')
      next = prev.concat(Array.from({ length: int(r, 1, 40) }, (_, i) => LINE_KINDS[pick(r, KINDS)](r, prevLen + i)));
    else if (shape === 'replace') {
      for (let h = 0, hits = int(r, 1, prevLen); h < hits; h++) {
        const at = int(r, 0, prevLen - 1);
        next[at] = LINE_KINDS[pick(r, KINDS)](r, at + 1000);
      }
    } else if (shape === 'truncate-all') next = [];
    return { seed, shape, prev, next };
  }

  test('the line accounting in a delta always adds back up to the whole file', () => {
    const shapes = new Set();
    for (let n = 0; n < CASES; n++) {
      const c = deltaCase(BASE_SEED + 7000 + n);
      shapes.add(c.shape);
      const changed = changedLineIndexes(c.prev, c.next);
      const d = {};
      const rendered = renderDelta(c.next, changed, c.prev.length, d);
      const gaps = rendered
        .split('\n')
        .map((l) => GAP_RE.exec(l))
        .filter(Boolean)
        .reduce((sum, m) => sum + Number(m[1]), 0);
      assert.strictEqual(d.linesIn, c.next.length, `seed ${c.seed} (${c.shape}): the delta miscounted the file`);
      assert.strictEqual(gaps, d.omitted, `seed ${c.seed} (${c.shape}): ${gaps} lines marked unchanged against ${d.omitted} omitted`);
    }
    assert.strictEqual(shapes.size, 5, 'the generated space missed a delta shape');
  });

  test('every changed line inside the new range is shown, and a deletion is stated as one', () => {
    for (let n = 0; n < CASES; n++) {
      const c = deltaCase(BASE_SEED + 9000 + n);
      const changed = changedLineIndexes(c.prev, c.next);
      const rendered = renderDelta(c.next, changed, c.prev.length, {});
      for (const i of changed.filter((i) => i < c.next.length)) {
        assert.ok(
          rendered.includes(`L${i + 1}: ${c.next[i]}`),
          `seed ${c.seed} (${c.shape}): changed line ${i + 1} is missing from the delta`
        );
      }
      if (c.prev.length > c.next.length) {
        assert.ok(
          rendered.includes(`${c.prev.length - c.next.length} lines were removed since the last read`),
          `seed ${c.seed} (${c.shape}): a shrunk file did not state its deletion`
        );
      }
    }
  });
});

// ---------------------------------------------------------------------------
// Binary and huge output
// ---------------------------------------------------------------------------

// razor: the huge-output ceiling. 4 MB in one line and 20,000 lines (~1.4 MB)
// are the largest shapes this suite pays for — together a fraction of a second,
// against a whole-suite budget measured in single-digit seconds. Every
// transform on the path is a linear pass (one regex replace, one split, one
// map, one join), so a bigger payload exercises the same code for
// proportionally more time and buys no new coverage. Raising these two
// constants is the whole upgrade path if a superlinear regression is ever
// suspected.
const HUGE_LINE_BYTES = 4 * 1024 * 1024;
const HUGE_PAYLOAD_LINES = 20000;

// The huge cases carry the hook's OWN registered budget as their runner
// timeout (hooks.json gives compress-tool-output 5 seconds). It is not an
// assertion about wall time — a superlinear regression on this path does not
// fail an assertion, it stops responding, and a hung suite reports nothing.
// The measured cost of these cases is a few milliseconds, so the margin is
// three orders of magnitude and cannot flake.
const HOOK_BUDGET_MS = 5000;

describe('binary and huge output', () => {
  const run = (text, exitCode, noSidecar = true, sessionId = null) => {
    const d = {};
    const out = compress(text, exitCode, false, false, [], 1, sessionId, noSidecar, false, d);
    return { out, d };
  };

  const BINARY = {
    'NUL bytes': 'head\u0000mid\u0000tail\nERROR: parse failed here\n' + 'pad\u0000pad\n'.repeat(200),
    'replacement characters from invalid UTF-8': '\ufffd\ufffd\ufffd binary blob\nERROR: not a text file\n' + '\ufffd\n'.repeat(200),
    'lone surrogates': '\ud800 unpaired high\n\udfff unpaired low\nERROR: encoding\n' + '\ud800\n'.repeat(200),
    'CRLF line endings': 'ERROR: build failed\r\n' + 'compiling module\r\n'.repeat(200),
    'CR-only line endings': 'progress\r'.repeat(200) + 'ERROR: build failed',
    'ANSI-heavy payload': `${ESC}[31m${ESC}[1mERROR: red and bold${ESC}[0m\n` + `${ESC}[2K${ESC}[0G${ESC}[32mok${ESC}[0m\n`.repeat(300),
    'OSC escape sequences': `${ESC}]0;window title\u0007ERROR: still an error\n` + `${ESC}]8;;https://x\u0007link${ESC}]8;;\u0007\n`.repeat(200),
    'no trailing newline': 'ERROR: abrupt end',
    'nothing but newlines': '\n'.repeat(500),
    'the empty string': '',
  };

  for (const [name, payload] of Object.entries(BINARY)) {
    test(`${name}: transforms cleanly and keeps its error lines`, () => {
      const { out, d } = run(payload, undefined);
      assert.ok(!out.includes(ESC), 'an escape sequence survived');
      assert.ok(!out.includes('\r'), 'a carriage return survived');
      const outLines = new Set(out.split('\n'));
      for (const keep of keepLinesOf(payload)) assert.ok(outLines.has(keep), `dropped ${JSON.stringify(keep)}`);
      assert.ok(typeof d.action === 'string' && d.action.length > 0, 'no action was recorded');
    });
  }

  test('a single multi-megabyte line is passed through, not exploded', { timeout: HOOK_BUDGET_MS }, () => {
    const line = 'z'.repeat(HUGE_LINE_BYTES);
    const { out, d } = run(line, undefined);
    assert.strictEqual(out, line);
    assert.strictEqual(d.linesIn, 1);
    assert.strictEqual(d.omitted, 0);
  });

  test('a multi-megabyte base64-shaped line is classified without backtracking', { timeout: HOOK_BUDGET_MS }, () => {
    // The keep-line vocabulary is asked this question once per line, so a
    // pattern that backtracks over a long run of word characters stalls the
    // whole hook on one minified bundle or one base64 blob.
    assert.strictEqual(isKeepLine('z'.repeat(HUGE_LINE_BYTES)), false);
    // ...and it still recognises the compound runtime names it is there for.
    for (const name of ['ReferenceError: x', 'TypeError: y', 'SyntaxError', 'DeprecationWarning: old']) {
      assert.ok(isKeepLine(name), `${name} stopped counting as signal`);
    }
  });

  test('a bounded huge payload is capped, and every error in it still lands', { timeout: HOOK_BUDGET_MS }, () => {
    const lines = Array.from({ length: HUGE_PAYLOAD_LINES }, (_, i) =>
      i % 5000 === 0 ? `ERROR: worker ${i} died` : `2026-07-28 worker ${i % 9} handled request ${i} in ${i % 400}ms`
    );
    const text = lines.join('\n');
    const { out, d } = run(text, 1);
    assert.ok(out.length < text.length, 'the huge payload was not compressed');
    assert.strictEqual(d.linesIn, HUGE_PAYLOAD_LINES);
    const outLines = new Set(out.split('\n'));
    for (const keep of lines.filter(isKeepLine)) assert.ok(outLines.has(keep), `dropped ${JSON.stringify(keep)}`);
  });

  test('a megabyte with no line structure never becomes a digest bigger than itself', { timeout: HOOK_BUDGET_MS }, () => {
    // One giant minified line gives the digest's head/tail trim nothing to cut,
    // so reproducing it under a header would be larger than the source. The
    // sidecar bails before touching disk, and nothing larger is ever shipped.
    const text = 'a'.repeat(HUGE_LINE_BYTES / 4) + '\nERROR: boom';
    const decision = { bytesIn: text.length };
    const out = compress(text, 1, false, false, [], 1, SIDECAR_SESSION, false, false, decision);
    assert.notStrictEqual(decision.action, 'sidecar', 'a structureless payload was parked as a digest');
    decision.bytesOut = out.length;
    decision.recovery = decision.recovery || 'rerun-command';
    const ship = shipped(decision, out !== text ? out : undefined, { tool_name: 'Bash', tool_response: text });
    if (ship !== undefined) assert.ok(ship.length < text.length, 'a larger view was shipped');
  });
});

// ---------------------------------------------------------------------------
// The boundary itself, exercised directly
// ---------------------------------------------------------------------------

describe('deliver(): one boundary, one fallback', () => {
  const stringResponse = { tool_name: 'Bash', tool_response: 'x'.repeat(100) };
  const lossy = (over) => ({ action: 'cap', bytesIn: 100, bytesOut: 40, linesIn: 10, omitted: 2, recovery: 'rerun-command', ...over });

  test('a rewrite that is not smaller is dropped and the original stands', () => {
    assert.strictEqual(shipped(lossy({ bytesOut: 120 }), 'y'.repeat(120), stringResponse), undefined);
  });

  test('a rewrite exactly the same size is dropped too — it buys nothing back', () => {
    assert.strictEqual(shipped(lossy({ bytesOut: 100 }), 'y'.repeat(100), stringResponse), undefined);
  });

  test('a smaller rewrite that names its recovery is shipped', () => {
    assert.strictEqual(shipped(lossy(), 'y'.repeat(40), stringResponse), 'y'.repeat(40));
  });

  test('a lossy rewrite with no recovery location is dropped', () => {
    assert.strictEqual(shipped(lossy({ recovery: null }), 'y'.repeat(40), stringResponse), undefined);
  });

  test('a structured rewrite that drops a field is dropped, however much smaller it is', () => {
    const response = { stdout: 'a'.repeat(500), stderr: 'boom', exitCode: 1 };
    const data = { tool_name: 'Bash', tool_response: response };
    const whole = { stdout: 'a', stderr: 'boom', exitCode: 1 };
    const { exitCode, ...missingField } = whole; // eslint-disable-line no-unused-vars
    assert.deepStrictEqual(shipped(lossy({ bytesIn: 504, bytesOut: 5 }), whole, data), whole);
    assert.strictEqual(shipped(lossy({ bytesIn: 504, bytesOut: 5 }), missingField, data), undefined);
  });

  // The response side decides whether there were fields to lose: a string or
  // array response never had any. The rewrite side is judged either way —
  // replacing an object with a non-object loses every field there was.
  // Deliberately shallow: top-level keys only, no nested walk.
  test('fieldGap judges any rewrite of an object response, and nothing else', () => {
    assert.strictEqual(fieldGap('abc', 'ab'), null);
    assert.strictEqual(fieldGap([{ a: 1 }], [{ b: 2 }]), null);
    assert.match(fieldGap({ a: 1, b: 2 }, { a: 1 }), /dropped 1 field/);
    assert.match(fieldGap({ a: 1, b: 2 }, 'gone'), /losing every field: a, b/);
    assert.match(fieldGap({ a: 1, b: 2 }, ['a', 'b']), /replaced a 2-field response with an? array/);
    assert.match(fieldGap({ a: 1 }, null), /with a null/);
    assert.strictEqual(fieldGap({ a: { deep: 1 } }, { a: {} }), null, 'nested keys stay out of scope');
  });

  test('an object response rewritten to a string is dropped, not delivered', () => {
    const response = { stdout: 'a'.repeat(500), stderr: 'boom', exitCode: 1 };
    const data = { tool_name: 'Bash', tool_response: response };
    assert.strictEqual(shipped(lossy({ bytesIn: 504, bytesOut: 5 }), 'a...', data), undefined);
  });

  test('the exit-code wrapper is stripped even when stripping it costs bytes', () => {
    // Sanitation is not a compression bargain: shipping the original here would
    // put hush's own `[[hush:exit=N]]` protocol text in front of the model.
    const raw = '\n'.repeat(100) + '\n[[hush:exit=137]]';
    const view = '\n'.repeat(100) + '\n[hush: exit 137 (SIGKILL)]' + 'x'.repeat(200);
    const ship = shipped(lossy({ bytesIn: raw.length, bytesOut: view.length, omitted: 41 }), view, {
      tool_name: 'Bash',
      tool_response: raw,
    });
    assert.ok(ship !== undefined, 'the sanitizing rewrite was dropped, so the raw wrapper would reach the model');
    assert.ok(!ship.includes('[[hush:exit='), 'the wrapper marker survived into the view');
  });

  test('a response whose fields are all kept passes the field check', () => {
    const response = { stdout: 'a'.repeat(300), stderr: '', output: '', exitCode: 0 };
    const rewrite = { ...response, stdout: 'a' };
    assert.deepStrictEqual(shipped(lossy({ bytesIn: 300, bytesOut: 1 }), rewrite, { tool_name: 'Bash', tool_response: response }), rewrite);
  });
});

// ---------------------------------------------------------------------------
// End to end: the real hook, on the shapes the properties found
// ---------------------------------------------------------------------------

describe('e2e: main() routes every path through the same boundary', () => {
  function runHookIn(name, tempDir, stdinData, env) {
    return spawnSync('node', [path.join(HOOKS_DIR, name)], {
      input: JSON.stringify(stdinData),
      encoding: 'utf-8',
      timeout: 30000,
      env: { ...process.env, HUSH_DEBUG: '1', HUSH_DISABLE: '0', ...(env || {}), TEMP: tempDir, TMP: tempDir, TMPDIR: tempDir },
    });
  }

  function temp(tag) {
    const dir = path.join(SCRATCH, `e2e-${tag}`);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
  }

  function records(dir) {
    const file = fs.readdirSync(dir).find((f) => /^hush-debug-.*\.jsonl$/.test(f));
    if (!file) return [];
    return fs.readFileSync(path.join(dir, file), 'utf-8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  test('a fold that costs more than it saves ships the original and records why', () => {
    const dir = temp('grow');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: 'growcase',
      tool_input: { command: 'node build.js' },
      tool_response: 'a\na\na\na\na\na\na\na',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', `a larger rewrite was shipped: ${r.stdout}`);
    const rec = records(dir);
    assert.strictEqual(rec.length, 1);
    assert.strictEqual(rec[0].action, 'rejected-not-smaller');
    assert.strictEqual(rec[0].bytesOut, rec[0].bytesIn);
    assert.match(rec[0].fallback, /bytes against/);
    // The original ships whole, so the record may not claim lines were left out.
    assert.strictEqual(rec[0].omitted, 0, 'a rejected rewrite still reported omission');
    assert.strictEqual(rec[0].preserved, rec[0].linesIn);
    assert.strictEqual(rec[0].retention, 'none');
  });

  // The size exemption belongs to output a marker will actually be stripped
  // FROM. A bare `[[hush:exit=` with no closing `]]` strips to nothing — the
  // host truncates raw output around 29KB and can cut a real marker mid-text,
  // and hush's own source or docs dumped to stdout carry the literal prefix.
  test('a bare exit-marker prefix earns no size exemption — the same payload without it is refused', () => {
    const dir = temp('bareprefix');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: 'bareprefix',
      tool_input: { command: 'node build.js' },
      tool_response: 'a\na\na\na\na\na\na\na\n[[hush:exit=',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', `a growing rewrite shipped, raw prefix and all: ${r.stdout}`);
    const rec = records(dir);
    assert.strictEqual(rec[0].action, 'rejected-not-smaller');
    assert.strictEqual(rec[0].bytesOut, rec[0].bytesIn);
  });

  test('a bare exit-marker prefix in one field earns no exemption for growth in another', () => {
    const dir = temp('bareprefix-obj');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: 'bareprefixobj',
      tool_input: { command: 'node build.js' },
      tool_response: { stdout: 'a\na\na\na\na\na\na\na', stderr: '[[hush:exit=', exitCode: 0 },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', `a growing rewrite shipped, raw prefix and all: ${r.stdout}`);
    assert.strictEqual(records(dir)[0].action, 'rejected-not-smaller');
  });

  test('a complete marker still buys the exemption — stripping it is not a bargain', () => {
    const dir = temp('realmarker');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: 'realmarker',
      tool_input: { command: 'node build.js' },
      tool_response: 'a\na\na\na\na\na\na\na\n[[hush:exit=0]]',
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.notStrictEqual(r.stdout, '', 'the sanitizing rewrite was dropped, so the raw wrapper reaches the model');
    assert.ok(!r.stdout.includes('[[hush:exit='), 'the wrapper marker survived into the view');
  });

  test('a genuinely smaller rewrite still ships, with its recovery named', () => {
    const dir = temp('shrink');
    const payload = Array.from({ length: 400 }, (_, i) => `2026-07-28 worker ${i % 9} handled request ${i} ok`).join('\n');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: 'shrinkcase',
      tool_input: { command: 'node build.js' },
      tool_response: payload,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    const updated = JSON.parse(r.stdout).hookSpecificOutput.updatedToolOutput;
    assert.ok(updated.length < payload.length);
    const rec = records(dir);
    assert.strictEqual(rec.length, 1);
    assert.ok(rec[0].bytesOut < rec[0].bytesIn);
    assert.ok(rec[0].recovery, 'a lossy delivery named no recovery');
  });

  test('a failing run whose every line is kept ships whole rather than growing a footer', () => {
    const dir = temp('failkeep');
    const payload = Array.from({ length: 300 }, (_, i) => `ERROR ${i}: connection refused`).join('\n');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Bash',
      session_id: 'failkeep',
      tool_input: { command: 'node build.js' },
      tool_response: payload,
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'a view that elided nothing and grew a footer was shipped');
    assert.strictEqual(records(dir)[0].action, 'rejected-not-smaller');
  });

  test('a range read comes back verbatim, however adversarial the slice', () => {
    const dir = temp('range');
    const content = `${ESC}[31mERROR: kept\u0000raw${ESC}[0m\r\n` + 'a\na\na\na\na\n'.repeat(40);
    const file = path.join(dir, 'app.log');
    const r = runHookIn('compress-tool-output.js', dir, {
      hook_event_name: 'PostToolUse',
      tool_name: 'Read',
      session_id: 'rangecase',
      tool_input: { file_path: file, offset: 1, limit: 200 },
      tool_response: { file: { filePath: file, content } },
    });
    assert.strictEqual(r.status, 0, r.stderr);
    assert.strictEqual(r.stdout, '', 'a range read was rewritten');
    assert.strictEqual(records(dir)[0].action, 'passthrough');
  });
});

// ---------------------------------------------------------------------------
// Narrow edges: current behavior, pinned so a change to it has to be deliberate
// ---------------------------------------------------------------------------

describe('pinned: narrow edges of the current transforms', () => {
  test('an all-kept failing run still reaches deliver() with a rerun footer and nothing omitted', () => {
    const d = {};
    const text = Array.from({ length: 300 }, (_, i) => `ERROR ${i}: connection refused`).join('\n');
    const out = compress(text, 1, false, false, [], 1, null, true, false, d);
    assert.strictEqual(d.omitted, 0, 'nothing was elided');
    assert.ok(out.includes(FAILURE_RERUN_NOTE), 'the footer rides on a view that cut nothing');
    // Which is exactly why deliver() drops it: here the footer is pure growth.
    assert.ok(out.length > text.length);
  });

  test('identical failure lines are never folded into a repeat count', () => {
    const text = Array.from({ length: 8 }, () => 'ERROR: connection refused').join('\n');
    const out = compress(text, 1, false, false, [], 1, null, true, false, {});
    assert.strictEqual(out.split('\n').filter((l) => l === 'ERROR: connection refused').length, 8);
    assert.ok(!out.includes('previous line repeated'));
  });

  test("a traceback keeps its header, frame and exception; the frame's source echo is not a keep line", () => {
    assert.deepStrictEqual(
      [
        'Traceback (most recent call last):',
        '  File "/srv/app/run.py", line 12, in main',
        '    do_the_thing(payload)',
        'ValueError: bad input',
      ].map(isKeepLine),
      [true, true, false, true]
    );
  });

  test('"errored" is not failure vocabulary', () => {
    assert.strictEqual(looksLikeFailure('the build errored out'), false);
    assert.strictEqual(looksLikeFailure('the build failed'), true);
    assert.strictEqual(looksLikeFailure('an error occurred'), true);
  });

  test('a grep rewrite rejected for size leaves the copy it already wrote on disk', () => {
    // Many files, four short matches each: three shown, one omitted, and the
    // per-file summary line costs more than the one line it stands for.
    const content = Array.from({ length: 480 }, (_, i) => {
      const f = `src/very/deeply/nested/module/area/file_${Math.floor(i / 4)}.js`;
      return `${f}:${i}:x`;
    }).join('\n');
    const d = {};
    const out = compressGrep(content, [], 'src', d, SIDECAR_SESSION);
    assert.strictEqual(out, content, 'the rewrite was not rejected — pick a shape whose summary really is bigger');
    assert.strictEqual(d.recovery, undefined, 'a rejected rewrite records no recovery location');
    const parked = fs.readdirSync(sidecarStore.sessionDir(SIDECAR_SESSION));
    assert.strictEqual(parked.length, 1, 'the copy written before the size check is left behind');
  });

  test('a session id shaped like a path traversal writes outside the directory it was given', () => {
    const home = path.join(SCRATCH, 'note-home');
    fs.mkdirSync(home, { recursive: true });
    const sessionId = '../../../escaped';
    const notePath = path.join(home, `hush-note-${sessionId}`);
    assert.ok(path.relative(home, notePath).startsWith('..'), 'the id has to resolve outside for this pin to mean anything');

    assert.strictEqual(claimSessionNote(sessionId, home), true);

    // Pinned as it is: the id goes into the file name raw, so the sentinel
    // lands wherever the traversal points. Bounded — the file is empty and
    // still `hush-note-`-shaped — and here it stays inside the scratch tree.
    assert.strictEqual(fs.readFileSync(notePath, 'utf-8'), '');
    assert.ok(path.resolve(notePath).startsWith(path.resolve(SCRATCH)), 'the pin must not write outside its own scratch tree');
  });
});
