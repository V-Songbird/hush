'use strict';

// Probe 9 Spec 1 ingestion: benchmarks/runner/metrics.js reads hush's
// HUSH_DEBUG manifest when present, fail-soft when absent. All local/pure —
// no `claude` CLI invocation, no cost.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const { parseTranscript, readDebugManifest } = require('../benchmarks/runner/metrics.js');
const { debugManifestPath } = require('../hooks/compress-tool-output');

describe('parseTranscript: session id', () => {
  test('captures session_id from the system/init event', () => {
    const jsonl = [
      JSON.stringify({ type: 'system', subtype: 'init', session_id: 'abc-123', model: 'claude', output_style: 'default' }),
      JSON.stringify({ type: 'result', total_cost_usd: 0.01, result: 'done' }),
    ].join('\n');
    const m = parseTranscript(jsonl);
    assert.strictEqual(m.sessionId, 'abc-123');
  });

  test('no init event -> sessionId stays null', () => {
    const m = parseTranscript(JSON.stringify({ type: 'result', result: 'done' }));
    assert.strictEqual(m.sessionId, null);
  });
});

describe('readDebugManifest: fail-soft ingestion', () => {
  const created = [];
  after(() => { for (const f of created) fs.rmSync(f, { force: true }); });

  test('no session id -> null, no throw', () => {
    assert.strictEqual(readDebugManifest(null), null);
    assert.strictEqual(readDebugManifest(undefined), null);
  });

  test('a session id with no manifest file on disk -> null, no throw', () => {
    assert.strictEqual(readDebugManifest('hush-test-no-such-session-xyz'), null);
  });

  test('aggregates a real manifest into per-action counts and byte totals', () => {
    const sessionId = `hush-test-metrics-${process.pid}-${Date.now()}`;
    const file = debugManifestPath(sessionId);
    created.push(file);
    const lines = [
      { tool: 'Bash', bytesIn: 5000, bytesOut: 1200, action: 'cap' },
      { tool: 'Bash', bytesIn: 200, bytesOut: 200, action: 'passthrough' },
      { tool: 'Read', bytesIn: 20000, bytesOut: 900, action: 'sidecar' },
    ];
    fs.writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');

    const summary = readDebugManifest(sessionId);
    assert.strictEqual(summary.entries, 3);
    assert.deepStrictEqual(summary.byAction, { cap: 1, passthrough: 1, sidecar: 1 });
    assert.strictEqual(summary.bytesIn, 25200);
    assert.strictEqual(summary.bytesOut, 2300);
  });

  test('a malformed line is skipped, not fatal', () => {
    const sessionId = `hush-test-metrics-malformed-${process.pid}-${Date.now()}`;
    const file = debugManifestPath(sessionId);
    created.push(file);
    fs.writeFileSync(file, 'not json\n' + JSON.stringify({ tool: 'Bash', bytesIn: 10, bytesOut: 5, action: 'cap' }) + '\n');

    const summary = readDebugManifest(sessionId);
    assert.strictEqual(summary.entries, 2, 'entries counts raw lines, byAction only counts parseable ones');
    assert.deepStrictEqual(summary.byAction, { cap: 1 });
  });
});

describe('runCheck: keyword corpus', () => {
  const { runCheck } = require('../benchmarks/runner/metrics.js');
  const os = require('os');
  const path = require('path');

  test('orFiles folds a created source file into the scored corpus', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-runcheck-'));
    try {
      fs.writeFileSync(path.join(dir, 'validator.py'), 'import re\ndef is_valid(email):\n    return re.match(r".+@.+", email) is not None\n');
      const check = { type: 'keywords', orFiles: '.py', require: 2, patterns: ['def \\w+\\(', '@', 'return|re\\.'] };
      assert.strictEqual(runCheck(check, 'Created validator.py with the function.', dir).pass, true);
      assert.strictEqual(runCheck({ ...check, orFiles: undefined }, 'Created validator.py with the function.', dir).pass, false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
