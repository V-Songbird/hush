'use strict';

// Contract suite: canonical hook payloads in, exact emitted bytes out.
//
// Every other suite parses hush's output and asserts on a field. That can see
// a wrong value; it cannot see a renamed envelope key, a lost raw-stdout
// channel, a stray newline, or a provenance note that started repeating. This
// one compares bytes, with no live harness in the loop.
//
// hush needs it more than its siblings. Its whole product is byte-level
// rewriting of tool results, so a shape drift is invisible until sessions
// quietly degrade — and the envelope key really is `updatedToolOutput`, not
// `updatedToolResult`, a distinction nothing else in the suite pins.
//
// Regenerate after a deliberate wording change:
//   node tests/contract.test.js --update
// then read the diff. A golden that moved without a reason you can name is
// the bug, not the test.

require('./helpers');
const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');
const FIXTURES = path.join(__dirname, 'contract', 'fixtures');
const GOLDEN = path.join(__dirname, 'contract', 'golden');

// Every scenario gets its own temp root, so a sidecar directory, a session
// note sentinel and a react counter from one scenario can never leak into the
// next — and so the goldens are the same on a machine whose temp dir is
// somewhere else. The root is spelled out of the bytes again on the way back.
const ROOTS = [];

function tmpRoot(name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `hush-contract-${name}-`));
  ROOTS.push(dir);
  return dir;
}

function cleanRoots() {
  for (const dir of ROOTS) fs.rmSync(dir, { recursive: true, force: true });
  ROOTS.length = 0;
}

// A payload hush handles is mostly bulk, and bulk does not belong inline in a
// fixture. These four generators are the only substitutions; everything else
// in a fixture file is literal.
//
//   {{SESSION}}      the scenario's session id
//   {{TMP}}          the scenario's temp root, forward-slashed
//   {{UNIQUE:n}}     n lines that never repeat — defeats template collapse
//   {{REPEAT:n}}     n lines of one shape with a varying number — collapsible
//   {{FAILING:n}}    n lines with error and warning lines seeded through them
//   {{GREP:n}}       n `file:line:text` match lines across twenty files
function expand(text, { session, root }) {
  return text
    .replace(/\{\{SESSION\}\}/g, session)
    .replace(/\{\{TMP\}\}/g, root.replace(/\\/g, '/'))
    .replace(/\{\{GREP:(\d+)\}\}/g, (_, n) =>
      Array.from({ length: Number(n) }, (_, i) => `src/f${i % 20}.js:${i}:  // TODO handle case ${i}`).join('\\n'))
    // Six shapes, interleaved. Same-shape runs are what collapseTemplates
    // folds, so a generator that repeats one shape never reaches the sidecar
    // path it was written to pin — the lines are gone before the size test.
    .replace(/\{\{UNIQUE:(\d+)\}\}/g, (_, n) =>
      Array.from({ length: Number(n) }, (_, i) => [
        `[${String(i).padStart(5, '0')}] resolving dependency graph for workspace-${i}`,
        `  chunk ${i}.js  ${i * 37} bytes  emitted in ${i % 90}ms`,
        `transform: src/mod-${i}/index.ts -> dist/mod-${i}/index.js`,
        `  cache hit ratio ${(i % 97) / 100} across ${i % 13} shards`,
        `linked node_modules/.store/pkg-${i}@2.${i % 9}.${i % 7} -> pkg-${i}`,
        `  wrote manifest entry ${i} (${i * 11} keys, ${i % 5} overrides)`,
      ][i % 6]).join('\\n'))
    .replace(/\{\{REPEAT:(\d+)\}\}/g, (_, n) =>
      Array.from({ length: Number(n) }, (_, i) => `  resolved package-${i} -> 1.0.${i}`).join('\\n'))
    .replace(/\{\{FAILING:(\d+)\}\}/g, (_, n) =>
      Array.from({ length: Number(n) }, (_, i) => {
        if (i === 12) return 'ERROR: cannot resolve module ./missing';
        if (i === 40) return 'WARNING: deprecated flag --legacy';
        if (i === 71) return 'FAIL src/thing.test.js > it keeps the receipt';
        return `  compiled module-${i}`;
      }).join('\\n'));
}

function loadFixture(name, ctx) {
  const raw = fs.readFileSync(path.join(FIXTURES, `${name}.json`), 'utf-8');
  return expand(raw, ctx);
}

// The one normalization on the way out: the scenario's temp root becomes
// {{TMP}} again, so a golden that names a parked file names it portably.
// Nothing else about the bytes is touched.
function normalize(out, root) {
  const forward = root.replace(/\\/g, '/');
  return out.split(forward).join('{{TMP}}').split(root).join('{{TMP}}');
}

// ---- scenarios ------------------------------------------------------------
//
// `must` / `mustNot` are what each scenario is FOR, asserted independently of
// the golden: a golden regenerated from the code proves stability, never
// meaning. `fires: 2` runs the hook twice on one session and keeps the second
// emission — the way to pin a once-per-session behavior.

const SCENARIOS = [
  {
    name: 'posttooluse-bash-collapse',
    hook: 'compress-tool-output.js',
    env: { HUSH_SIDECAR: 'off' },
    must: ['"updatedToolOutput"', '[hush hook:', "hush's compression hook is active in this session"],
    mustNot: ['updatedToolResult'],
  },
  {
    // Same session, second fire. The provenance note is claimed once per
    // session by a sentinel file, so the second emission must carry the
    // rewrite and not the note.
    name: 'posttooluse-bash-collapse-again',
    hook: 'compress-tool-output.js',
    env: { HUSH_SIDECAR: 'off' },
    fires: 2,
    must: ['"updatedToolOutput"'],
    mustNot: ["hush's compression hook is active in this session"],
  },
  {
    name: 'posttooluse-bash-clean',
    hook: 'compress-tool-output.js',
    silent: true,
  },
  {
    // Evidence, not noise: the failure path keeps a bigger slice AND every
    // error/warning/failure-shaped line inside it.
    name: 'posttooluse-bash-failing',
    hook: 'compress-tool-output.js',
    env: { HUSH_SIDECAR: 'off' },
    must: [
      '"updatedToolOutput"',
      'ERROR: cannot resolve module ./missing',
      'WARNING: deprecated flag --legacy',
      'FAIL src/thing.test.js > it keeps the receipt',
    ],
  },
  {
    // The parked-file path is in the emitted bytes, which is exactly why the
    // temp root is normalized rather than avoided.
    name: 'posttooluse-bash-sidecar',
    hook: 'compress-tool-output.js',
    must: ['"updatedToolOutput"', '{{TMP}}/hush-sidecar/', 'was saved in full to'],
  },
  {
    name: 'posttooluse-read-log',
    hook: 'compress-tool-output.js',
    must: ['"updatedToolOutput"', '"filePath"'],
  },
  {
    name: 'posttooluse-grep-collapse',
    hook: 'compress-tool-output.js',
    env: { HUSH_SIDECAR: 'off' },
    must: ['"updatedToolOutput"', 'match lines omitted from this view'],
  },
  {
    name: 'posttooluse-disabled',
    hook: 'compress-tool-output.js',
    env: { HUSH_DISABLE: '1' },
    silent: true,
  },
  {
    name: 'pretooluse-bash-bypass',
    hook: 'preserve-exit-code.js',
    must: ['"updatedInput"', '"hookEventName":"PreToolUse"'],
    mustNot: ['updatedToolOutput'],
  },
  {
    // Without bypassPermissions there is no rewrite channel for a failing
    // command, so the wrapper must not fire at all.
    name: 'pretooluse-bash-default',
    hook: 'preserve-exit-code.js',
    silent: true,
  },
  {
    name: 'userpromptsubmit-nudge',
    hook: 'silence-nudge.js',
    must: ['"hookEventName":"UserPromptSubmit"', '"additionalContext"'],
  },
  {
    // The default nudge is reactive: it fires only after a mid-turn text
    // block has actually appeared in the transcript.
    name: 'posttooluse-nudge-leak',
    hook: 'silence-nudge.js',
    transcript: 'leaky',
    must: ['"hookEventName":"PostToolUse"', '"additionalContext"'],
  },
  {
    name: 'posttooluse-nudge-quiet',
    hook: 'silence-nudge.js',
    transcript: 'quiet',
    silent: true,
  },
  {
    // Claude Code builds compaction instructions from raw stdout here, not
    // from hookSpecificOutput — losing that channel is the drift this pins.
    name: 'precompact-summary',
    hook: 'precompact-summary.js',
    must: ['Summary format: a compact structured list, not prose.'],
    mustNot: ['hookSpecificOutput', 'updatedToolOutput'],
  },
  {
    name: 'subagentstart-brief',
    hook: 'subagent-brief.js',
    must: ['"hookEventName":"SubagentStart"', '"additionalContext"'],
  },
  {
    name: 'postcompact-rearm',
    hook: 'postcompact-rearm.js',
    silent: true,
  },
  {
    name: 'sessionend-cleanup',
    hook: 'session-end-cleanup.js',
    silent: true,
  },
];

// A transcript fixture only matters to silence-nudge, which counts assistant
// text blocks since the last human prompt. Two shapes: one that leaked, one
// that stayed quiet.
const TRANSCRIPTS = {
  leaky: [
    { type: 'user', message: { role: 'user', content: 'fix the failing suite' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: "I'll look at the tests now." }] } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
  ],
  quiet: [
    { type: 'user', message: { role: 'user', content: 'fix the failing suite' } },
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', name: 'Bash', input: {} }] } },
  ],
};

function writeTranscript(root, kind) {
  const file = path.join(root, `${kind}.jsonl`);
  fs.writeFileSync(file, TRANSCRIPTS[kind].map((e) => JSON.stringify(e)).join('\n') + '\n');
  return file;
}

function runScenario(scenario) {
  const root = tmpRoot(scenario.name);
  const session = `contract-${scenario.name}`;
  let payload = loadFixture(scenario.name, { session, root });
  if (scenario.transcript) {
    const file = writeTranscript(root, scenario.transcript).replace(/\\/g, '\\\\');
    payload = payload.replace(/\{\{TRANSCRIPT\}\}/g, file);
  }
  // TMPDIR/TMP/TEMP together cover os.tmpdir() on every platform this runs on.
  const env = {
    ...process.env,
    TMPDIR: root,
    TMP: root,
    TEMP: root,
    ...(scenario.env || {}),
  };
  let stdout = '';
  for (let i = 0; i < (scenario.fires || 1); i++) {
    const result = spawnSync('node', [path.join(HOOKS_DIR, scenario.hook)], {
      input: payload,
      encoding: 'utf-8',
      timeout: 30000,
      env,
    });
    if (result.error) throw result.error;
    if (result.status !== 0 || result.signal) {
      throw new Error(`${scenario.hook} exited ${result.status}: ${result.stderr || '(no stderr)'}`);
    }
    stdout = result.stdout;
  }
  return normalize(stdout, root);
}

function goldenPath(name) {
  return path.join(GOLDEN, `${name}.txt`);
}

if (process.argv.includes('--update')) {
  fs.mkdirSync(GOLDEN, { recursive: true });
  for (const scenario of SCENARIOS) {
    fs.writeFileSync(goldenPath(scenario.name), runScenario(scenario));
    process.stdout.write(`updated ${scenario.name}\n`);
  }
  cleanRoots();
} else {
  describe('contract: exact emitted bytes per hook event', () => {
    after(cleanRoots);
    for (const scenario of SCENARIOS) {
      test(scenario.name, () => {
        const actual = runScenario(scenario);
        const expected = fs.readFileSync(goldenPath(scenario.name), 'utf-8');
        assert.strictEqual(
          actual,
          expected,
          `emitted bytes drifted from tests/contract/golden/${scenario.name}.txt — ` +
            'if the change was deliberate, rerun with --update and read the diff',
        );
        if (scenario.silent) assert.strictEqual(actual, '', 'this scenario must emit nothing');
        for (const needle of scenario.must || []) assert.ok(actual.includes(needle), `missing: ${needle}`);
        for (const needle of scenario.mustNot || []) assert.ok(!actual.includes(needle), `must not contain: ${needle}`);
      });
    }
  });
}

module.exports = { SCENARIOS };
