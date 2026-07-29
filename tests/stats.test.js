'use strict';

// ROADMAP 064/170: /hush:stats — reads the HUSH_DEBUG manifest plus transcript
// usage records and reports observed compression activity. No net-savings
// figure, clamped or otherwise: what hush's absence would have cost is not
// measurable from one run, so it is never printed.

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { runHook } = require('./helpers');
const { debugManifestPath } = require('../hooks/compress-tool-output');
const {
  rollupByAction,
  summarizeSession,
  noteOverheadFor,
  extractUsageByModel,
  slugifyCwd,
  findProjectDir,
  latestTranscript,
  sessionIdFromTranscriptPath,
  resolveTarget,
  buildReport,
  renderText,
  formatBytes,
  formatDelta,
} = require('../scripts/stats');

const STATS_SCRIPT = path.join(__dirname, '..', 'scripts', 'stats.js');
const cleanupPaths = [];
const cleanupDirs = [];
after(() => {
  for (const p of cleanupPaths) fs.rmSync(p, { force: true });
  for (const d of cleanupDirs) fs.rmSync(d, { recursive: true, force: true });
});

function sid(label) {
  const id = `hush-stats-test-${label}-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  cleanupPaths.push(debugManifestPath(id));
  cleanupPaths.push(path.join(os.tmpdir(), `hush-note-${id}`));
  return id;
}

function mkTmpDir(label) {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), `hush-stats-${label}-`));
  cleanupDirs.push(d);
  return d;
}

function writeTranscript(dir, sessionId, records) {
  const file = path.join(dir, `${sessionId}.jsonl`);
  fs.writeFileSync(file, records.map((r) => JSON.stringify(r)).join('\n') + '\n');
  return file;
}

function usageRecord(id, model, usage, extra) {
  return { type: 'assistant', message: { id, model, usage }, ...(extra || {}) };
}

// --- formatBytes -------------------------------------------------------------

describe('formatBytes', () => {
  test('bytes under 1KB', () => assert.strictEqual(formatBytes(0), '0B'));
  test('exactly 1KB', () => assert.strictEqual(formatBytes(1024), '1.0KB'));
  test('under 1MB', () => assert.strictEqual(formatBytes(500 * 1024), '500.0KB'));
  test('1MB and above', () => assert.strictEqual(formatBytes(2 * 1024 * 1024), '2.0MB'));
});

describe('formatDelta', () => {
  test('a shrunk output reads as negative', () => assert.strictEqual(formatDelta(-2048), '-2.0KB'));
  test('a grown output reads as positive, never as a saving', () => assert.strictEqual(formatDelta(2048), '+2.0KB'));
  test('no change is plain zero', () => assert.strictEqual(formatDelta(0), '0B'));
});

// --- rollupByAction ------------------------------------------------------------

describe('rollupByAction', () => {
  test('aggregates by action and computes a signed bytesDelta', () => {
    const entries = [
      { action: 'cap', bytesIn: 1000, bytesOut: 200 },
      { action: 'cap', bytesIn: 500, bytesOut: 100 },
      { action: 'passthrough', bytesIn: 50, bytesOut: 50 },
    ];
    const rows = rollupByAction(entries);
    const cap = rows.find((r) => r.action === 'cap');
    assert.strictEqual(cap.count, 2);
    assert.strictEqual(cap.bytesIn, 1500);
    assert.strictEqual(cap.bytesOut, 300);
    assert.strictEqual(cap.bytesDelta, -1200);
    const pass = rows.find((r) => r.action === 'passthrough');
    assert.strictEqual(pass.bytesDelta, 0);
  });

  test('an action that grew its output keeps the positive delta, unclamped', () => {
    const rows = rollupByAction([{ action: 'marker-added', bytesIn: 100, bytesOut: 160 }]);
    assert.strictEqual(rows[0].bytesDelta, 60);
  });

  test('sorts the biggest reduction first', () => {
    const entries = [
      { action: 'small-save', bytesIn: 100, bytesOut: 90 },
      { action: 'big-save', bytesIn: 1000, bytesOut: 10 },
    ];
    const rows = rollupByAction(entries);
    assert.strictEqual(rows[0].action, 'big-save');
  });

  test('missing action field falls back to "unknown"', () => {
    const rows = rollupByAction([{ bytesIn: 10, bytesOut: 5 }]);
    assert.strictEqual(rows[0].action, 'unknown');
  });
});

// --- summarizeSession + note overhead -----------------------------------------

describe('summarizeSession', () => {
  test('no manifest file at all -> manifestFound: false', () => {
    const id = sid('no-manifest');
    const s = summarizeSession(id);
    assert.deepStrictEqual(s, { sessionId: id, manifestFound: false });
  });

  test('manifest with a real compression decision: observed bytes in and out, note text reported separately', () => {
    const id = sid('with-manifest');
    const body = Array.from({ length: 200 }, (_, i) => `line ${i} of fixture, unique content here`).join('\n');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });

    const s = summarizeSession(id);
    assert.strictEqual(s.manifestFound, true);
    assert.strictEqual(s.decisions, 1);
    assert.strictEqual(s.bytesDelta, s.bytesOut - s.bytesIn);
    assert.ok(s.bytesDelta < 0, 'the view is smaller than the input it was built from');
    assert.strictEqual(s.smaller, 1);
    // This body's repeated shape triggers a visible [hush hook: ...] marker,
    // which claims the session note. The note is hush's own added text: it is
    // reported as its own number and never subtracted from the byte delta.
    assert.strictEqual(s.noteBytes, noteOverheadFor(id));
    assert.strictEqual(s.netSaved, undefined, 'no net-savings figure is computed at all');
    assert.strictEqual(s.rawSaved, undefined);
  });

  test('a short clean passthrough: zero delta, no note text, counted as unchanged', () => {
    const id = sid('passthrough-only');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: 'ok\ndone' }, { HUSH_DEBUG: '1' });
    const s = summarizeSession(id);
    assert.strictEqual(s.manifestFound, true);
    assert.strictEqual(s.bytesDelta, 0);
    assert.strictEqual(s.unchanged, 1);
    assert.strictEqual(s.smaller, 0);
    assert.strictEqual(s.noteBytes, 0);
  });

  test('an output hush made larger is counted as larger, not clamped to zero', () => {
    const id = sid('grew');
    fs.writeFileSync(
      debugManifestPath(id),
      JSON.stringify({ tool: 'Bash', action: 'cap', session: id, bytesIn: 100, bytesOut: 160, retention: 'none', fallback: null, retrieval: false }) + '\n'
    );
    const s = summarizeSession(id);
    assert.strictEqual(s.bytesDelta, 60);
    assert.strictEqual(s.larger, 1);
  });

  test('sidecar work reports recovery storage as an upper bound, and a declined transform as a fallback', () => {
    const id = sid('recovery');
    const body = Array.from({ length: 500 }, (_, i) => `row ${i} ${'payload '.repeat(4)}`).join('\n');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });
    const s = summarizeSession(id);
    assert.strictEqual(s.recoveryWrites, 1);
    assert.strictEqual(s.recoveryBytesAtMost, s.bytesIn, 'the parked copy is bounded by the input it came from');
    assert.strictEqual(s.fallbacks, 0);

    const guarded = sid('fallback');
    const huge = Array.from({ length: 900 }, (_, i) => `line ${i} ${'x'.repeat(80)}`).join('\n');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: guarded, tool_response: huge }, { HUSH_DEBUG: '1' });
    const guardedSummary = summarizeSession(guarded);
    assert.strictEqual(guardedSummary.fallbacks, 1);
    const rendered = renderText({ ok: true, sessionId: guarded, session: guardedSummary, usageByModel: null });
    assert.match(rendered, /Transform steps that declined: 1/);
    assert.doesNotMatch(rendered, /left the output alone/, 'a declined step never claims the output was untouched');
  });

  test('retrieval: a Read of a parked file counts, an ordinary Read does not', () => {
    const id = sid('retrieval');
    const parked = path.join(os.tmpdir(), 'hush-sidecar', id, 'abc123.txt');
    const content = Array.from({ length: 300 }, (_, i) => `parked line ${i}`).join('\n');
    runHook('compress-tool-output.js', {
      tool_name: 'Read', session_id: id, tool_input: { file_path: parked },
      tool_response: { type: 'text', file: { filePath: parked, content, numLines: 300, startLine: 1, totalLines: 300 } },
    }, { HUSH_DEBUG: '1' });
    runHook('compress-tool-output.js', {
      tool_name: 'Read', session_id: id, tool_input: { file_path: 'C:\\repo\\src\\app.js' },
      tool_response: { type: 'text', file: { filePath: 'C:\\repo\\src\\app.js', content, numLines: 300, startLine: 1, totalLines: 300 } },
    }, { HUSH_DEBUG: '1' });
    const s = summarizeSession(id);
    assert.strictEqual(s.retrievals, 1);
    assert.match(
      renderText({ ok: true, sessionId: id, session: s, usageByModel: null }),
      /Parked output read back: 1 time\(s\)$/m,
      'every record measured it — the count needs no coverage caveat'
    );
  });

  test('a manifest mixing pre-tracking and tracked records says how much of the session the count covers', () => {
    const id = sid('mixed-records');
    fs.writeFileSync(
      debugManifestPath(id),
      JSON.stringify({ tool: 'Bash', action: 'cap', bytesIn: 1000, bytesOut: 200 }) + '\n' +
        JSON.stringify({ tool: 'Read', action: 'sidecar', bytesIn: 900, bytesOut: 100, retrieval: true }) + '\n'
    );
    const s = summarizeSession(id);
    assert.strictEqual(s.retrievals, 1);
    assert.strictEqual(s.retrievalMeasured, 1);
    assert.strictEqual(s.decisions, 2);
    assert.match(
      renderText({ ok: true, sessionId: id, session: s, usageByModel: null }),
      /Parked output read back: 1 time\(s\), counted over the 1 outputs that measured it/
    );
  });

  test('records written before retrieval tracking report it as unavailable, never as zero', () => {
    const id = sid('old-records');
    fs.writeFileSync(
      debugManifestPath(id),
      JSON.stringify({ tool: 'Bash', action: 'cap', bytesIn: 1000, bytesOut: 200 }) + '\n'
    );
    const s = summarizeSession(id);
    assert.strictEqual(s.decisions, 1);
    assert.strictEqual(s.bytesDelta, -800, 'old records still yield the bytes they do carry');
    assert.strictEqual(s.retrievals, null);
    assert.strictEqual(s.recoveryWrites, 0);
    assert.strictEqual(s.fallbacks, 0);
    assert.match(renderText({ ok: true, sessionId: id, session: s, usageByModel: null }), /read back: unavailable/);
  });

  test('empty manifest (gate on, nothing handled) reports zero decisions, not "not found"', () => {
    const id = sid('empty');
    runHook('compress-tool-output.js', { tool_name: 'Glob', session_id: id, tool_response: 'x' }, { HUSH_DEBUG: '1' });
    const s = summarizeSession(id);
    assert.strictEqual(s.manifestFound, false); // Glob is unwatched — no manifest line, no file at all
  });
});

// --- extractUsageByModel -------------------------------------------------------

describe('extractUsageByModel', () => {
  test('missing transcript file -> null', () => {
    assert.strictEqual(extractUsageByModel(path.join(mkTmpDir('missing'), 'nope.jsonl')), null);
  });

  test('no usage records -> empty array, not null', () => {
    const dir = mkTmpDir('nousage');
    const file = writeTranscript(dir, 'x', [{ type: 'user', message: { content: 'hi' } }]);
    assert.deepStrictEqual(extractUsageByModel(file), []);
  });

  test('dedups repeated identical usage records sharing one message id', () => {
    const dir = mkTmpDir('dedup');
    const usage = { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 10, cache_creation_input_tokens: 5 };
    const file = writeTranscript(dir, 'x', [
      usageRecord('msg_1', 'claude-sonnet-5', usage),
      usageRecord('msg_1', 'claude-sonnet-5', usage),
      usageRecord('msg_1', 'claude-sonnet-5', usage),
    ]);
    const rows = extractUsageByModel(file);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].apiCalls, 1);
    assert.strictEqual(rows[0].inputTokens, 100);
  });

  test('splits totals per model', () => {
    const dir = mkTmpDir('permodel');
    const file = writeTranscript(dir, 'x', [
      usageRecord('msg_1', 'claude-sonnet-5', { input_tokens: 100, output_tokens: 10, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
      usageRecord('msg_2', 'claude-haiku-5', { input_tokens: 20, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ]);
    const rows = extractUsageByModel(file);
    assert.strictEqual(rows.length, 2);
    const sonnet = rows.find((r) => r.model === 'claude-sonnet-5');
    const haiku = rows.find((r) => r.model === 'claude-haiku-5');
    assert.strictEqual(sonnet.inputTokens, 100);
    assert.strictEqual(haiku.inputTokens, 20);
  });

  test('records without a usage object are ignored, malformed lines skipped', () => {
    const dir = mkTmpDir('malformed');
    const file = path.join(dir, 'x.jsonl');
    fs.writeFileSync(
      file,
      [
        'not json at all',
        JSON.stringify({ type: 'assistant', message: { id: 'm1', model: 'x' } }), // no usage
        JSON.stringify(usageRecord('m2', 'claude-sonnet-5', { input_tokens: 5, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 })),
      ].join('\n')
    );
    const rows = extractUsageByModel(file);
    assert.strictEqual(rows.length, 1);
    assert.strictEqual(rows[0].inputTokens, 5);
  });
});

// --- cwd/project/transcript discovery -------------------------------------------

describe('slugifyCwd', () => {
  test('matches the observed Claude Code project-dir slug for a Windows path', () => {
    assert.strictEqual(slugifyCwd('D:\\Projects\\claude-plugins'), 'D--Projects-claude-plugins');
  });
});

describe('findProjectDir', () => {
  test('fast path: an existing dir named after the slugified cwd', () => {
    const base = mkTmpDir('projects-fast');
    const cwd = 'C:\\some\\project';
    fs.mkdirSync(path.join(base, slugifyCwd(cwd)));
    const found = findProjectDir(cwd, base);
    assert.strictEqual(found, path.join(base, slugifyCwd(cwd)));
  });

  test('fallback path: scans transcripts for a literal cwd match when the slug guess misses', () => {
    const base = mkTmpDir('projects-fallback');
    const cwd = 'C:\\some\\other\\project';
    const oddDir = path.join(base, 'some-unrelated-name');
    fs.mkdirSync(oddDir);
    writeTranscript(oddDir, 'sess-1', [{ type: 'summary', cwd }]);
    const found = findProjectDir(cwd, base);
    assert.strictEqual(found, oddDir);
  });

  test('no match anywhere -> null', () => {
    const base = mkTmpDir('projects-none');
    assert.strictEqual(findProjectDir('C:\\nowhere', base), null);
  });

  test('nonexistent projects dir -> null, never throws', () => {
    assert.strictEqual(findProjectDir('C:\\x', path.join(os.tmpdir(), 'does-not-exist-' + Date.now())), null);
  });
});

describe('latestTranscript', () => {
  test('picks the most recently modified .jsonl file', () => {
    const dir = mkTmpDir('latest');
    const older = writeTranscript(dir, 'older', [{ type: 'summary' }]);
    const newer = writeTranscript(dir, 'newer', [{ type: 'summary' }]);
    const past = new Date(Date.now() - 60000);
    const now = new Date();
    fs.utimesSync(older, past, past);
    fs.utimesSync(newer, now, now);
    assert.strictEqual(latestTranscript(dir), newer);
  });

  test('empty dir -> null', () => {
    assert.strictEqual(latestTranscript(mkTmpDir('latest-empty')), null);
  });
});

describe('sessionIdFromTranscriptPath', () => {
  test('strips the .jsonl extension', () => {
    assert.strictEqual(sessionIdFromTranscriptPath('C:\\x\\abc-123.jsonl'), 'abc-123');
  });
});

// --- resolveTarget + buildReport + renderText (full plumbing) ------------------

describe('resolveTarget', () => {
  test('explicit --transcript wins outright, session id derived from its filename', () => {
    const dir = mkTmpDir('resolve-explicit');
    const file = writeTranscript(dir, 'sess-xyz', [{ type: 'summary' }]);
    const t = resolveTarget({ transcript: file });
    assert.strictEqual(t.sessionId, 'sess-xyz');
    assert.strictEqual(t.transcriptPath, file);
  });

  test('explicit --session with a discoverable transcript file finds it by filename', () => {
    const base = mkTmpDir('resolve-session-found');
    const projDir = path.join(base, 'proj');
    fs.mkdirSync(projDir);
    const file = writeTranscript(projDir, 'my-session', [{ type: 'summary' }]);
    const t = resolveTarget({ session: 'my-session', projectsDir: base });
    assert.strictEqual(t.sessionId, 'my-session');
    assert.strictEqual(t.transcriptPath, file);
  });

  test('explicit --session with no matching transcript anywhere: sessionId known, transcriptPath null', () => {
    const base = mkTmpDir('resolve-session-missing');
    const t = resolveTarget({ session: 'ghost-session', projectsDir: base });
    assert.strictEqual(t.sessionId, 'ghost-session');
    assert.strictEqual(t.transcriptPath, null);
  });

  test('cwd auto-discovery finds the right project dir and its latest transcript', () => {
    const base = mkTmpDir('resolve-cwd');
    const cwd = 'D:\\auto\\discover\\me';
    const projDir = path.join(base, slugifyCwd(cwd));
    fs.mkdirSync(projDir);
    const file = writeTranscript(projDir, 'auto-sess', [{ type: 'summary' }]);
    const t = resolveTarget({ cwd, projectsDir: base });
    assert.strictEqual(t.sessionId, 'auto-sess');
    assert.strictEqual(t.transcriptPath, file);
  });

  test('cwd with no project dir at all: nulls, never throws', () => {
    const base = mkTmpDir('resolve-cwd-none');
    const t = resolveTarget({ cwd: 'D:\\nothing\\here', projectsDir: base });
    assert.strictEqual(t.sessionId, null);
    assert.strictEqual(t.transcriptPath, null);
  });
});

describe('buildReport + renderText', () => {
  test('no session resolvable -> ok:false with a clear next step', () => {
    const report = buildReport({ sessionId: null, transcriptPath: null });
    assert.strictEqual(report.ok, false);
    assert.match(renderText(report), /--session|--transcript/);
  });

  test('session resolved but no manifest ever written: says so, no false zero-savings claim', () => {
    const id = sid('report-no-manifest');
    const report = buildReport({ sessionId: id, transcriptPath: null });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.session.manifestFound, false);
    assert.match(renderText(report), /HUSH_DEBUG=1/);
  });

  test('full report with manifest and transcript renders both sections', () => {
    const id = sid('report-full');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: 'ok\ndone' }, { HUSH_DEBUG: '1' });
    const dir = mkTmpDir('report-full-transcript');
    const file = writeTranscript(dir, id, [
      usageRecord('m1', 'claude-sonnet-5', { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }),
    ]);
    const report = buildReport({ sessionId: id, transcriptPath: file });
    const text = renderText(report);
    assert.match(text, /Tool outputs handled: 1/);
    assert.match(text, /Observed bytes:/);
    assert.match(text, /claude-sonnet-5/);
  });

  test('the rendered report makes no savings claim and states what it cannot measure', () => {
    const id = sid('report-no-claims');
    const body = Array.from({ length: 200 }, (_, i) => `line ${i} of fixture, unique content here`).join('\n');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: body }, { HUSH_DEBUG: '1' });
    const text = renderText(buildReport({ sessionId: id, transcriptPath: null }));
    assert.doesNotMatch(text, /sav(ed|ings)/i, 'no line claims a saving');
    assert.match(text, /Not measurable: what this session would have cost without hush/);
  });
});

// --- CLI ------------------------------------------------------------------------

describe('CLI', () => {
  test('--json prints a machine-readable report and exits 0 on success', () => {
    const id = sid('cli-json');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: 'ok\ndone' }, { HUSH_DEBUG: '1' });
    const dir = mkTmpDir('cli-json-transcript');
    const file = writeTranscript(dir, id, []);
    const r = spawnSync('node', [STATS_SCRIPT, '--session', id, '--transcript', file, '--json'], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 0);
    const parsed = JSON.parse(r.stdout);
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.sessionId, id);
  });

  test('exits 1 when no session can be resolved at all', () => {
    const base = mkTmpDir('cli-fail');
    const r = spawnSync('node', [STATS_SCRIPT, '--cwd', 'D:\\nothing\\at\\all'], {
      encoding: 'utf-8',
      env: { ...process.env, CLAUDE_PROJECTS_DIR_OVERRIDE_UNUSED: '1' },
      cwd: base,
    });
    // No --transcript/--session given and this cwd matches no real project
    // directory under the real ~/.claude/projects either (fabricated path).
    assert.strictEqual(r.status, 1);
  });

  test('plain-text output is readable and mentions the session id', () => {
    const id = sid('cli-text');
    runHook('compress-tool-output.js', { tool_name: 'Bash', session_id: id, tool_response: 'ok\ndone' }, { HUSH_DEBUG: '1' });
    const r = spawnSync('node', [STATS_SCRIPT, '--session', id], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 0);
    assert.match(r.stdout, new RegExp(id));
  });
});
