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
const { debugManifestPath } = require('../hooks/compress-tool-output');

const sids = [];
function sid(label) {
  const id = `hush-debug-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  sids.push(id);
  return id;
}
after(() => {
  for (const id of sids) fs.rmSync(debugManifestPath(id), { force: true });
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
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: uniqueLines(300) });
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
