'use strict';

// Probe 9, Spec 1: HUSH_DEBUG=1 decision manifest. One JSON line per handled
// tool output — including every do-nothing path — appended to
// tmpdir/hush-debug-<session_id>.jsonl. Never emitted without the env gate;
// never changes what any compression path actually produces (see the
// `decision` side-channel comments in compress-tool-output.js).

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { runHook, hookOutput } = require('./helpers');
const { debugManifestPath, deliver } = require('../hooks/compress-tool-output');
const { buildRecord, recoveryGap } = require('../hooks/lib/transform-manifest');
const { sessionDir } = require('../hooks/lib/sidecar-store');

const sids = [];
function sid(label) {
  const id = `hush-debug-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sids.push(id);
  return id;
}
// Every test session takes its manifest file AND its sidecar directory with
// it: a sidecar-writing test that leaves the file behind grows tmpdir on every
// run of the suite.
after(() => {
  for (const id of sids) {
    fs.rmSync(debugManifestPath(id), { force: true });
    fs.rmSync(sessionDir(id), { recursive: true, force: true });
  }
});

function readManifest(sessionId) {
  const file = debugManifestPath(sessionId);
  if (!fs.existsSync(file)) return [];
  return fs.readFileSync(file, 'utf-8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

const uniqueLines = (n) => Array.from({ length: n }, (_, i) => `line ${i} of the fixture, unique content`).join('\n');

describe('HUSH_DEBUG manifest: gate', () => {
  test('off by default — no manifest file at all', () => {
    const id = sid('gate-off');
    // Pinned off explicitly: runHook inherits process.env, so an ambient
    // HUSH_DEBUG=1 in the developer's shell would otherwise turn this gate
    // test into a false failure.
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: uniqueLines(300) }, { HUSH_DEBUG: '0' });
    assert.strictEqual(fs.existsSync(debugManifestPath(id)), false);
  });

  test('HUSH_DEBUG=0 (or anything but "1") still stays off', () => {
    const id = sid('gate-zero');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: uniqueLines(300) }, { HUSH_DEBUG: '0' });
    assert.strictEqual(fs.existsSync(debugManifestPath(id)), false);
  });

  test('unwatched, unhandled tools never get a line, even with the gate on', () => {
    const id = sid('gate-unhandled');
    runHook('compress-tool-output.js', { tool_name: 'Glob', session_id: id, tool_response: 'x'.repeat(500) }, { HUSH_DEBUG: '1' });
    assert.deepStrictEqual(readManifest(id), []);
  });

  test('HUSH_DISABLE=1 suppresses the manifest too — nothing was handled', () => {
    const id = sid('gate-disabled');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: uniqueLines(300) }, { HUSH_DEBUG: '1', HUSH_DISABLE: '1' });
    assert.strictEqual(fs.existsSync(debugManifestPath(id)), false);
  });
});

describe('HUSH_DEBUG manifest: one honest line per decision path', () => {
  test('cap — a big passing shell output gets truncated', () => {
    const id = sid('cap');
    const body = uniqueLines(200); // well under sidecar's 15000 chars, well over the 60-line pass cap
    // uniqueLines shares one shape (only the number token varies) — pin
    // template-collapse off so this isolates capLines specifically.
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1', HUSH_TEMPLATE: 'off' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.tool, 'Bash');
    assert.strictEqual(entry.action, 'cap');
    assert.strictEqual(entry.bytesIn, body.length);
    assert.ok(entry.bytesOut < entry.bytesIn);
  });

  test('template-collapse — a run of same-shaped lines collapses but stays under the cap', () => {
    const id = sid('template');
    const lines = [
      ...Array.from({ length: 20 }, (_, i) => `INFO worker-${i} processing job ${8000 + i}`),
      'one-off line a', 'one-off line b',
    ];
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: lines.join('\n') }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'template-collapse');
    assert.ok(entry.bytesOut < entry.bytesIn);
  });

  test('enumerate-passthrough — a completeness prompt keeps a big-but-under-2000-line log whole', () => {
    const id = sid('enum');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-debug-enum-'));
    const transcriptFile = path.join(dir, 't.jsonl');
    fs.writeFileSync(transcriptFile, JSON.stringify({
      type: 'user', uuid: 'u1', origin: { kind: 'human' },
      message: { role: 'user', content: 'Report every warning: list each one, with file and code.' },
    }) + '\n');
    try {
      const body = Array.from({ length: 900 }, (_, i) => `[${i}] compile mod_${i} ... ok`).join('\n');
      runHook('compress-tool-output.js', {
        tool_name: 'Bash', session_id: id, transcript_path: transcriptFile,
        tool_input: { command: 'node build.js' }, tool_response: body,
      }, { HUSH_DEBUG: '1' });
      const [entry] = readManifest(id);
      assert.strictEqual(entry.action, 'enumerate-passthrough');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  test('scrub-only — ANSI stripped, nothing structural cut', () => {
    const id = sid('scrub');
    runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: id, tool_response: '\x1b[32mok\x1b[0m all good',
    }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'scrub-only');
    assert.ok(entry.bytesOut < entry.bytesIn);
  });

  test('passthrough — short clean Bash output, byte-identical', () => {
    const id = sid('pass-bash');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: 'ok\ndone' }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'passthrough');
    assert.strictEqual(entry.bytesIn, entry.bytesOut);
  });

  test('passthrough — a Read of an ordinary source file (not log/generated-shaped)', () => {
    const id = sid('pass-read');
    const content = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`).join('\n');
    runHook('compress-tool-output.js', {
      tool_name: 'Read', session_id: id,
      tool_input: { file_path: 'C:\\repo\\src\\big.js' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\src\\big.js', content, numLines: 500, startLine: 1, totalLines: 500 } },
    }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.tool, 'Read');
    assert.strictEqual(entry.action, 'passthrough');
    assert.strictEqual(entry.bytesIn, content.length);
    assert.strictEqual(entry.bytesOut, content.length);
  });

  test('sidecar — a very large shell output moves to a file behind a digest', () => {
    const id = sid('sidecar');
    const body = uniqueLines(500); // ~18KB: over SIDECAR_MIN_CHARS, under SIDECAR_SHELL_MAX
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'sidecar');
    assert.strictEqual(entry.bytesIn, body.length);
    assert.ok(entry.bytesOut < entry.bytesIn);
  });

  test('shell-guard-skip — a shell output at/above the host-truncation size skips the sidecar', () => {
    const id = sid('guard');
    const body = uniqueLines(900); // ~31KB: over SIDECAR_SHELL_MAX
    assert.ok(body.length >= 28000, 'fixture must clear SIDECAR_SHELL_MAX for this test to mean anything');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'shell-guard-skip');
  });

  // A failing run is the one output whose detail is evidence, so it takes the
  // recovery copy even past the host-truncation size the guard above steps
  // aside at — otherwise the inline cap is the only surviving record of it.
  test('sidecar — a FAILING shell output past the host-truncation size still gets a recovery copy', () => {
    const id = sid('fail-sidecar');
    const lines = Array.from({ length: 900 }, (_, i) => `line ${i} of the fixture, unique content`);
    lines[400] = "src/boot.ts(41,7): error TS2304: Cannot find name 'configure'.";
    lines.push('Build failed with exit code 1');
    const body = lines.join('\n');
    assert.ok(body.length >= 28000, 'fixture must clear SIDECAR_SHELL_MAX for this test to mean anything');

    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'sidecar');
    assert.strictEqual(entry.recovery, 'sidecar');
    assert.strictEqual(entry.retention, 'session');
    assert.strictEqual(entry.retrieval, false);
    assert.ok(entry.recoveryPath, 'the record names where the full failure output went');
    assert.ok(entry.omitted > 0);
    assert.strictEqual(entry.preserved + entry.omitted, entry.linesIn);
    assert.strictEqual(fs.readFileSync(entry.recoveryPath, 'utf-8'), body, 'the complete failure output is on disk');

    // The header claims only what it can: at this size the host may have cut
    // the tail before hush ever saw it, so "in full" is not on offer.
    const out = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(out, /was saved to \S+ as hush received it/);
    assert.doesNotMatch(out, /saved in full/);
  });

  test('object response (stdout/stderr) still emits exactly one combined line', () => {
    const id = sid('object');
    const body = uniqueLines(200);
    runHook('compress-tool-output.js', {
      tool_name: 'PowerShell', session_id: id, tool_response: { stdout: body, stderr: '', interrupted: false },
    }, { HUSH_DEBUG: '1', HUSH_TEMPLATE: 'off' });
    const manifest = readManifest(id);
    assert.strictEqual(manifest.length, 1, 'one line for the whole tool output, not one per field');
    assert.strictEqual(manifest[0].action, 'cap');
  });
});

describe('HUSH_DEBUG manifest: MCP table decisions', () => {
  function records(n = 30) {
    return Array.from({ length: n }, (_, i) => ({
      file: `src/main/kotlin/pkg/File${i}.kt`, line: i + 1, column: i % 3,
      snippet: `val x${i} = compute(${i}) // padding padding padding for width`,
      matchType: 'TEXT',
    }));
  }
  function errorRecords(n = 40) {
    // Every record is SIGNAL_RE-shaped (WARNING severity, one ERROR) — this
    // is hush's flagship target (get_file_problems-style diagnostics), where
    // the now-removed verbatim exemption used to route every record around
    // the table and reliably produce output BIGGER than the input.
    // renderMcpTable is lossless, so all of them flatten into rows same as
    // any other homogeneous payload.
    return Array.from({ length: n }, (_, i) => ({
      file: `src/main/kotlin/pkg/File${i}.kt`, line: i + 1, column: i % 3,
      snippet: `unresolved reference to compute in module ${i}`,
      severity: i === 0 ? 'ERROR' : 'WARNING',
      matchType: 'TEXT',
    }));
  }

  test('mcp-table — a big homogeneous payload renders smaller as a table', () => {
    const id = sid('mcp-table');
    const rs = records();
    const text = JSON.stringify(rs);
    runHook('compress-tool-output.js', { tool_name: 'mcp__idea__search_regex', session_id: id, tool_response: text }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'mcp-table');
    assert.strictEqual(entry.bytesIn, text.length);
    assert.ok(entry.bytesOut < entry.bytesIn);
  });

  test('mcp-table — regression: an all-WARNING/ERROR diagnostics payload (the flagship target) still renders smaller, not rejected', () => {
    const id = sid('mcp-diagnostics');
    const rs = errorRecords();
    const text = JSON.stringify(rs);
    assert.ok(text.length >= 2048, 'fixture must clear the MCP table eligibility floor');
    const r = runHook('compress-tool-output.js', { tool_name: 'mcp__idea__search_regex', session_id: id, tool_response: text }, { HUSH_DEBUG: '1' });
    const updated = hookOutput(r).hookSpecificOutput.updatedToolOutput;
    assert.match(updated, /MCP JSON records rendered as a schema table/);
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'mcp-table');
    assert.strictEqual(entry.bytesIn, text.length);
    const savings = 1 - entry.bytesOut / entry.bytesIn;
    assert.ok(savings >= 0.4, `expected >=40% smaller, got ${(savings * 100).toFixed(1)}%`);
  });

  test('passthrough — a measured MCP tool below the eligibility floor', () => {
    const id = sid('mcp-small');
    const text = JSON.stringify(records(2));
    runHook('compress-tool-output.js', { tool_name: 'mcp__idea__search_regex', session_id: id, tool_response: text }, { HUSH_DEBUG: '1' });
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'passthrough');
    assert.strictEqual(entry.bytesIn, entry.bytesOut);
  });
});

describe('Probe 9 Spec 2: adversarial no-op fixtures', () => {
  const created = [];
  after(() => { for (const f of created) fs.rmSync(f, { force: true }); });
  function sidecarFileFrom(digest) {
    const m = String(digest).match(/saved in full to ([^;]+);/);
    if (m) created.push(m[1].trim());
    return m ? m[1].trim() : null;
  }

  test('a ~20KB single-line minified JSON string: no corruption, no sidecar overclaim, honest manifest', () => {
    const id = sid('adv-json');
    const obj = { records: Array.from({ length: 400 }, (_, i) => ({ id: i, name: `item-${i}`, value: i * 3.14, flag: i % 2 === 0 })) };
    const minified = JSON.stringify(obj); // one line, no whitespace
    assert.strictEqual(minified.includes('\n'), false, 'fixture must be genuinely single-line');
    assert.ok(minified.length >= 20000, `fixture should be ~20KB (was ${minified.length})`);

    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: minified }, { HUSH_DEBUG: '1' });
    const out = hookOutput(r);
    assert.strictEqual(out, null, 'a single line has nothing to cut — hush stays silent rather than growing the output');
    assert.doesNotThrow(() => JSON.parse(minified), 'the ORIGINAL fixture is unaffected by hush — no mutation of source data');

    const [entry] = readManifest(id);
    // A single-line payload leaves buildSidecarDigest's head/tail trim nothing
    // to cut, so maybeSidecar bails (digest would be larger than the source)
    // and compress() falls through to the ordinary inline cap — also a no-op
    // for one line. No sidecar file is written, and the manifest reflects the
    // true no-op instead of a digest that grew past the input.
    assert.strictEqual(entry.action, 'passthrough');
    assert.strictEqual(entry.bytesIn, minified.length);
    assert.strictEqual(entry.bytesOut, entry.bytesIn);
  });

  test('a dense multi-line base64 blob sidecars cleanly and is never corrupted', () => {
    const id = sid('adv-b64');
    const raw = Buffer.alloc(14000);
    for (let i = 0; i < raw.length; i++) raw[i] = (i * 2654435761) % 256; // deterministic pseudo-random bytes
    const b64 = raw.toString('base64'); // dense, no natural line breaks
    const wrapped = b64.match(/.{1,76}/g).join('\n'); // PEM-style wrapping
    assert.ok(wrapped.length >= 15000, `fixture should clear the sidecar floor (was ${wrapped.length})`);

    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: wrapped }, { HUSH_DEBUG: '1' });
    const out = hookOutput(r);
    const updated = out ? out.hookSpecificOutput.updatedToolOutput : wrapped;
    assert.ok(updated.length <= wrapped.length, 'output never grows beyond input');

    const [entry] = readManifest(id);
    assert.ok(['sidecar', 'shell-guard-skip', 'cap'].includes(entry.action), `expected a graceful action, got ${entry.action}`);
    if (entry.action === 'sidecar') {
      const sideFile = sidecarFileFrom(updated);
      assert.ok(sideFile && fs.existsSync(sideFile));
      assert.strictEqual(fs.readFileSync(sideFile, 'utf8'), wrapped, 'no sidecar overclaim — full original bytes, unmangled');
    }
  });

  test('a small single-line JSON blob (under the sidecar floor) passes through with nothing to cut', () => {
    const id = sid('adv-json-small');
    const minified = JSON.stringify({ ok: true, items: Array.from({ length: 20 }, (_, i) => i) });
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Bash', session_id: id, tool_response: minified,
    }, { HUSH_DEBUG: '1', HUSH_SIDECAR: 'off' });
    assert.strictEqual(hookOutput(r), null, 'a single line under any cap has nothing to trim — hush stays silent');
    const [entry] = readManifest(id);
    assert.strictEqual(entry.action, 'passthrough');
    assert.strictEqual(entry.bytesIn, entry.bytesOut);
  });
});

// ROADMAP 164: one manifest contract for every Core transform, and the
// recovery boundary that goes with it.
describe('transform manifest: the record contract', () => {
  const RECORD_KEYS = [
    'action', 'bytesIn', 'bytesOut', 'fallback', 'linesIn', 'omitted',
    'preserved', 'recovery', 'recoveryPath', 'retention', 'retrieval', 'session', 'tool',
  ];
  function only(id) {
    const entries = readManifest(id);
    assert.strictEqual(entries.length, 1, `expected exactly one record, got ${entries.length}`);
    const e = entries[0];
    assert.deepStrictEqual(Object.keys(e).sort(), RECORD_KEYS, 'every record carries the whole contract');
    assert.strictEqual(e.session, id, 'the record names the session that owns it');
    assert.strictEqual(e.preserved + e.omitted, e.linesIn, 'preserved and omitted account for every input line');
    return e;
  }

  test('cap — omitted lines, recoverable by re-running the command', () => {
    const id = sid('rec-cap');
    const body = uniqueLines(200);
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1', HUSH_TEMPLATE: 'off' });
    const e = only(id);
    assert.strictEqual(e.action, 'cap');
    assert.strictEqual(e.tool, 'Bash');
    assert.ok(e.omitted > 0, 'a capped view left lines out');
    assert.strictEqual(e.recovery, 'rerun-command');
    assert.strictEqual(e.retention, 'none');
    assert.strictEqual(e.fallback, null);
  });

  test('sidecar — the recovery location is the file on disk, with its retention state', () => {
    const id = sid('rec-sidecar');
    const body = uniqueLines(500);
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });
    const e = only(id);
    assert.strictEqual(e.action, 'sidecar');
    assert.strictEqual(e.recovery, 'sidecar');
    assert.ok(e.recoveryPath, 'the record names where the full output went');
    assert.strictEqual(fs.existsSync(e.recoveryPath), true, 'the named recovery file is really there');
    assert.strictEqual(fs.readFileSync(e.recoveryPath, 'utf8'), body, 'and it holds the full input');
    assert.strictEqual(e.retention, 'session');
    assert.ok(e.omitted > 0);
  });

  test('a record is metadata only — no line of the output is ever in it', () => {
    const id = sid('rec-metadata');
    const secretish = ['unmistakable-payload-marker-alpha', ...Array.from({ length: 400 }, (_, i) => `row ${i} unmistakable-payload-marker-beta`)].join('\n');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: secretish }, { HUSH_DEBUG: '1' });
    const e = only(id);
    const serialized = JSON.stringify(e);
    assert.doesNotMatch(serialized, /unmistakable-payload-marker/, 'counts and paths only, never content');
  });

  test('passthrough — nothing omitted, nothing to recover', () => {
    const id = sid('rec-pass');
    const content = Array.from({ length: 500 }, (_, i) => `const x${i} = ${i};`).join('\n');
    runHook('compress-tool-output.js', {
      tool_name: 'Read', session_id: id,
      tool_input: { file_path: 'C:\\repo\\src\\big.js' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\src\\big.js', content, numLines: 500, startLine: 1, totalLines: 500 } },
    }, { HUSH_DEBUG: '1' });
    const e = only(id);
    assert.strictEqual(e.action, 'passthrough');
    assert.strictEqual(e.omitted, 0);
    assert.strictEqual(e.preserved, e.linesIn);
  });

  test('a Read hush does compress names the file itself as the recovery location', () => {
    const id = sid('rec-read');
    // Short lines on purpose: over the line cap, under the sidecar floor, so
    // this exercises the inline path rather than the sidecar's own recovery.
    const content = Array.from({ length: 300 }, (_, i) => `INFO request ${i}`).join('\n');
    assert.ok(content.length < 15000, 'fixture must stay under the sidecar floor');
    runHook('compress-tool-output.js', {
      tool_name: 'Read', session_id: id,
      tool_input: { file_path: 'C:\\repo\\logs\\app.log' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\logs\\app.log', content, numLines: 300, startLine: 1, totalLines: 300 } },
    }, { HUSH_DEBUG: '1' });
    const e = only(id);
    assert.ok(e.omitted > 0);
    assert.strictEqual(e.recovery, 'source-file');
    assert.strictEqual(e.recoveryPath, 'C:\\repo\\logs\\app.log');
  });

  test('grep-collapse — omitted match lines, recoverable by re-running the search', () => {
    const id = sid('rec-grep');
    const lines = [];
    for (const f of ['src/a.js', 'src/b.js']) {
      for (let i = 1; i <= 40; i++) lines.push(`${f}:${i}: const value_${i} = ${'x'.repeat(60)};`);
    }
    const content = lines.join('\n');
    runHook('compress-tool-output.js', {
      tool_name: 'Grep', session_id: id, tool_input: { pattern: 'value_', path: 'src' },
      tool_response: { mode: 'content', content, numLines: lines.length },
    }, { HUSH_DEBUG: '1' });
    const e = only(id);
    assert.strictEqual(e.action, 'grep-collapse');
    assert.strictEqual(e.omitted, 74, 'both files keep 3 of 40 matches');
    assert.strictEqual(e.recovery, 'rerun-command');
    assert.strictEqual(e.recoveryPath, 'src');
  });

  test('shell-guard-skip — the record states why the transform stepped aside', () => {
    const id = sid('rec-fallback');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: uniqueLines(900) }, { HUSH_DEBUG: '1' });
    const e = only(id);
    assert.strictEqual(e.action, 'shell-guard-skip');
    assert.match(e.fallback, /truncated by the host/);
  });

  test('delta — a changed re-read points back at the file it read', () => {
    const id = sid('rec-delta');
    const filePath = 'C:\\repo\\logs\\delta.log';
    const first = Array.from({ length: 80 }, (_, i) => `2026-07-28 INFO steady line ${i}`);
    const read = (lines) => runHook('compress-tool-output.js', {
      tool_name: 'Read', session_id: id, tool_input: { file_path: filePath },
      tool_response: { type: 'text', file: { filePath, content: lines.join('\n'), numLines: lines.length, startLine: 1, totalLines: lines.length } },
    }, { HUSH_DEBUG: '1' });
    read(first);
    const second = [...first];
    second[40] = '2026-07-28 INFO steady line 40 (rewritten)';
    read(second);
    const entries = readManifest(id);
    const e = entries[entries.length - 1];
    assert.strictEqual(e.action, 'delta');
    assert.ok(e.omitted > 0, 'unchanged lines are not shown');
    assert.strictEqual(e.recovery, 'source-file');
    assert.strictEqual(e.recoveryPath, filePath);
    assert.strictEqual(e.preserved + e.omitted, e.linesIn);
  });

  test('mcp-table — lossless, so nothing is omitted and nothing needs recovering', () => {
    const id = sid('rec-mcp');
    const rs = Array.from({ length: 30 }, (_, i) => ({
      file: `src/File${i}.kt`, line: i + 1, column: i % 3,
      snippet: `val x${i} = compute(${i}) // padding padding padding for width`, matchType: 'TEXT',
    }));
    runHook('compress-tool-output.js', { tool_name: 'mcp__idea__search_regex', session_id: id, tool_response: JSON.stringify(rs) }, { HUSH_DEBUG: '1' });
    const e = only(id);
    assert.strictEqual(e.action, 'mcp-table');
    assert.strictEqual(e.omitted, 0);
    assert.ok(e.bytesOut < e.bytesIn);
  });
});

describe('transform manifest: the recovery boundary', () => {
  test('a lossy transform that omitted lines without a recovery location is a gap', () => {
    const gap = recoveryGap(buildRecord({ tool: 'Bash', action: 'cap', linesIn: 100, omitted: 40 }));
    assert.match(gap, /cap omitted 40 lines with no recovery location/);
  });

  test('naming a file-backed recovery without the path is a gap too', () => {
    assert.match(
      recoveryGap(buildRecord({ action: 'sidecar', linesIn: 100, omitted: 90, recovery: 'sidecar' })),
      /no path/
    );
    assert.match(
      recoveryGap(buildRecord({ action: 'delta', linesIn: 100, omitted: 90, recovery: 'source-file' })),
      /no path/
    );
  });

  test('no gap when the record backs the view', () => {
    assert.strictEqual(recoveryGap(buildRecord({ action: 'cap', linesIn: 100, omitted: 40, recovery: 'rerun-command' })), null);
    assert.strictEqual(recoveryGap(buildRecord({ action: 'sidecar', linesIn: 100, omitted: 90, recovery: 'sidecar', recoveryPath: '/tmp/x.txt' })), null);
  });

  test('a lossy transform that happened to omit nothing has nothing to recover', () => {
    assert.strictEqual(recoveryGap(buildRecord({ action: 'cap', linesIn: 100, omitted: 0 })), null);
  });

  test('a dedupe-only view is lossy too — a line stated as a count is not in the view', () => {
    assert.match(recoveryGap(buildRecord({ action: 'scrub-only', linesIn: 100, omitted: 3 })), /no recovery location/);
    assert.match(recoveryGap(buildRecord({ action: 'enumerate-passthrough', linesIn: 100, omitted: 3 })), /no recovery location/);
  });

  test('the two actions that keep every input line never need recovery metadata', () => {
    for (const action of ['passthrough', 'mcp-table']) {
      assert.strictEqual(recoveryGap(buildRecord({ action, linesIn: 100, omitted: 5 })), null, action);
    }
  });

  test('transformed output is not emitted when the record cannot back it', () => {
    const id = sid('boundary-drop');
    const writes = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
    process.env.HUSH_DEBUG = '1';
    try {
      deliver(
        { action: 'cap', bytesIn: 400, bytesOut: 90, linesIn: 100, omitted: 40 },
        'a rewritten view with detail removed',
        { tool_name: 'Bash', session_id: id }
      );
    } finally {
      process.stdout.write = original;
      delete process.env.HUSH_DEBUG;
    }
    assert.deepStrictEqual(writes, [], 'the rewrite is dropped — the original output stands');
    const [e] = readManifest(id);
    assert.strictEqual(e.action, 'rejected-no-recovery');
    assert.match(e.fallback, /no recovery location/);
    assert.strictEqual(e.bytesOut, e.bytesIn, 'nothing was delivered, so nothing was saved');
  });

  test('the same view IS emitted once the record names where the detail went', () => {
    const id = sid('boundary-pass');
    const writes = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
    process.env.HUSH_DEBUG = '1';
    try {
      deliver(
        { action: 'cap', bytesIn: 400, bytesOut: 90, linesIn: 100, omitted: 40, recovery: 'rerun-command' },
        'a rewritten view with detail removed',
        { tool_name: 'Bash', session_id: id }
      );
    } finally {
      process.stdout.write = original;
      delete process.env.HUSH_DEBUG;
    }
    assert.strictEqual(writes.length, 1);
    assert.strictEqual(JSON.parse(writes[0]).hookSpecificOutput.updatedToolOutput, 'a rewritten view with detail removed');
    const [e] = readManifest(id);
    assert.strictEqual(e.action, 'cap');
  });

  test('records are built and checked with the debug gate off — only the file write is gated', () => {
    const id = sid('boundary-ungated');
    const writes = [];
    const original = process.stdout.write;
    process.stdout.write = (chunk) => { writes.push(String(chunk)); return true; };
    // Pinned off: an ambient HUSH_DEBUG=1 in the developer's shell would
    // otherwise turn this gate assertion into a false failure.
    const prevDebug = process.env.HUSH_DEBUG;
    delete process.env.HUSH_DEBUG;
    try {
      deliver(
        { action: 'cap', bytesIn: 400, bytesOut: 90, linesIn: 100, omitted: 40 },
        'a rewritten view with detail removed',
        { tool_name: 'Bash', session_id: id }
      );
    } finally {
      process.stdout.write = original;
      if (prevDebug !== undefined) process.env.HUSH_DEBUG = prevDebug;
    }
    assert.deepStrictEqual(writes, [], 'the boundary still holds without HUSH_DEBUG');
    assert.strictEqual(fs.existsSync(debugManifestPath(id)), false, 'and nothing was persisted');
  });
});

describe('Probe 9 Spec 4: passthrough invariant (byte-identical, end to end)', () => {
  test('short clean Bash output: hook stays silent, nothing enters the tool result', () => {
    const r = runHook('compress-tool-output.js', { tool_name: 'Bash', tool_response: 'all good\n3 tests passed' });
    assert.strictEqual(hookOutput(r), null);
  });

  test('a Read of an ordinary (non-log, non-generated) file: content is the exact same object shape, byte-identical text', () => {
    const content = 'export function add(a, b) {\n  return a + b;\n}\n';
    const r = runHook('compress-tool-output.js', {
      tool_name: 'Read',
      tool_input: { file_path: 'C:\\repo\\src\\math.js' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\src\\math.js', content, numLines: 3, startLine: 1, totalLines: 3 } },
    });
    assert.strictEqual(hookOutput(r), null, 'no rewrite at all — untouched shape, untouched bytes');
  });

  test('a non-watched, non-MCP tool never gets touched, regardless of size', () => {
    const big = 'z'.repeat(50000);
    const r = runHook('compress-tool-output.js', { tool_name: 'TodoWrite', tool_response: big });
    assert.strictEqual(hookOutput(r), null);
  });

  test('an unmeasured MCP tool method: response passes through untouched, whatever its size', () => {
    const big = JSON.stringify({ results: Array.from({ length: 50 }, (_, i) => ({ a: i, b: `x${i}` })) });
    const r = runHook('compress-tool-output.js', { tool_name: 'mcp__idea__read_file', tool_response: big });
    assert.strictEqual(hookOutput(r), null);
  });
});
