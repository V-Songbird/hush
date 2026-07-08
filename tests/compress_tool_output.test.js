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
    assert.strictEqual(out[6], '[hush: 90 lines omitted, none with warnings/errors/failures]');
    assert.strictEqual(out[10], 'line 99');
  });

  test('omitted markers assert no signal was cut — so the model trusts the visible slice', () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i}`);
    lines[50] = 'WARN W1042 deprecated-api in src/legacy/adapter.js';
    const out = capLines(lines, 10).join('\n');
    // every omission marker carries the no-signal guarantee...
    for (const m of out.match(/\[hush: \d+ lines omitted[^\]]*\]/g)) {
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
    assert.strictEqual(out[6], '[hush: 90 lines omitted, none with warnings/errors/failures]');
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
    assert.match(updated.file.content, /\[hush: \d+ lines omitted, none with warnings\/errors\/failures\]/);
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
    assert.match(updated, /\[hush: \d+ lines omitted, none with warnings\/errors\/failures\]/);
  });

  test('object response compresses stdout, preserves shape and other fields', () => {
    const big = Array.from({ length: 500 }, (_, i) => `l${i}`).join('\n');
    const r = runHook('compress-tool-output.js', {
      tool_name: 'PowerShell',
      tool_response: { stdout: big, stderr: '', interrupted: false },
    });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.strictEqual(updated.interrupted, false);
    assert.match(updated.stdout, /\[hush: \d+ lines omitted, none with warnings\/errors\/failures\]/);
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
    assert.match(updated, /\[hush: \d+ lines omitted, none with warnings\/errors\/failures\]/);
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
