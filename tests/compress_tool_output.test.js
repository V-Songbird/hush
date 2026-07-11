'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHook, hookOutput } = require('./helpers');
const {
  stripAnsi,
  resolveCarriageReturns,
  dedupeConsecutive,
  capLines,
  looksLikeFailure,
  isFileDump,
  isLogPath,
  requestsEnumeration,
  compress,
  firstLine,
  extractWrappedExit,
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
    const big = Array.from({ length: 1000 }, (_, i) => `unique line ${i}`).join('\n');
    const pass = compress(big, 0).split('\n').length;
    const fail = compress(big, 1).split('\n').length;
    assert.ok(pass < fail, `pass cap ${pass} should be tighter than fail cap ${fail}`);
    assert.ok(pass <= 61);
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
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: 'C:\\repo\\logs\\app.log' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\logs\\app.log', content, numLines: 900, startLine: 1, totalLines: 900 } },
    });
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
    const r = runHook('compress-tool-output.js', { tool_name: 'PowerShell', tool_response: raw });
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
