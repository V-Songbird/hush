'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHook, hookOutput } = require('./helpers');

// Sidecar mode defaults ON in the hook; these tests exercise the inline-cap
// semantics, so pin it off for the whole file (child hooks inherit it via
// runHook's env spread). The sidecar suite below re-enables it explicitly.
process.env.HUSH_SIDECAR = 'off';
const {
  stripAnsi,
  resolveCarriageReturns,
  dedupeConsecutive,
  collapseTemplates,
  capLines,
  looksLikeFailure,
  isFileDump,
  isLogPath,
  requestsEnumeration,
  compress,
  firstLine,
  extractWrappedExit,
  signalCensus,
} = require('../hooks/compress-tool-output');

describe('unit: transforms', () => {
  test('stripAnsi removes color and cursor codes', () => {
    assert.strictEqual(stripAnsi('\x1b[32mPASS\x1b[0m tests'), 'PASS tests');
  });

  test('resolveCarriageReturns keeps only the final redraw of a line', () => {
    assert.strictEqual(resolveCarriageReturns('10%\r50%\r100% done\nnext'), '100% done\nnext');
  });

  test('resolveCarriageReturns treats CRLF as an ordinary line ending, not a redraw', () => {
    assert.strictEqual(
      resolveCarriageReturns('one\r\ntwo\r\nthree\r\n'),
      'one\ntwo\nthree\n'
    );
  });

  test('resolveCarriageReturns still resolves a bare mid-line redraw after CRLF lines', () => {
    assert.strictEqual(
      resolveCarriageReturns('done: one\r\n10%\r50%\r100%\r\n'),
      'done: one\n100%\n'
    );
  });

  test('dedupeConsecutive collapses repeats with a count marker', () => {
    const out = dedupeConsecutive(['warn: x', 'warn: x', 'warn: x', 'end']);
    assert.deepStrictEqual(out, ['warn: x', '[hush: previous line repeated 2x]', 'end']);
  });

  test('dedupeConsecutive leaves blank lines alone', () => {
    assert.deepStrictEqual(dedupeConsecutive(['', '', 'a']), ['', '', 'a']);
  });

  test('capLines keeps head and tail with an omitted marker', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const out = capLines(lines, 10);
    assert.strictEqual(out.length, 11);
    assert.strictEqual(out[0], 'line 0');
    assert.strictEqual(out[6], '[hush hook: 90 lines omitted from this view, none with warnings/errors/failures]');
    assert.strictEqual(out[10], 'line 99');
  });

  test('omitted markers assert no signal was cut — so the model trusts the visible slice', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    lines[50] = 'WARN W1042 deprecated-api in src/legacy/adapter.js';
    const out = capLines(lines, 10).join('\n');
    // every omission marker carries the no-signal guarantee...
    for (const m of out.match(/\[hush hook: \d+ lines omitted[^\]]*\]/g)) {
      assert.match(m, /none with warnings\/errors\/failures/);
    }
    // ...and the guarantee holds: the surviving warning proves signal is kept,
    // so nothing matching the signal pattern was ever hidden behind a marker.
    assert.ok(out.includes(lines[50]));
  });

  test('capLines is a no-op under the cap', () => {
    assert.deepStrictEqual(capLines(['a', 'b'], 10), ['a', 'b']);
  });

  test('capLines keeps a signal line outside the head/tail window', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    lines[50] = 'WARN W1042 deprecated-api in src/legacy/adapter.js';
    const out = capLines(lines, 10);
    assert.ok(out.includes(lines[50]), 'signal line should survive the cap');
  });

  test('capLines with no signal lines behaves exactly as a plain head+tail cap', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    const out = capLines(lines, 10);
    assert.strictEqual(out.length, 11);
    assert.strictEqual(out[0], 'line 0');
    assert.strictEqual(out[6], '[hush hook: 90 lines omitted from this view, none with warnings/errors/failures]');
    assert.strictEqual(out[10], 'line 99');
  });

  test('exit code wins over text sniffing', () => {
    assert.strictEqual(looksLikeFailure('Error everywhere', 0), false);
    assert.strictEqual(looksLikeFailure('all good', 1), true);
  });

  test('failure sniff catches common markers, skips clean output', () => {
    assert.strictEqual(looksLikeFailure('Traceback (most recent call last):'), true);
    assert.strictEqual(looksLikeFailure('✗ should retry'), true);
    assert.strictEqual(looksLikeFailure('111 tests passed'), false);
  });

  test('compress caps failing output more generously than passing output', () => {
    // Template collapse is orthogonal to this cap-size comparison — every line
    // here happens to share one template, so pin it off to isolate capLines.
    const prev = process.env.HUSH_TEMPLATE;
    process.env.HUSH_TEMPLATE = 'off';
    try {
      const big = Array.from({ length: 1000 }, (_, i) => `unique line ${i}`).join('\n');
      const pass = compress(big, 0).split('\n').length;
      const fail = compress(big, 1).split('\n').length;
      assert.ok(pass < fail, `pass cap ${pass} should be tighter than fail cap ${fail}`);
      assert.ok(pass <= 61);
    } finally {
      if (prev === undefined) delete process.env.HUSH_TEMPLATE; else process.env.HUSH_TEMPLATE = prev;
    }
  });

  test('isFileDump recognizes plain file-print commands', () => {
    assert.ok(isFileDump('cat src/Foo.kt'));
    assert.ok(isFileDump('  cat "src/My File.kt"  '));
    assert.ok(isFileDump('type C:\\src\\Foo.kt'));
    assert.ok(isFileDump('Get-Content ./Foo.ps1'));
    assert.ok(isFileDump('gc ./Foo.ps1'));
  });

  test('isFileDump rejects piped, chained, redirected, or non-dump commands', () => {
    assert.strictEqual(isFileDump('cat src/Foo.kt | grep bar'), false);
    assert.strictEqual(isFileDump('cat src/Foo.kt && rm src/Foo.kt'), false);
    assert.strictEqual(isFileDump('cat src/Foo.kt > out.txt'), false);
    assert.strictEqual(isFileDump('npm test'), false);
    assert.strictEqual(isFileDump(undefined), false);
  });

  test('compress treats a file-dump command like a failure — keeps more of the middle', () => {
    const big = Array.from({ length: 200 }, (_, i) => `line ${i}`).join('\n');
    const asLog = compress(big, 0, false).split('\n').length;
    const asDump = compress(big, 0, true).split('\n').length;
    assert.ok(asDump > asLog, `dump cap ${asDump} should be looser than log cap ${asLog}`);
  });

  test('requestsEnumeration fires on quantifier + countable noun', () => {
    assert.ok(requestsEnumeration('report every warning the build emits: each warning code and file'));
    assert.ok(requestsEnumeration('list all files in src'));
    assert.ok(requestsEnumeration('enumerate the errors'));
    assert.ok(requestsEnumeration('show me each error code'));
    assert.ok(requestsEnumeration('give me the complete list of deprecations'));
  });

  test('requestsEnumeration stays quiet on ordinary prose and non-enumerate tasks', () => {
    // No carve-out for the other benchmark prompts — compression stays on.
    assert.strictEqual(requestsEnumeration('Explore this repository and give me an architectural overview'), false);
    assert.strictEqual(requestsEnumeration('Investigate logs/app.log and tell me the root cause of the outage'), false);
    assert.strictEqual(requestsEnumeration('Update the whole repo accordingly and verify with node --test'), false);
    assert.strictEqual(requestsEnumeration('give me a full overview'), false); // quantifier, no countable noun
    assert.strictEqual(requestsEnumeration(''), false);
    assert.strictEqual(requestsEnumeration(undefined), false);
  });

  test('enumerate=true passes far more of a big passing log than the normal cap', () => {
    const big = Array.from({ length: 900 }, (_, i) => `[${i}] compile mod_${i} ... ok`).join('\n');
    const capped = compress(big, 0, false, false).split('\n').length;
    const carved = compress(big, 0, false, true).split('\n').length;
    assert.ok(capped <= 61, `normal pass cap should hold (${capped})`);
    assert.ok(carved > capped * 5, `enumerate should keep far more (${carved} vs ${capped})`);
  });

  test('enumerate=true leaves no omission markers when the log fits the enumerate cap', () => {
    const lines = Array.from({ length: 900 }, (_, i) => `[${i}] compile mod_${i} ... ok`);
    lines[41] = 'WARN W1042 deprecated-api used in src/legacy/adapter.js';
    const carved = compress(lines.join('\n'), 0, false, true);
    assert.doesNotMatch(carved, /lines omitted/, 'nothing should be elided under the enumerate cap');
    assert.ok(carved.includes(lines[41]), 'the warning survives');
  });

  test('firstLine returns the whole string when there is no newline', () => {
    assert.strictEqual(firstLine('node build.js'), 'node build.js');
  });

  test('firstLine strips everything after the first newline (survives preserve-exit-code.js wrapping)', () => {
    const wrapped = 'cat src/Foo.kt\n__hush_exit=$?\necho "[[hush:exit=$__hush_exit]]"\nexit 0';
    assert.strictEqual(firstLine(wrapped), 'cat src/Foo.kt');
  });

  test('firstLine passes through non-strings unchanged', () => {
    assert.strictEqual(firstLine(undefined), undefined);
  });

  test('isFileDump still recognizes a wrapped file-dump command via firstLine', () => {
    const wrapped = 'cat src/Foo.kt\n__hush_exit=$?\necho "[[hush:exit=$__hush_exit]]"\nexit 0';
    assert.ok(isFileDump(firstLine(wrapped)));
  });
});

describe('unit: collapseTemplates', () => {
  test('a run of same-shape lines (varying ids) collapses to the first line + a count marker', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `INFO worker-${i} processing job ${8000 + i}`);
    const out = collapseTemplates(lines);
    assert.deepStrictEqual(out, [
      'INFO worker-0 processing job 8000',
      '[hush hook: 7 similar lines collapsed (same shape, varying values)]',
    ]);
  });

  test('two different error lines with a similar shape never merge — signal lines are exempt', () => {
    const lines = [
      'ERROR redis connection to db1 failed',
      'ERROR redis connection to db2 failed',
      'ERROR redis connection to db3 failed',
      'ERROR redis connection to db4 failed',
      'ERROR redis connection to db5 failed',
      'ERROR redis connection to db6 failed',
    ];
    assert.deepStrictEqual(collapseTemplates(lines), lines);
  });

  test('a signal line breaks an in-progress run instead of joining it', () => {
    const lines = [
      ...Array.from({ length: 5 }, (_, i) => `INFO worker-${i} processing job ${i}`),
      'ERROR worker-9 processing job 9999 failed',
      ...Array.from({ length: 5 }, (_, i) => `INFO worker-${i + 10} processing job ${i + 10}`),
    ];
    const out = collapseTemplates(lines);
    assert.deepStrictEqual(out, [
      'INFO worker-0 processing job 0',
      '[hush hook: 4 similar lines collapsed (same shape, varying values)]',
      'ERROR worker-9 processing job 9999 failed',
      'INFO worker-10 processing job 10',
      '[hush hook: 4 similar lines collapsed (same shape, varying values)]',
    ]);
  });

  test('an interleaved non-matching line breaks a run into pieces below the minimum', () => {
    const lines = [
      'INFO worker-0 processing job 0',
      'INFO worker-1 processing job 1',
      'totally unrelated one-off line',
      'INFO worker-2 processing job 2',
      'INFO worker-3 processing job 3',
    ];
    assert.deepStrictEqual(collapseTemplates(lines), lines);
  });

  test('a run of 4 (below TEMPLATE_MIN_RUN=5) is left untouched', () => {
    const lines = Array.from({ length: 4 }, (_, i) => `INFO worker-${i} processing job ${i}`);
    assert.deepStrictEqual(collapseTemplates(lines), lines);
  });

  test('collapse is idempotent', () => {
    const lines = Array.from({ length: 8 }, (_, i) => `INFO worker-${i} processing job ${8000 + i}`);
    const once = collapseTemplates(lines);
    assert.deepStrictEqual(collapseTemplates(once), once);
  });

  test('marker text matches the exact provenance format', () => {
    const lines = Array.from({ length: 6 }, (_, i) => `INFO worker-${i} processing job ${i}`);
    const out = collapseTemplates(lines);
    assert.strictEqual(out[1], '[hush hook: 5 similar lines collapsed (same shape, varying values)]');
  });

  test('HUSH_TEMPLATE=off passes lines through untouched', () => {
    const prev = process.env.HUSH_TEMPLATE;
    process.env.HUSH_TEMPLATE = 'off';
    try {
      const lines = Array.from({ length: 8 }, (_, i) => `INFO worker-${i} processing job ${8000 + i}`);
      assert.deepStrictEqual(collapseTemplates(lines), lines);
    } finally {
      if (prev === undefined) delete process.env.HUSH_TEMPLATE; else process.env.HUSH_TEMPLATE = prev;
    }
  });
});

describe('unit: extractWrappedExit', () => {
  test('extracts the exit code and strips the marker from the end', () => {
    const text = 'line one\nline two\n[[hush:exit=1]]';
    const r = extractWrappedExit(text);
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.cleanText, 'line one\nline two');
  });

  test('extracts a zero exit code correctly (falsy but valid)', () => {
    const r = extractWrappedExit('all good\n[[hush:exit=0]]');
    assert.strictEqual(r.exitCode, 0);
    assert.strictEqual(r.cleanText, 'all good');
  });

  test('returns null when no marker is present', () => {
    assert.strictEqual(extractWrappedExit('plain output, no marker'), null);
  });

  // A malformed marker (PowerShell only sets $LASTEXITCODE for a native exe;
  // a pure-cmdlet command leaves it null/stale) must still be stripped from
  // what the model sees — real bug found via the sonnet-showcase-v2 loop run:
  // 4 of 18 live runs leaked a raw `[[hush:exit=` marker verbatim because the
  // old code treated "no digits captured" as "nothing to do here."
  test('strips a malformed/empty marker even though no reliable exit code exists', () => {
    const r = extractWrappedExit('output\n[[hush:exit=]]');
    assert.strictEqual(r.exitCode, null);
    assert.strictEqual(r.cleanText, 'output');
  });

  test('strips EVERY marker occurrence, using the last well-formed one as authoritative', () => {
    const text = 'saw a stray [[hush:exit=99]] in some log line\nreal output\n[[hush:exit=1]]';
    const r = extractWrappedExit(text);
    assert.strictEqual(r.exitCode, 1);
    assert.doesNotMatch(r.cleanText, /\[\[hush:exit=/, 'no raw marker of any kind should ever reach the model');
    assert.strictEqual(r.cleanText, 'saw a stray  in some log line\nreal output');
  });

  // Confirmed real scenario (sonnet-showcase-v2, dep-bump-warnings/hush):
  // Claude Code's own "output too large, persisted to a sidecar file"
  // mechanism captured RAW pre-hook output including an already-well-formed
  // marker; a later `Get-Content -Tail` on that file got wrapped AGAIN by
  // this hook, and since that second wrap was a pure cmdlet call (no native
  // exe), it appended a malformed marker on top of the first, well-formed one.
  test('a double-wrapped result (well-formed marker + malformed marker) keeps the well-formed exit code and strips both', () => {
    const text = 'line one\nline two\n[[hush:exit=1]]\n[[hush:exit=\n]]';
    const r = extractWrappedExit(text);
    assert.strictEqual(r.exitCode, 1);
    assert.doesNotMatch(r.cleanText, /\[\[hush:exit=/);
  });

  test('handles non-string input', () => {
    assert.strictEqual(extractWrappedExit(undefined), null);
  });

  // Real shape produced by preserve-exit-code.js's wrapPowerShell: the
  // prefix, the number, and the suffix are three separate output lines
  // (never one contiguous string — see that file's header for why), and
  // Windows PowerShell uses CRLF. Confirmed against a live session's actual
  // tool_result content.
  test('parses the real multi-line CRLF shape PowerShell actually produces', () => {
    const text = 'about to fail\r\n[[hush:exit=\r\n1\r\n]]';
    const r = extractWrappedExit(text);
    assert.strictEqual(r.exitCode, 1);
    assert.strictEqual(r.cleanText, 'about to fail');
  });
});

describe('unit: isLogPath', () => {
  test('matches .log files and rotated logs anywhere', () => {
    assert.ok(isLogPath('C:\\repo\\logs\\app.log'));
    assert.ok(isLogPath('/var/log/syslog.log.1'));
    assert.ok(isLogPath('X:/tmp/build.log'));
  });

  test('matches .txt/.out only under a log/logs directory', () => {
    assert.ok(isLogPath('/srv/logs/output.txt'));
    assert.ok(isLogPath('C:\\app\\log\\run.out'));
    assert.ok(!isLogPath('/repo/README.txt'));
    assert.ok(!isLogPath('C:\\repo\\notes\\output.txt'));
  });

  test('never matches source code', () => {
    assert.ok(!isLogPath('/repo/src/logger.js'));
    assert.ok(!isLogPath('C:\\repo\\src\\services\\pricing.js'));
    assert.ok(!isLogPath('/repo/docs/logging.md'));
  });
});

describe('hook: end to end', () => {
  test('unwatched tool stays silent', () => {
    const r = runHook('compress-tool-output.js', { tool_name: 'Glob', tool_response: 'x\n'.repeat(500) });
    assert.strictEqual(hookOutput(r), null);
  });

  test('Read of a source file stays untouched, whatever its size', () => {
    const big = Array.from({ length: 900 }, (_, i) => `const x${i} = ${i};`).join('\n');
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: 'C:\\repo\\src\\services\\pricing.js' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\src\\services\\pricing.js', content: big, numLines: 900, startLine: 1, totalLines: 900 } },
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('Read of a big .log file gets compressed, signal lines survive, shape preserved', () => {
    const lines = Array.from({ length: 900 }, (_, i) => `10:0${i % 10} info request handled in ${i}ms`);
    lines[500] = '10:05 ERROR redis ECONNREFUSED 127.0.0.1:6379';
    const content = lines.join('\n');
    // Fixture's fixed wording ("info request handled in") happens to satisfy
    // the template-share rule across the whole file — pin the new rung off so
    // this test keeps isolating capLines' signal-preservation guarantee.
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: 'C:\\repo\\logs\\app.log' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\logs\\app.log', content, numLines: 900, startLine: 1, totalLines: 900 } },
    }, { HUSH_TEMPLATE: 'off' });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.strictEqual(updated.type, 'text');
    assert.strictEqual(updated.file.filePath, 'C:\\repo\\logs\\app.log');
    assert.strictEqual(updated.file.totalLines, 900, 'original totalLines preserved');
    assert.ok(updated.file.content.includes('ECONNREFUSED'), 'the error line survives the cap');
    assert.match(updated.file.content, /\[hush hook: \d+ lines omitted from this view, none with warnings\/errors\/failures\]/);
    assert.ok(updated.file.content.length < content.length / 2, 'log at least halves');
    assert.strictEqual(updated.file.numLines, updated.file.content.split('\n').length, 'numLines matches new content');
  });

  test('Read of a small .log file stays silent — nothing to shrink', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: '/var/logs/app.log' },
      tool_response: { type: 'text', file: { filePath: '/var/logs/app.log', content: 'one\ntwo\n', numLines: 3, startLine: 1, totalLines: 3 } },
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('short clean output stays silent — no churn', () => {
    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', tool_response: 'ok\ndone' });
    assert.strictEqual(hookOutput(r), null);
  });

  test('string response gets compressed', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');
    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', tool_response: big });
    const out = hookOutput(r);
    const updated = out.hookSpecificOutput.updatedToolOutput;
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(updated, /\[hush hook: \d+ lines omitted from this view, none with warnings\/errors\/failures\]/);
  });

  test('object response compresses stdout, preserves shape and other fields', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');
    const r = runHook('compress-tool-output.js', {
      tool_name: 'PowerShell',
      tool_response: { stdout: big, stderr: '', interrupted: false },
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.strictEqual(updated.interrupted, false);
    assert.match(updated.stdout, /\[hush hook: \d+ lines omitted from this view, none with warnings\/errors\/failures\]/);
  });

  // Reproduces the real gap found via the sonnet-showcase-smoke benchmark: a
  // failing `node --test` run (real exit code 1) that preserve-exit-code.js
  // wrapped to report success — without the wrapper, Claude Code would have
  // routed this through PostToolUseFailure and this hook would never see it
  // at all (see preserve-exit-code.js's header for the full story).
  test('a wrapped FAILING command gets the generous cap and an authoritative exit marker', () => {
    const testLines = Array.from({ length: 320 }, (_, i) =>
      i % 8 === 0 ? `not ok ${i} - some subtest failed` : `ok ${i} - some subtest`
    );
    const raw = testLines.join('\n') + '\n[[hush:exit=1]]';
    // The repeated "ok N - some subtest" shape would otherwise template-
    // collapse; pin it off so this stays a pure exit-marker/cap-generosity test.
    const r = runHook('compress-tool-output.js', { tool_name: 'PowerShell', tool_response: raw }, { HUSH_TEMPLATE: 'off' });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.doesNotMatch(updated, /\[\[hush:exit=/, 'raw wrapper marker never reaches the model');
    assert.match(updated, /\[hush: exit 1\]$/, 'clean exit marker is appended at the end');
    assert.match(updated, /\[hush hook: \d+ lines omitted from this view, none with warnings\/errors\/failures\]/, 'still compressed');
    assert.ok(updated.includes('not ok 0'), 'failure lines are signal — always kept');
  });

  test('a wrapped PASSING command gets the tighter pass cap, not the failure cap', () => {
    const lines = Array.from({ length: 200 }, (_, i) => `ok ${i} - some subtest`);
    const raw = lines.join('\n') + '\n[[hush:exit=0]]';
    const r = runHook('compress-tool-output.js', { tool_name: 'PowerShell', tool_response: raw });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(updated, /\[hush: exit 0\]$/);
    assert.ok(updated.split('\n').length <= 63, 'pass cap (60) should apply, not the fail cap (250)');
  });

  test('wrapped exit marker on an object response (stdout field) is read and stripped the same way', () => {
    const lines = Array.from({ length: 320 }, (_, i) => (i % 8 === 0 ? `ERROR item ${i}` : `ok ${i}`));
    const raw = lines.join('\n') + '\n[[hush:exit=1]]';
    const r = runHook('compress-tool-output.js', {
      tool_name: 'PowerShell',
      tool_response: { stdout: raw, stderr: '', interrupted: false },
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.doesNotMatch(updated.stdout, /\[\[hush:exit=/);
    assert.match(updated.stdout, /\[hush: exit 1\]$/);
    assert.match(updated.stdout, /\[hush hook: \d+ lines omitted/);
  });

  test('a wrapped file-dump command still gets the looser dump cap, not the log cap', () => {
    const big = Array.from({ length: 300 }, (_, i) => `line ${i}`).join('\n');
    const wrappedCommand = 'cat src/Foo.kt\n__hush_exit=$?\necho "[[hush:exit=$__hush_exit]]"\nexit 0';
    const raw = big + '\n[[hush:exit=0]]';
    const asWrappedDump = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      tool_input: { command: wrappedCommand },
      tool_response: raw,
    });
    const asWrappedLog = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      tool_input: { command: 'npm run build\n__hush_exit=$?\necho "[[hush:exit=$__hush_exit]]"\nexit 0' },
      tool_response: raw,
    });
    const dumpLines = hookOutput(asWrappedDump).hookSpecificOutput.updatedToolOutput.split('\n').length;
    const logLines = hookOutput(asWrappedLog).hookSpecificOutput.updatedToolOutput.split('\n').length;
    assert.ok(dumpLines > logLines, `wrapped dump (${dumpLines}) should keep more than wrapped log (${logLines})`);
  });

  // Regression test for the real leak found in the sonnet-showcase-v2 loop
  // run: a pure-cmdlet PowerShell call (no native exe, so $LASTEXITCODE was
  // never set) produced a malformed `[[hush:exit=\n\n]]` marker that reached
  // the model verbatim in 4 of 18 live runs.
  test('a malformed marker (pure-cmdlet call, $LASTEXITCODE never set) never leaks to the model', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'PowerShell',
      tool_response: 'Name\n----\nfoo.js\nbar.js\n[[hush:exit=\n\n]]',
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.doesNotMatch(updated, /\[\[hush:exit=/, 'malformed marker must be stripped, not leaked raw');
    assert.doesNotMatch(updated, /\[hush: exit /, 'no untrustworthy exit-code note should be appended either');
  });

  test('a plain file dump keeps more lines than a same-size build log', () => {
    const big = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');
    const dumpResult = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      tool_input: { command: 'cat src/Foo.kt' },
      tool_response: big,
    });
    const logResult = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      tool_input: { command: 'npm run build' },
      tool_response: big,
    });
    const dumpLines = hookOutput(dumpResult).hookSpecificOutput.updatedToolOutput.split('\n').length;
    const logLines = hookOutput(logResult).hookSpecificOutput.updatedToolOutput.split('\n').length;
    assert.ok(dumpLines > logLines, `dump (${dumpLines} lines) should keep more than log (${logLines} lines)`);
  });

  test('HUSH_DISABLE=1 bypasses everything', () => {
    const big = 'x\n'.repeat(500);
    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', tool_response: big }, { HUSH_DISABLE: '1' });
    assert.strictEqual(hookOutput(r), null);
  });

  test('malformed stdin exits cleanly', () => {
    const { spawnSync } = require('child_process');
    const path = require('path');
    const r = spawnSync('node', [path.join(__dirname, '..', 'hooks', 'compress-tool-output.js')], {
      input: 'not json',
      encoding: 'utf-8',
    });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '');
  });
});

describe('hook: enumeration carve-out (transcript-driven)', () => {
  const dirs = [];
  after(() => {
    for (const d of dirs) fs.rmSync(d, { recursive: true, force: true });
  });

  // A transcript whose last real human prompt is `prompt`.
  function transcriptWith(prompt) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-carveout-'));
    dirs.push(dir);
    const file = path.join(dir, 't.jsonl');
    const entry = JSON.stringify({
      type: 'user',
      uuid: 'u1',
      origin: { kind: 'human' },
      message: { role: 'user', content: prompt },
    });
    fs.writeFileSync(file, entry + '\n');
    return file;
  }

  // Mirror the real fixture: long, with periodic consecutive-dupe noise so the
  // hook always emits (dedupe changes the text) even under the enumerate cap.
  const bigLog = (() => {
    const out = [];
    for (let i = 0; i < 900; i++) {
      out.push(`[${i}] compile mod_${i} ... ok`);
      if (i % 8 === 0) { out.push('note: deferred'); out.push('note: deferred'); out.push('note: deferred'); }
    }
    return out.join('\n');
  })();

  test('an enumerate prompt passes the whole log — no omission markers', () => {
    const file = transcriptWith('Run the build and report every warning: each warning code and file.');
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      transcript_path: file,
      tool_input: { command: 'node build.js' },
      tool_response: bigLog,
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.doesNotMatch(updated, /lines omitted/);
    assert.ok(updated.split('\n').length > 800, 'the full log should survive (dupes collapsed, nothing elided)');
  });

  test('a non-enumerate prompt still gets the normal cap with markers', () => {
    const file = transcriptWith('Run the build and tell me if it succeeded.');
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      transcript_path: file,
      tool_input: { command: 'node build.js' },
      tool_response: bigLog,
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(updated, /\[hush hook: \d+ lines omitted from this view, none with warnings\/errors\/failures\]/);
    assert.ok(updated.split('\n').length <= 61);
  });

  test('no transcript_path falls back to normal compression (fail-safe)', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      tool_input: { command: 'node build.js' },
      tool_response: bigLog,
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(updated, /lines omitted/);
  });
});

describe('hook: once-per-session telemetry note', () => {
  const { claimSessionNote, hasHushNote, NOTE_TEXT } = require('../hooks/compress-tool-output');

  // Unique per test-process so reruns never see a stale sentinel; every id
  // used gets its sentinel removed in after().
  const sids = [];
  function sid(label) {
    const id = `hush-test-note-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    sids.push(id);
    return id;
  }
  after(() => {
    for (const id of sids) fs.rmSync(path.join(os.tmpdir(), `hush-note-${id}`), { force: true });
  });

  const noisy = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');

  test('first compressing fire in a session rides the rewrite with the telemetry note', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      session_id: sid('first'),
      tool_response: noisy,
    });
    const out = hookOutput(r).hookSpecificOutput;
    assert.match(out.updatedToolOutput, /\[hush hook: \d+ lines omitted/);
    assert.strictEqual(out.additionalContext, NOTE_TEXT);
  });

  test('second fire in the same session stays note-free — the rewrite alone', () => {
    const id = sid('dedup');
    const first = hookOutput(runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: id, tool_response: noisy,
    })).hookSpecificOutput;
    const second = hookOutput(runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: id, tool_response: noisy,
    })).hookSpecificOutput;
    assert.strictEqual(first.additionalContext, NOTE_TEXT);
    assert.strictEqual(second.additionalContext, undefined);
    assert.match(second.updatedToolOutput, /\[hush hook: \d+ lines omitted/);
  });

  test('a new session re-arms the note', () => {
    hookOutput(runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: sid('a'), tool_response: noisy,
    }));
    const other = hookOutput(runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: sid('b'), tool_response: noisy,
    })).hookSpecificOutput;
    assert.strictEqual(other.additionalContext, NOTE_TEXT);
  });

  test('a rewrite that leaves no [hush note gets no telemetry note either', () => {
    // ANSI stripping alone changes the text without inserting any marker.
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Bash',
      session_id: sid('nomarker'),
      tool_response: '\x1b[32mok\x1b[0m all good',
    });
    const out = hookOutput(r).hookSpecificOutput;
    assert.ok(!out.updatedToolOutput.includes('[hush'));
    assert.strictEqual(out.additionalContext, undefined);
  });

  test('no session_id, no note — bare harnesses never share sentinel state', () => {
    const out = hookOutput(runHook('compress-tool-output.js', {
      tool_name: 'Bash', tool_response: noisy,
    })).hookSpecificOutput;
    assert.strictEqual(out.additionalContext, undefined);
  });

  test('HUSH_NOTE=off suppresses the note, never the rewrite', () => {
    const out = hookOutput(runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: sid('gated'), tool_response: noisy,
    }, { HUSH_NOTE: 'off' })).hookSpecificOutput;
    assert.strictEqual(out.additionalContext, undefined);
    assert.match(out.updatedToolOutput, /\[hush hook: \d+ lines omitted/);
  });

  test('unit: claimSessionNote claims exactly once per id; hasHushNote spots markers in any shape', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-note-unit-'));
    try {
      assert.strictEqual(claimSessionNote('s1', dir), true);
      assert.strictEqual(claimSessionNote('s1', dir), false);
      assert.strictEqual(claimSessionNote('', dir), false);
      assert.strictEqual(claimSessionNote(undefined, dir), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    assert.strictEqual(hasHushNote('x\n[hush hook: 3 lines omitted from this view, none with warnings/errors/failures]'), true);
    assert.strictEqual(hasHushNote({ file: { content: '[hush: previous line repeated 4x]' } }), true);
    assert.strictEqual(hasHushNote({ stdout: 'plain text' }), false);
  });
});

describe('unit: isGeneratedPath', () => {
  const { isGeneratedPath } = require('../hooks/compress-tool-output');

  test('matches lockfiles, minified bundles, sourcemaps, and generated dirs', () => {
    for (const p of [
      'package-lock.json', 'C:\\repo\\package-lock.json', '/app/yarn.lock',
      'sub/pnpm-lock.yaml', 'Cargo.lock', 'vendor/Gemfile.lock', 'go.sum',
      'assets/app.min.js', 'styles/site.min.css', 'dist/app.bundle.js',
      'build/app.js.map', 'node_modules/lodash/index.js',
      'C:\\repo\\dist\\index.js', 'pkg/__pycache__/mod.pyc',
    ]) assert.strictEqual(isGeneratedPath(p), true, p);
  });

  test('never matches hand-written source or config', () => {
    for (const p of [
      'src/pricing.js', 'package.json', 'README.md', 'src/lock.js',
      'app/locker.lock.ts', 'distribution.md', 'builder/main.go',
      'C:\repo\src\services\pricing.js', 'config/settings.yaml',
    ]) assert.strictEqual(isGeneratedPath(p), false, p);
  });
});

describe('hook: generated-file Read compression', () => {
  const lockfile = (() => {
    const deps = [];
    for (let i = 0; i < 800; i++) deps.push(
      `    "node_modules/pkg-${i}": {\n      "version": "1.${i}.0",\n      "resolved": "https://registry.npmjs.org/pkg-${i}/-/pkg-${i}-1.${i}.0.tgz",\n      "integrity": "sha512-${i}abc"\n    },`);
    return '{\n  "name": "fixture",\n  "lockfileVersion": 3,\n  "packages": {\n' + deps.join('\n') + '\n  }\n}';
  })();

  test('a big package-lock.json Read gets capped with the provenance marker', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: 'C:\\repo\\package-lock.json' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\package-lock.json', content: lockfile, numLines: lockfile.split('\n').length, startLine: 1, totalLines: lockfile.split('\n').length } },
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(updated.file.content, /\[hush hook: \d+ lines omitted from this view/);
    assert.ok(updated.file.content.length < lockfile.length / 4, 'lockfile shrinks hard');
  });

  test('a source file of the same size still passes untouched', () => {
    const src = Array.from({ length: 3000 }, (_, i) => `export const v${i} = ${i};`).join('\n');
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: 'C:\\repo\\src\\big.ts' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\src\\big.ts', content: src, numLines: 3000, startLine: 1, totalLines: 3000 } },
    });
    assert.strictEqual(hookOutput(r), null);
  });
});

describe('hook: subagent-brief', () => {
  const { BRIEF } = require('../hooks/subagent-brief');

  test('injects the report brief on SubagentStart for any agent type', () => {
    const r = runHook('subagent-brief.js', { session_id: 's1', agent_type: 'Explore' });
    const out = hookOutput(r).hookSpecificOutput;
    assert.strictEqual(out.hookEventName, 'SubagentStart');
    assert.strictEqual(out.additionalContext, BRIEF);
  });

  test('HUSH_SUBAGENT=off silences it; HUSH_DISABLE=1 too', () => {
    assert.strictEqual(hookOutput(runHook('subagent-brief.js', { agent_type: 'claude' }, { HUSH_SUBAGENT: 'off' })), null);
    assert.strictEqual(hookOutput(runHook('subagent-brief.js', { agent_type: 'claude' }, { HUSH_DISABLE: '1' })), null);
  });

  test('malformed stdin exits cleanly and still injects', () => {
    const { spawnSync } = require('child_process');
    const path = require('path');
    const r = spawnSync('node', [path.join(__dirname, '..', 'hooks', 'subagent-brief.js')], { input: 'not json', encoding: 'utf-8', timeout: 30000 });
    assert.strictEqual(r.status, 0);
    assert.ok(r.stdout.includes('SubagentStart'));
  });
});

describe('unit: relevance preservation + pressure scaling', () => {
  const { extractRelevanceTokens, pressureScale, compress } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const BT = String.fromCharCode(96);
  const SQ = String.fromCharCode(39);

  test('extractRelevanceTokens pulls backticked and quoted spans only', () => {
    const prompt = 'Read ' + BT + 'package-lock.json' + BT + ' and find "ioredis" version, per ' + SQ + 'W1042' + SQ + ' too';
    assert.deepStrictEqual(extractRelevanceTokens(prompt), ['package-lock.json', 'ioredis', 'w1042']);
    assert.deepStrictEqual(extractRelevanceTokens('no marked spans here at all'), []);
    assert.deepStrictEqual(extractRelevanceTokens(undefined), []);
  });

  test('a prompt-named identifier outside head/tail survives the cap', () => {
    const lines = Array.from({ length: 400 }, (_, i) => '    "node_modules/pkg-' + i + '": { "version": "1.0.' + i + '" },');
    lines[200] = '    "node_modules/ioredis": { "version": "5.4.1" },';
    const withTok = compress(lines.join(NL), 0, true, false, ['ioredis'], 1);
    const without = compress(lines.join(NL), 0, true, false, [], 1);
    assert.ok(withTok.includes('5.4.1'), 'ioredis line survives with relevance token');
    assert.ok(!without.includes('5.4.1'), 'same line is cut without the token');
  });

  test('a token matching too many lines is ignored (no cap blowout)', () => {
    const lines = Array.from({ length: 400 }, (_, i) => 'version line ' + i);
    const out = compress(lines.join(NL), 0, false, false, ['version'], 1);
    assert.ok(out.split(NL).length <= 62, 'common token must not defeat the cap');
  });

  test('pressureScale steps at 400KB and 1MB', () => {
    assert.strictEqual(pressureScale(100 * 1024), 1);
    assert.strictEqual(pressureScale(500 * 1024), 0.75);
    assert.strictEqual(pressureScale(2 * 1024 * 1024), 0.5);
    assert.strictEqual(pressureScale(NaN), 1);
  });

  test('scale tightens caps but never below the floors; enumerate never scales', () => {
    const big = Array.from({ length: 3000 }, (_, i) => 'unique ' + i).join(NL);
    const full = compress(big, 0, false, false, [], 1).split(NL).length;
    const half = compress(big, 0, false, false, [], 0.5).split(NL).length;
    assert.ok(half < full, 'scaled cap (' + half + ') tighter than base (' + full + ')');
    assert.ok(half >= 30, 'pass floor holds');
    const enumFull = compress(big, 0, false, true, [], 0.5).split(NL).length;
    assert.ok(enumFull > 2000, 'enumeration carve-out is never scaled');
  });
});

describe('unit + e2e: sidecar digests for very large outputs', () => {
  const { compress: comp } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const created = [];
  function pathFrom(digest) {
    const m = digest.match(/saved in full to ([^;]+);/);
    if (m) created.push(m[1].trim());
    return m ? m[1].trim() : null;
  }
  function withSidecarOn(fn) {
    const prev = process.env.HUSH_SIDECAR;
    delete process.env.HUSH_SIDECAR;
    try { return fn(); } finally { process.env.HUSH_SIDECAR = prev; }
  }
  after(() => { for (const f of created) fs.rmSync(f, { force: true }); });

  const bigLog = (() => {
    const ls = [];
    for (let i = 0; i < 2000; i++) ls.push(i % 9 === 0 ? '02:' + String(i % 60).padStart(2, '0') + ' ERROR redis ECONNREFUSED attempt ' + i : '02:00 info handled req ' + i + ' in ' + (i % 90) + 'ms');
    return ls.join(NL);
  })();

  test('a huge output becomes a line-numbered digest and the full text lands in the sidecar file', () => {
    const digest = withSidecarOn(() => comp(bigLog, 0, true, false, ['ioredis'], 1, 'sidetest'));
    assert.ok(digest.startsWith('[hush hook: this output is'), 'digest opens with the provenance header');
    assert.match(digest, /this output is \d+ non-empty lines \(\d+ errors?\)/, 'header carries the category census, not a bare count');
    assert.match(digest, /re-run the command instead/, 'missing-file fallback is present');
    assert.match(digest, /including any total or count you report/, 'totals are steered to the full file, not the digest');
    assert.match(digest, /L\d+: /, 'digest lines carry real line numbers');
    assert.match(digest, /lines in the file only/, 'gaps are counted, not hidden');
    const file = pathFrom(digest);
    assert.ok(file && fs.existsSync(file), 'sidecar file exists');
    assert.strictEqual(fs.readFileSync(file, 'utf8'), bigLog, 'sidecar holds the full cleaned text');
    assert.ok(digest.length < bigLog.length / 10, 'digest is an order of magnitude smaller');
  });

  test('below the threshold the normal capped view still applies', () => {
    const small = Array.from({ length: 300 }, (_, i) => 'l' + i).join(NL);
    const out = withSidecarOn(() => comp(small, 0, false, false, [], 1, 'sidetest'));
    assert.doesNotMatch(out, /saved in full to/);
    assert.match(out, /lines omitted from this view/);
  });

  test('the enumeration carve-out is exempt — nothing moves to a file', () => {
    const out = withSidecarOn(() => comp(bigLog, 0, true, true, [], 1, 'sidetest'));
    assert.doesNotMatch(out, /saved in full to/);
  });

  test('same content re-fires to the same file (idempotent)', () => {
    const d1 = withSidecarOn(() => comp(bigLog, 0, true, false, [], 1, 'sidetest'));
    const d2 = withSidecarOn(() => comp(bigLog, 0, true, false, [], 1, 'sidetest'));
    assert.strictEqual(pathFrom(d1), pathFrom(d2));
  });

  test('prompt-named lines join the digest', () => {
    const ls = Array.from({ length: 2000 }, (_, i) => 'info filler line ' + i + ' padding padding');
    ls[1000] = '    "node_modules/ioredis": { "version": "5.4.1" },';
    const digest = withSidecarOn(() => comp(ls.join(NL), 0, true, false, ['ioredis'], 1, 'sidetest'));
    pathFrom(digest);
    assert.ok(digest.includes('5.4.1'), 'relevance line is in the digest, not only the file');
  });

  test('e2e: a big log Read is delivered as a digest and the note still rides once', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      session_id: 'hush-test-side-' + Date.now(),
      tool_input: { file_path: '/var/logs/app.log' },
      tool_response: { type: 'text', file: { filePath: '/var/logs/app.log', content: bigLog, numLines: 2000, startLine: 1, totalLines: 2000 } },
    }, { HUSH_SIDECAR: '' });
    const out = hookOutput(r).hookSpecificOutput;
    assert.match(out.updatedToolOutput.file.content, /saved in full to/);
    assert.ok(out.additionalContext, 'telemetry note rides the first sidecar rewrite too');
    pathFrom(out.updatedToolOutput.file.content);
  });
});

describe('secrets guard: credential-shaped content is never persisted to a sidecar', () => {
  const { compress: comp, containsSecret } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const sideDir = path.join(os.tmpdir(), 'hush-sidecar');
  function withSidecarOn(fn) {
    const prev = process.env.HUSH_SIDECAR;
    delete process.env.HUSH_SIDECAR;
    try { return fn(); } finally { process.env.HUSH_SIDECAR = prev; }
  }
  // Every line here shares one shape (only the counter/duration vary), so
  // collapseTemplates alone would shrink 2000 lines under the cap and hide
  // whether capLines' own "lines omitted" marker fired — pin templating off
  // so the skip-sidecar case demonstrably reaches the ordinary line cap.
  function withTemplateOff(fn) {
    const prev = process.env.HUSH_TEMPLATE;
    process.env.HUSH_TEMPLATE = 'off';
    try { return fn(); } finally { if (prev === undefined) delete process.env.HUSH_TEMPLATE; else process.env.HUSH_TEMPLATE = prev; }
  }
  function sidecarFileCount() {
    try { return fs.readdirSync(sideDir).length; } catch { return 0; }
  }
  // Same size/shape as the sidecar suite's own bigLog fixture, minus the
  // synthetic ERROR lines (irrelevant here) — clears SIDECAR_MIN_CHARS on its
  // own so every case in this block is genuinely sidecar-eligible by size.
  function bigLog(extraLine) {
    const ls = Array.from({ length: 2000 }, (_, i) => '02:00 info handled req ' + i + ' in ' + (i % 90) + 'ms');
    if (extraLine) ls[1000] = extraLine;
    return ls.join(NL);
  }

  test('unit: containsSecret flags one representative of every pattern class', () => {
    const hits = [
      'sk-abcd1234EFGH5678ijklMNOPqrst',
      'ghp_ABCDEFGHIJ0123456789klmnopqrst',
      'AKIAABCDEFGHIJKLMNOP',
      'xoxb-not-a-real-slack-token-fixture-value',
      '-----BEGIN RSA PRIVATE KEY-----\nMIIEow==\n-----END RSA PRIVATE KEY-----',
      'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9',
      'postgres://dbuser:s3cr3tpass@db.internal:5432/prod',
    ];
    for (const h of hits) assert.strictEqual(containsSecret(h), true, h);
  });

  test('unit: containsSecret leaves ordinary text and near-miss lookalikes alone', () => {
    assert.strictEqual(containsSecret('plain build log line with no credentials'), false);
    assert.strictEqual(containsSecret('sk8ers gonna sk8, ghost town, akin to xoxo hugs'), false);
  });

  test('a secret buried in an otherwise sidecar-eligible output skips the sidecar entirely', () => {
    const before = sidecarFileCount();
    const out = withSidecarOn(() => withTemplateOff(() =>
      comp(bigLog('leaked key: sk-abcd1234EFGH5678ijklMNOPqrst'), 0, true, false, [], 1, 'secrettest')
    ));
    assert.doesNotMatch(out, /saved in full to/, 'no sidecar pointer emitted');
    assert.match(out, /lines omitted from this view/, 'falls through to the ordinary inline cap');
    assert.strictEqual(sidecarFileCount(), before, 'no new sidecar file was written');
  });

  test('control: the identical shape without a secret still sidecars', () => {
    const before = sidecarFileCount();
    const out = withSidecarOn(() => comp(bigLog(null), 0, true, false, [], 1, 'secrettest'));
    assert.match(out, /saved in full to/, 'clean content still gets the sidecar treatment');
    assert.strictEqual(sidecarFileCount(), before + 1, 'exactly one new sidecar file appeared');
    const m = out.match(/saved in full to ([^;]+);/);
    if (m) fs.rmSync(m[1].trim(), { force: true });
  });
});

describe('unit + e2e: reads OF sidecar files are capped, never re-sidecared', () => {
  const { isSidecarPath } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const os2 = require('os');
  const sideDir = path.join(os2.tmpdir(), 'hush-sidecar');

  test('isSidecarPath matches only files directly under the sidecar dir', () => {
    assert.strictEqual(isSidecarPath(path.join(sideDir, 'abc123.txt')), true);
    assert.strictEqual(isSidecarPath('/var/logs/app.log'), false);
    assert.strictEqual(isSidecarPath(path.join(os2.tmpdir(), 'other', 'abc.txt')), false);
    assert.strictEqual(isSidecarPath(undefined), false);
  });

  test('e2e: a FULL Read of a sidecar file returns the capped view, not another digest', () => {
    const big = Array.from({ length: 2000 }, (_, i) => (i % 9 === 0 ? 'ERROR item ' + i : 'info line ' + i)).join(NL);
    const f = path.join(sideDir, 'test-fullread.txt');
    fs.mkdirSync(sideDir, { recursive: true });
    fs.writeFileSync(f, big);
    try {
      const r = runHook('compress-tool-output.js', {
        tool_name: 'Read',
        session_id: 'hush-test-sideread-' + Date.now(),
        tool_input: { file_path: f },
        tool_response: { type: 'text', file: { filePath: f, content: big, numLines: 2000, startLine: 1, totalLines: 2000 } },
      }, { HUSH_SIDECAR: '' });
      const content = hookOutput(r).hookSpecificOutput.updatedToolOutput.file.content;
      assert.doesNotMatch(content, /saved in full to/, 'never re-sidecared');
      assert.match(content, /lines omitted from this view/, 'capped like a log');
      assert.ok(content.includes('ERROR item 0'), 'signal lines survive');
    } finally { fs.rmSync(f, { force: true }); }
  });

  test('e2e: a small range Read of a sidecar file passes untouched', () => {
    const f = path.join(sideDir, 'test-rangeread.txt');
    fs.mkdirSync(sideDir, { recursive: true });
    fs.writeFileSync(f, 'whole file');
    try {
      const range = Array.from({ length: 12 }, (_, i) => 'line ' + (500 + i)).join(NL);
      const r = runHook('compress-tool-output.js', {
        tool_name: 'Read',
        session_id: 'hush-test-siderange-' + Date.now(),
        tool_input: { file_path: f, offset: 500, limit: 12 },
        tool_response: { type: 'text', file: { filePath: f, content: range, numLines: 12, startLine: 500, totalLines: 2000 } },
      }, { HUSH_SIDECAR: '' });
      assert.strictEqual(hookOutput(r), null, 'nothing to shrink, hook stays silent');
    } finally { fs.rmSync(f, { force: true }); }
  });
});

describe('signal-first digest + compound-error signal matching', () => {
  const { capLines, compress } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const created = [];
  after(() => { for (const f of created) fs.rmSync(f, { force: true }); });
  function pathFrom(d) { const m = d.match(/saved in full to ([^;]+);/); if (m) created.push(m[1].trim()); return m ? m[1].trim() : null; }
  function withSidecar(fn) { const p = process.env.HUSH_SIDECAR; delete process.env.HUSH_SIDECAR; try { return fn(); } finally { process.env.HUSH_SIDECAR = p; } }

  test('capLines keeps a bare ReferenceError line the old regex would miss', () => {
    const lines = Array.from({ length: 300 }, (_, i) => 'compile mod_' + i + ' ok');
    lines[150] = 'ReferenceError: retries is not defined';
    const out = capLines(lines, 20).join(NL);
    assert.ok(out.includes('ReferenceError: retries is not defined'), 'compound *Error name survives the cap as signal');
  });

  test('TypeError / SyntaxError / RangeError all register as signal', () => {
    for (const err of ['TypeError: x is not a function', 'SyntaxError: unexpected token', 'RangeError: invalid array length']) {
      const lines = Array.from({ length: 200 }, (_, i) => 'ok line ' + i);
      lines[100] = err;
      assert.ok(capLines(lines, 20).join(NL).includes(err), err + ' should survive');
    }
  });

  test('digest leads with signal lines so the error survives a ~2KB preview truncation', () => {
    const lines = [];
    for (let i = 0; i < 700; i++) lines.push('[' + i + '/700] compile mod_' + i + ' ... ok (46ms) with some padding to widen the line');
    lines[690] = 'ERROR EBUILD01 link-failed: ReferenceError: retries is not defined';
    const digest = withSidecar(() => compress(lines.join(NL), 1, false, false, [], 1, 'sigfirst'));
    pathFrom(digest);
    const errPos = digest.indexOf('ReferenceError');
    const noisePos = digest.indexOf('compile mod_0 ');
    assert.ok(errPos > -1, 'error line is in the digest');
    assert.ok(errPos < noisePos, 'error appears BEFORE the head compile noise');
    assert.ok(errPos < 2048, 'error is within the first 2KB preview window (was at ' + errPos + ')');
    assert.ok(digest.includes('Signal lines ('), 'signal section header present');
    assert.match(digest, /Signal lines \(\d+ total: 1 error\):/, 'census names the single error line');
    assert.ok(digest.includes('Structure (head + tail'), 'structural section header present');
    assert.match(digest, /lines in the file only/, 'structural gap markers preserved');
  });

  test('a digest with no signal lines still emits the structural section', () => {
    const lines = Array.from({ length: 700 }, (_, i) => 'plain info line ' + i + ' padded out a bit for width here');
    const digest = withSidecar(() => compress(lines.join(NL), 0, true, false, [], 1, 'nosig'));
    pathFrom(digest);
    assert.ok(!digest.includes('Signal lines ('), 'no signal header when there are none');
    assert.ok(digest.includes('Structure (head + tail'), 'structural section header present');
    assert.match(digest, /L1: /, 'head still present');
  });
});

describe('census-grade sidecar digests', () => {
  const { compress: comp2 } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const created = [];
  after(() => { for (const f of created) fs.rmSync(f, { force: true }); });
  function pathFrom(d) { const m = String(d).match(/saved in full to ([^;]+);/); if (m) created.push(m[1].trim()); return m ? m[1].trim() : null; }
  function withSidecar(fn) { const p = process.env.HUSH_SIDECAR; delete process.env.HUSH_SIDECAR; try { return fn(); } finally { process.env.HUSH_SIDECAR = p; } }

  test('signalCensus counts each category on a mixed-signal fixture', () => {
    const lines = [
      'ERROR one', 'ERROR two', 'FAILURE suite', 'WARNING low disk',
      'WARNING stale cache', 'WARNING retry limit', 'DEPRECATED old flag', 'ok line',
    ];
    const signalIdx = [0, 1, 2, 3, 4, 5, 6];
    assert.strictEqual(signalCensus(lines, signalIdx), '2 errors, 1 failure, 3 warnings, 1 deprecation');
  });

  test('signalCensus omits zero-count categories and uses singular for a count of 1', () => {
    const lines = ['WARNING only one'];
    assert.strictEqual(signalCensus(lines, [0]), '1 warning');
  });

  test('a line matching both FAIL and Error counts once, classified as error (priority order)', () => {
    const lines = ['FAILURE: ReferenceError: retries is not defined'];
    assert.strictEqual(signalCensus(lines, [0]), '1 error');
  });

  test('CRITICAL classifies as critical, not warning or error', () => {
    const lines = ['CRITICAL disk full'];
    assert.strictEqual(signalCensus(lines, [0]), '1 critical');
  });

  test('"Other signal lines" is absent when every signal line fits in the lead sample', () => {
    const lines = [];
    for (let i = 0; i < 200; i++) lines.push('info ' + i);
    lines[5] = 'ERROR only one signal line';
    const digest = withSidecar(() => comp2(lines.join(NL), 0, true, false, [], 1, 'fewsignals'));
    pathFrom(digest);
    assert.ok(!digest.includes('Other signal lines'), 'nothing unshown, so no "not shown" line');
  });

  test('"Other signal lines (not shown)" lists real L<n> targets and caps at 15 with a "+more" tail', () => {
    const lines = [];
    for (let i = 0; i < 2000; i++) lines.push('info ' + i + ' padded a bit for width');
    // 50 ERROR lines spread through the middle: the lead sample only keeps the
    // first 10 + last 10 signal indices, leaving 30 unshown in the middle —
    // enough to exceed the 15-entry cap and exercise the "+more" tail.
    for (let i = 0; i < 50; i++) lines[100 + i * 10] = 'ERROR item ' + i;
    const digest = withSidecar(() => comp2(lines.join(NL), 0, true, false, [], 1, 'manysignals'));
    pathFrom(digest);
    assert.match(digest, /Other signal lines \(not shown\): (L\d+, ){14}L\d+ \.\.\. \(\+\d+ more\)/, 'capped at 15 numbers with a remaining-count tail');
    const m = digest.match(/Other signal lines \(not shown\): ([^\n]+)/);
    assert.ok(m, 'the line is present');
    assert.match(m[1], /^L\d+/, 'entries are real L<n> line numbers');
  });

  test('header + census + lead signal lines fit within the 2KB host preview budget', () => {
    const lines = [];
    for (let i = 0; i < 1500; i++) lines.push('build step ' + i + ' ok, padded a little for width');
    lines[10] = 'ERROR connection refused';
    lines[11] = 'WARNING deprecated flag used';
    lines[12] = 'FAILURE suite red';
    lines[13] = 'CRITICAL disk full';
    lines[14] = 'DEPRECATED old api';
    const digest = withSidecar(() => comp2(lines.join(NL), 1, false, false, [], 1, 'budget2KB'));
    pathFrom(digest);
    const structAt = digest.indexOf('Structure (head + tail');
    assert.ok(structAt > -1, 'structure section present');
    assert.ok(structAt <= 2048, 'header + census + lead signal lines fit the 2KB preview (was ' + structAt + ' chars)');
  });
});

describe('shell-scoped sidecar upper bound (host-truncation guard)', () => {
  const { compress } = require('../hooks/compress-tool-output');
  const NL = String.fromCharCode(10);
  const created = [];
  after(() => { for (const f of created) fs.rmSync(f, { force: true }); });
  function pathFrom(d) { const m = String(d).match(/saved in full to ([^;]+);/); if (m) created.push(m[1].trim()); return m ? m[1].trim() : null; }
  function withSidecar(fn) { const p = process.env.HUSH_SIDECAR; delete process.env.HUSH_SIDECAR; try { return fn(); } finally { process.env.HUSH_SIDECAR = p; } }
  function bigText(chars) { const a = []; let n = 0; while (a.join(NL).length < chars) { a.push('info line ' + n + ' padding padding padding padding ' + n); n++; } return a.join(NL); }

  test('a shell output in the 15-28KB window still sidecars', () => {
    const out = withSidecar(() => compress(bigText(20000), 0, false, false, [], 1, 's', undefined, true));
    pathFrom(out);
    assert.match(out, /saved in full to/, 'sidecar active in the sweet spot');
  });

  test('a shell output at/above the host-truncation size does NOT sidecar (falls to inline cap)', () => {
    // bigText's fixed "info line N padding..." shape template-collapses on its
    // own; pin the new rung off so this test isolates the sidecar/cap fallback.
    const prevTemplate = process.env.HUSH_TEMPLATE;
    process.env.HUSH_TEMPLATE = 'off';
    let out;
    try {
      out = withSidecar(() => compress(bigText(32000), 0, false, false, [], 1, 's', undefined, true));
    } finally {
      if (prevTemplate === undefined) delete process.env.HUSH_TEMPLATE; else process.env.HUSH_TEMPLATE = prevTemplate;
    }
    assert.doesNotMatch(out, /saved in full to/, 'no truncated "full" file, no competing pointer');
    assert.match(out, /lines omitted from this view/, 'normal inline cap applies instead');
  });

  test('a large Read is exempt — full content reaches the hook, sidecar still helps', () => {
    const out = withSidecar(() => compress(bigText(36000), 0, true, false, [], 1, 's', false));
    pathFrom(out);
    assert.match(out, /saved in full to/, 'Read path keeps sidecaring big files');
  });

  test('HUSH_SIDECAR_SHELL_MAX tunes the bound', () => {
    const prev = process.env.HUSH_SIDECAR_SHELL_MAX;
    process.env.HUSH_SIDECAR_SHELL_MAX = '18000';
    // constants are read at require-time; re-require a fresh copy
    const p = require.resolve('../hooks/compress-tool-output');
    delete require.cache[p];
    const fresh = require('../hooks/compress-tool-output');
    try {
      const out = withSidecar(() => fresh.compress(bigText(20000), 0, false, false, [], 1, 's', undefined, true));
      assert.doesNotMatch(out, /saved in full to/, '20KB now exceeds the lowered bound');
    } finally {
      if (prev === undefined) delete process.env.HUSH_SIDECAR_SHELL_MAX; else process.env.HUSH_SIDECAR_SHELL_MAX = prev;
      delete require.cache[p];
      require('../hooks/compress-tool-output');
    }
  });
});

describe('MCP JSON table-ification (ROADMAP 007 / Probe 7)', () => {
  const {
    isMcpTableTool,
    mcpTableCandidate,
    renderMcpTable,
    extractMcpText,
    compressMcpTable,
  } = require('../hooks/compress-tool-output');

  // 30 homogeneous records, one shared constant column (matchType), well
  // over the 2KB eligibility floor.
  function records(n = 30) {
    return Array.from({ length: n }, (_, i) => ({
      file: `src/main/kotlin/pkg/File${i}.kt`,
      line: i + 1,
      column: i % 3,
      snippet: `val x${i} = compute(${i}) // similar snippet text repeated for width padding`,
      matchType: 'TEXT',
    }));
  }

  test('isMcpTableTool matches only the measured method suffix, any server prefix', () => {
    assert.ok(isMcpTableTool('mcp__idea__search_regex'));
    assert.ok(isMcpTableTool('mcp__jetbrains__get_file_problems'));
    assert.strictEqual(isMcpTableTool('mcp__idea__read_file'), false, 'unmeasured method');
    assert.strictEqual(isMcpTableTool('Bash'), false);
    assert.strictEqual(isMcpTableTool(undefined), false);
  });

  test('mcpTableCandidate accepts a homogeneous >=5-record array over 2KB', () => {
    const c = mcpTableCandidate(JSON.stringify(records()));
    assert.ok(c);
    assert.strictEqual(c.records.length, 30);
    assert.ok(c.columns.includes('matchType'));
  });

  test('mcpTableCandidate rejects payloads under the size floor, non-JSON, and non-homogeneous arrays', () => {
    assert.strictEqual(mcpTableCandidate(JSON.stringify(records(2))), null, 'below 2KB and below 5 records');
    assert.strictEqual(mcpTableCandidate('not json at all, '.repeat(200)), null);
    const mixed = [{ a: 1 }, { b: 2 }, { c: 3 }, { d: 4 }, { e: 5 }, { f: 6 }].map((o, i) => ({ ...o, pad: 'x'.repeat(400 + i) }));
    assert.strictEqual(mcpTableCandidate(JSON.stringify(mixed)), null, 'no shared keys, fails the 80% overlap gate');
  });

  test('mcpTableCandidate finds a nested {results:[...]} array too', () => {
    const wrapped = { query: 'foo', results: records() };
    const c = mcpTableCandidate(JSON.stringify(wrapped));
    assert.ok(c);
    assert.strictEqual(c.records.length, 30);
  });

  test('renderMcpTable hoists the constant column and shrinks the payload', () => {
    const rs = records();
    const out = renderMcpTable(rs, Object.keys(rs[0]));
    assert.match(out, /constant: matchType=TEXT/);
    assert.ok(out.includes('file\tline\tcolumn\tsnippet'), 'variable columns form the header row');
    assert.ok(out.length < JSON.stringify(rs).length, 'table rendering is smaller than raw JSON');
    assert.match(out, /^\[hush hook: 30 MCP JSON records rendered as a schema table below\.\]/);
  });

  test('a record whose serialized form matches SIGNAL_RE still renders as a table row, losslessly', () => {
    const rs = records();
    rs[10] = { ...rs[10], snippet: 'ERROR: unresolved reference to compute' };
    const out = renderMcpTable(rs, Object.keys(rs[0]));
    assert.ok(!out.includes(JSON.stringify(rs[10])), 'no record is appended verbatim anymore');
    assert.ok(out.includes('ERROR: unresolved reference to compute'), 'the signal-bearing value is present, as a row');
    assert.ok(out.includes('src/main/kotlin/pkg/File10.kt'), 'the rest of that record\'s fields are present too');
    assert.strictEqual(out.split('\n').length, 1 + 1 + 1 + rs.length, 'header + constant line + column header + one row per record, none dropped');
  });

  test('extractMcpText reads the bare content-block array, a plain string, or neither', () => {
    assert.strictEqual(extractMcpText([{ type: 'text', text: 'hello' }]), 'hello');
    assert.strictEqual(extractMcpText('plain string result'), 'plain string result');
    assert.strictEqual(extractMcpText({ content: [{ type: 'text', text: 'wrapped' }] }), null, 'object wrapper is not the expected bare-array shape');
    assert.strictEqual(extractMcpText([{ type: 'image' }]), null);
  });

  test('compressMcpTable mirrors the response shape: string in, string out; array in, array out', () => {
    const rs = records();
    const asString = compressMcpTable(JSON.stringify(rs));
    assert.strictEqual(typeof asString, 'string');
    assert.match(asString, /^\[hush hook:/);

    const asArray = compressMcpTable([{ type: 'text', text: JSON.stringify(rs) }]);
    assert.ok(Array.isArray(asArray));
    assert.strictEqual(asArray[0].type, 'text');
    assert.match(asArray[0].text, /^\[hush hook:/);
  });

  test('compressMcpTable stays silent on ineligible payloads', () => {
    assert.strictEqual(compressMcpTable(JSON.stringify(records(2))), undefined, 'too few records / under size floor');
    assert.strictEqual(compressMcpTable('plain text result, not JSON'), undefined);
  });

  test('e2e: a measured MCP tool with a big homogeneous payload gets table-rendered', () => {
    const rs = records();
    const r = runHook('compress-tool-output.js', {
      tool_name: 'mcp__idea__search_regex',
      tool_response: JSON.stringify(rs),
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(updated, /MCP JSON records rendered as a schema table/);
    assert.ok(updated.length < JSON.stringify(rs).length);
  });

  test('e2e: the bare content-block array shape is preserved on the way out', () => {
    const rs = records();
    const r = runHook('compress-tool-output.js', {
      tool_name: 'mcp__idea__get_file_problems',
      tool_response: [{ type: 'text', text: JSON.stringify(rs) }],
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.ok(Array.isArray(updated), 'never an object wrapper — harness throws on {content:[...]}');
    assert.strictEqual(updated[0].type, 'text');
    assert.match(updated[0].text, /MCP JSON records rendered as a schema table/);
  });

  test('e2e: an unmeasured MCP tool (not in the scoped method list) stays untouched', () => {
    const rs = records();
    const r = runHook('compress-tool-output.js', {
      tool_name: 'mcp__idea__read_file',
      tool_response: JSON.stringify(rs),
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('e2e: a small payload on a measured MCP tool stays silent', () => {
    const r = runHook('compress-tool-output.js', {
      tool_name: 'mcp__idea__search_regex',
      tool_response: JSON.stringify(records(2)),
    });
    assert.strictEqual(hookOutput(r), null);
  });
});

describe('re-read delta (ROADMAP 066b): only the corpus-probed half of the cross-turn delta idea', () => {
  const DELTA_HEADER_RE = /\[hush hook: this file changed since your last read/;
  let counter = 0;
  function freshSession() {
    counter += 1;
    return `hush-test-delta-${Date.now()}-${counter}`;
  }

  function readLog(filePath, content, sessionId, extraInput, env) {
    return runHook('compress-tool-output.js', {
      tool_name: 'Read',
      session_id: sessionId,
      tool_input: { file_path: filePath, ...(extraInput || {}) },
      tool_response: { type: 'text', file: { filePath, content, numLines: content.split('\n').length, startLine: 1, totalLines: content.split('\n').length } },
    }, env);
  }

  function editFile(filePath, sessionId) {
    return runHook('compress-tool-output.js', {
      tool_name: 'Edit',
      session_id: sessionId,
      tool_input: { file_path: filePath, old_string: 'x', new_string: 'y' },
      tool_response: { filePath },
    });
  }

  function steadyLines(n) {
    return Array.from({ length: n }, (_, i) => `10:${String(i % 60).padStart(2, '0')} info steady worker handled job ${i}`);
  }

  test('first read of a watched path is a baseline — never a delta', () => {
    const filePath = 'C:\\repo\\logs\\svc1.log';
    const sessionId = freshSession();
    const r = readLog(filePath, steadyLines(80).join('\n'), sessionId);
    const out = hookOutput(r);
    if (out) assert.doesNotMatch(out.hookSpecificOutput.updatedToolOutput.file.content, DELTA_HEADER_RE);
  });

  test('an unchanged re-read stays a routine view — no delta marker', () => {
    const filePath = 'C:\\repo\\logs\\svc2.log';
    const sessionId = freshSession();
    const content = steadyLines(80).join('\n');
    readLog(filePath, content, sessionId);
    const r2 = readLog(filePath, content, sessionId);
    const out2 = hookOutput(r2);
    if (out2) assert.doesNotMatch(out2.hookSpecificOutput.updatedToolOutput.file.content, DELTA_HEADER_RE);
  });

  test('a re-read after an external change (no self-edit) gets a delta with the changed/signal line', () => {
    const filePath = 'C:\\repo\\logs\\svc3.log';
    const sessionId = freshSession();
    readLog(filePath, steadyLines(80).join('\n'), sessionId);

    const lines2 = steadyLines(80);
    lines2[40] = 'ERROR worker-4 crashed: connection reset';
    const r2 = readLog(filePath, lines2.join('\n'), sessionId);
    const updated = hookOutput(r2).hookSpecificOutput.updatedToolOutput;
    assert.match(updated.file.content, DELTA_HEADER_RE);
    assert.ok(updated.file.content.includes('ERROR worker-4 crashed: connection reset'), 'the changed signal line is shown');
    assert.ok(updated.file.content.length < lines2.join('\n').length, 'a delta of one changed line is far smaller than the whole file');
  });

  test('every 3rd changed re-read of the same path goes out full again, not delta', () => {
    const filePath = 'C:\\repo\\logs\\svc4.log';
    const sessionId = freshSession();
    readLog(filePath, steadyLines(80).join('\n'), sessionId); // baseline

    function changed(i) {
      const ls = steadyLines(80);
      ls[i] = `WARN drift ${i}`;
      return ls.join('\n');
    }

    const c1 = hookOutput(readLog(filePath, changed(1), sessionId)).hookSpecificOutput.updatedToolOutput.file.content;
    const c2 = hookOutput(readLog(filePath, changed(2), sessionId)).hookSpecificOutput.updatedToolOutput.file.content;
    const out3 = hookOutput(readLog(filePath, changed(3), sessionId));
    const c4 = hookOutput(readLog(filePath, changed(4), sessionId)).hookSpecificOutput.updatedToolOutput.file.content;

    assert.match(c1, DELTA_HEADER_RE, '1st changed re-read is a delta');
    assert.match(c2, DELTA_HEADER_RE, '2nd changed re-read is a delta');
    if (out3) assert.doesNotMatch(out3.hookSpecificOutput.updatedToolOutput.file.content, DELTA_HEADER_RE, '3rd changed re-read forces a full view');
    assert.match(c4, DELTA_HEADER_RE, 'the cycle restarts on the next changed re-read');
  });

  test('an Edit on the path resets the baseline — the next read is full, not a delta', () => {
    const filePath = 'C:\\repo\\logs\\svc5.log';
    const sessionId = freshSession();
    readLog(filePath, steadyLines(80).join('\n'), sessionId);
    editFile(filePath, sessionId);

    const lines2 = steadyLines(80);
    lines2[10] = 'this is the self-edited version of the line, not an external change';
    const r2 = readLog(filePath, lines2.join('\n'), sessionId);
    const out2 = hookOutput(r2);
    if (out2) assert.doesNotMatch(out2.hookSpecificOutput.updatedToolOutput.file.content, DELTA_HEADER_RE);
  });

  test('a source file is never delta-tracked, whatever changes between reads', () => {
    const filePath = 'C:\\repo\\src\\services\\worker.js';
    const sessionId = freshSession();
    const src1 = Array.from({ length: 80 }, (_, i) => `const x${i} = ${i};`).join('\n');
    assert.strictEqual(hookOutput(readLog(filePath, src1, sessionId)), null);

    const src2 = Array.from({ length: 80 }, (_, i) => `const x${i} = ${i + 1};`).join('\n');
    assert.strictEqual(hookOutput(readLog(filePath, src2, sessionId)), null, 'no delta marker ever appears for a source path');
  });

  test('a range read (offset/limit) never engages the delta', () => {
    const filePath = 'C:\\repo\\logs\\svc6.log';
    const sessionId = freshSession();
    readLog(filePath, steadyLines(80).join('\n'), sessionId);

    const lines2 = steadyLines(80);
    lines2[5] = 'ERROR range read target';
    const range = lines2.slice(0, 10).join('\n');
    const r2 = readLog(filePath, range, sessionId, { offset: 1, limit: 10 });
    const out2 = hookOutput(r2);
    if (out2) assert.doesNotMatch(out2.hookSpecificOutput.updatedToolOutput.file.content, DELTA_HEADER_RE);
  });

  test('rejected-not-smaller: a near-total rewrite falls back to the ordinary view, not an oversized delta', () => {
    const filePath = 'C:\\repo\\logs\\svc7.log';
    const sessionId = freshSession();
    readLog(filePath, steadyLines(80).join('\n'), sessionId);

    const lines2 = Array.from({ length: 80 }, (_, i) => `totally different content on line ${i} with unique wording`);
    const r2 = readLog(filePath, lines2.join('\n'), sessionId);
    const out2 = hookOutput(r2);
    if (out2) {
      assert.doesNotMatch(
        out2.hookSpecificOutput.updatedToolOutput.file.content,
        DELTA_HEADER_RE,
        'a near-total rewrite is not smaller as a delta, so it falls back to the normal view'
      );
    }
  });

  test('HUSH_DELTA=off disables the feature — a changed re-read stays a routine full view', () => {
    const filePath = 'C:\\repo\\logs\\svc8.log';
    const sessionId = freshSession();
    readLog(filePath, steadyLines(80).join('\n'), sessionId, undefined, { HUSH_DELTA: 'off' });
    const lines2 = steadyLines(80);
    lines2[40] = 'ERROR toggled off';
    const r2 = readLog(filePath, lines2.join('\n'), sessionId, undefined, { HUSH_DELTA: 'off' });
    const out2 = hookOutput(r2);
    if (out2) assert.doesNotMatch(out2.hookSpecificOutput.updatedToolOutput.file.content, DELTA_HEADER_RE);
  });

  describe('unit: pure delta helpers', () => {
    const { changedLineIndexes, renderDelta } = require('../hooks/compress-tool-output');

    test('changedLineIndexes finds only differing positions', () => {
      assert.deepStrictEqual(changedLineIndexes(['a', 'b', 'c'], ['a', 'x', 'c']), [1]);
    });

    test('changedLineIndexes treats an appended (longer) file as a change at the new positions', () => {
      assert.deepStrictEqual(changedLineIndexes(['a', 'b'], ['a', 'b', 'c']), [2]);
    });

    test('renderDelta always includes SIGNAL_RE lines even when hash-unchanged', () => {
      const lines = ['ok one', 'ERROR two', 'ok three'];
      const out = renderDelta(lines, []);
      assert.ok(out.includes('L2: ERROR two'));
      assert.ok(!out.includes('L1: ok one'));
    });
  });
});

describe('grep match-list compression', () => {
  const H = require('../hooks/compress-tool-output.js');

  function grepContent(files, per) {
    const lines = [];
    for (const f of files)
      for (let i = 1; i <= per; i++) lines.push(`${f}:${i}: const value_${i} = ${'x'.repeat(60)};`);
    return lines.join('\n');
  }

  test('collapses beyond the per-file keep, appends counts and the marker', () => {
    const content = grepContent(['src/a.js', 'src/b.js'], 40);
    const out = H.compressGrep(content, []);
    assert.ok(out.length < content.length);
    assert.ok(out.includes('src/a.js: 40 matches, 3 shown'));
    assert.ok(out.includes('src/b.js: 40 matches, 3 shown'));
    assert.ok(out.includes('match lines omitted'));
    assert.ok(out.includes('src/a.js:3:'));
    assert.ok(!out.includes('src/a.js:4:'));
  });

  test('signal-shaped and prompt-named match lines survive past the keep limit', () => {
    const lines = [];
    for (let i = 1; i <= 30; i++) lines.push(`app.js:${i}: plain line ${'x'.repeat(50)}`);
    lines.push('app.js:31: throw new TypeError("boom")');
    lines.push('app.js:32: requires ioredis here');
    const out = H.compressGrep(lines.join('\n'), ['ioredis']);
    assert.ok(out.includes('app.js:31:'));
    assert.ok(out.includes('app.js:32:'));
    assert.ok(!out.includes('app.js:17:'));
  });

  test('drive-letter paths group as one file; unparseable lines pass verbatim', () => {
    const lines = [];
    for (let i = 1; i <= 10; i++) lines.push(`C:\\proj\\x.js:${i}: item ${'y'.repeat(40)}`);
    lines.push('-- a separator line that is not a match --');
    const out = H.compressGrep(lines.join('\n'), []);
    assert.ok(out.includes('C:\\proj\\x.js: 10 matches, 3 shown'));
    assert.ok(out.includes('-- a separator line that is not a match --'));
  });

  test('returns content unchanged when nothing collapses', () => {
    const content = grepContent(['a.js'], 3);
    assert.strictEqual(H.compressGrep(content, []), content);
  });

  test('single-file searches (bare line: prefix) collapse under the given label', () => {
    const lines = [];
    for (let i = 1; i <= 40; i++) lines.push(`${i}: const handler_${i} = wrap(${'r'.repeat(40)})`);
    const out = H.compressGrep(lines.join('\n'), [], 'big.js');
    assert.ok(out.length < lines.join('\n').length);
    assert.ok(out.includes('big.js: 40 matches, 3 shown'));
    assert.ok(out.includes('1: const handler_1'));
    assert.ok(!out.includes('4: const handler_4'));
  });

  test('too-common relevance tokens (the search pattern itself) do not defeat the collapse', () => {
    const lines = [];
    for (let i = 1; i <= 60; i++) lines.push(`app.js:${i}: uses redis pool ${'p'.repeat(40)}`);
    const out = H.compressGrep(lines.join('\n'), ['redis']);
    assert.ok(out.includes('app.js: 60 matches, 3 shown'), 'redis hits every line, so the token is dropped as too common');
  });

  test('hook rewrites an oversized Grep content result and mirrors the shape', () => {
    const content = grepContent(['src/a.js', 'src/b.js'], 40);
    const res = runHook('compress-tool-output.js', {
      tool_name: 'Grep',
      tool_input: { pattern: 'value', output_mode: 'content' },
      tool_response: { mode: 'content', numFiles: 2, filenames: [], content, numLines: 80, totalLines: 80 },
    });
    const out = hookOutput(res);
    assert.ok(out, 'expected a rewrite');
    const updated = out.hookSpecificOutput.updatedToolOutput;
    assert.strictEqual(updated.mode, 'content');
    assert.strictEqual(updated.totalLines, 80);
    assert.ok(updated.content.includes('match lines omitted'));
    assert.strictEqual(updated.numLines, updated.content.split('\n').length);
  });

  test('context-flagged, small, and disabled Grep results pass through silently', () => {
    const content = grepContent(['src/a.js'], 40);
    const base = {
      tool_name: 'Grep',
      tool_input: { pattern: 'value', output_mode: 'content', '-C': 2 },
      tool_response: { mode: 'content', numFiles: 1, filenames: [], content, numLines: 40, totalLines: 40 },
    };
    assert.strictEqual(hookOutput(runHook('compress-tool-output.js', base)), null, 'context flag');
    assert.strictEqual(
      hookOutput(runHook('compress-tool-output.js', { ...base, tool_input: { pattern: 'v' }, tool_response: { ...base.tool_response, content: 'a.js:1: tiny' } })),
      null,
      'small result'
    );
    assert.strictEqual(
      hookOutput(runHook('compress-tool-output.js', { ...base, tool_input: { pattern: 'v' } }, { HUSH_GREP: 'off' })),
      null,
      'HUSH_GREP=off'
    );
  });
});

describe('mcp exec-output compression', () => {
  const H = require('../hooks/compress-tool-output.js');

  function execText(exitCode, lines) {
    const output = Array.from({ length: lines }, (_, i) => `build step ${i}: copying module ${'z'.repeat(30)}`).join('\n');
    return JSON.stringify({ exitCode, output });
  }

  test('isMcpExecTool matches execute methods on any server alias', () => {
    assert.ok(H.isMcpExecTool('mcp__idea__execute_run_configuration'));
    assert.ok(H.isMcpExecTool('mcp__jetbrains__execute_terminal_command'));
    assert.ok(!H.isMcpExecTool('mcp__idea__read_file'));
    assert.ok(!H.isMcpExecTool('Bash'));
  });

  test('compresses the inner output field, preserves exitCode and the arrival shape', () => {
    const text = execText(0, 400);
    const res = H.compressMcpExec([{ type: 'text', text }], {});
    assert.ok(Array.isArray(res), 'array in, array out');
    const parsed = JSON.parse(res[0].text);
    assert.strictEqual(parsed.exitCode, 0);
    assert.ok(parsed.output.includes('[hush hook:'));
    assert.ok(res[0].text.length < text.length);
    const strRes = H.compressMcpExec(text, {});
    assert.strictEqual(typeof strRes, 'string', 'string in, string out');
  });

  test('failing exec keeps error lines under the larger failure cap', () => {
    const output = Array.from({ length: 300 }, (_, i) => `noise ${i} ${'q'.repeat(30)}`);
    output[298] = 'ERROR: compilation failed at module X';
    const text = JSON.stringify({ exitCode: 1, output: output.join('\n') });
    const res = H.compressMcpExec(text, {});
    assert.strictEqual(JSON.parse(res).exitCode, 1);
    assert.ok(JSON.parse(res).output.includes('ERROR: compilation failed at module X'));
  });

  test('passthrough on non-JSON, missing output field, and small payloads', () => {
    assert.strictEqual(H.compressMcpExec('not json '.repeat(300), {}), undefined);
    assert.strictEqual(H.compressMcpExec(JSON.stringify({ exitCode: 0, result: 'x'.repeat(3000) }), {}), undefined);
    assert.strictEqual(H.compressMcpExec(JSON.stringify({ exitCode: 0, output: 'short' }), {}), undefined);
  });

  test('hook routes exec tools and emits the rewritten envelope', () => {
    const text = execText(0, 400);
    const res = runHook('compress-tool-output.js', {
      tool_name: 'mcp__idea__execute_run_configuration',
      tool_response: [{ type: 'text', text }],
    });
    const out = hookOutput(res);
    assert.ok(out, 'expected a rewrite');
    const updated = out.hookSpecificOutput.updatedToolOutput;
    assert.ok(Array.isArray(updated));
    assert.ok(JSON.parse(updated[0].text).output.includes('[hush hook:'));
    assert.strictEqual(
      hookOutput(runHook('compress-tool-output.js', { tool_name: 'mcp__idea__execute_run_configuration', tool_response: [{ type: 'text', text }] }, { HUSH_MCP_EXEC: 'off' })),
      null,
      'HUSH_MCP_EXEC=off'
    );
  });
});

describe('host tool-results read capping', () => {
  const H = require('../hooks/compress-tool-output.js');
  const HOSTPATH = 'C:/Users/dev/.claude/projects/D--proj-slug/abcd1234-1111-2222-3333-444455556666/tool-results/toolu_01Xy.txt';

  function bigContent(lines) {
    const out = [];
    for (let i = 1; i <= lines; i++) out.push(`compile step ${i}: emitted module chunk ${'m'.repeat(40)}`);
    out[lines - 2] = 'ERROR EBUILD01: ReferenceError: retries is not defined';
    return out.join('\n');
  }

  test('isHostToolResultsPath matches only the .claude/projects tool-results shape', () => {
    assert.ok(H.isHostToolResultsPath(HOSTPATH));
    assert.ok(H.isHostToolResultsPath(HOSTPATH.replace(/\//g, '\\')));
    assert.ok(!H.isHostToolResultsPath('D:/myapp/tool-results/data.txt'), 'no .claude/projects ancestor');
    assert.ok(!H.isHostToolResultsPath('C:/Users/dev/.claude/projects/slug/sess/tool-results/x.log'), 'txt only');
    assert.ok(!H.isHostToolResultsPath('D:/src/index.js'));
  });

  test('a full read of a host tool-results file gets the failure-grade cap, signal kept', () => {
    const content = bigContent(600);
    const res = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: HOSTPATH },
      tool_response: { type: 'text', file: { filePath: HOSTPATH, content, numLines: 600, totalLines: 600 } },
    });
    const out = hookOutput(res);
    assert.ok(out, 'expected a rewrite');
    const updated = out.hookSpecificOutput.updatedToolOutput;
    assert.ok(updated.file.content.length < content.length);
    assert.ok(updated.file.content.includes('ReferenceError: retries'), 'signal line survives');
    assert.ok(updated.file.content.includes('[hush hook:'), 'marker present');
  });

  test('range reads and HUSH_TOOLRESULTS=off pass through untouched', () => {
    const content = bigContent(600);
    const base = {
      tool_name: 'Read',
      tool_input: { file_path: HOSTPATH, offset: 100, limit: 400 },
      tool_response: { type: 'text', file: { filePath: HOSTPATH, content, numLines: 400, totalLines: 600 } },
    };
    assert.strictEqual(hookOutput(runHook('compress-tool-output.js', base)), null, 'range read untouched');
    assert.strictEqual(
      hookOutput(runHook('compress-tool-output.js', { ...base, tool_input: { file_path: HOSTPATH } }, { HUSH_TOOLRESULTS: 'off' })),
      null,
      'flag off'
    );
  });
});
