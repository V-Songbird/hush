#!/usr/bin/env node
'use strict';
// Orchestrates headless `claude -p` sessions: tasks x arms x reps, isolated
// workspaces, stream-json transcripts, metrics + ground-truth check per run.
//
//   node runner/run.js --tag smoke --tasks explain-rerender --reps 1 --model haiku
//   node runner/run.js --tag mine  --reps 2 --model haiku          # default subset
//   node runner/run.js --tag full  --full --reps 2 --model haiku   # whole suite
//   node runner/run.js --tag byo   --rival-dir /path/to/other-plugin
//
// Two arms ship by default: `baseline` (plain Claude Code) and `hush` (this
// plugin). The hush plugin dir is resolved RELATIVE to this harness — no
// machine-specific paths. Point `--rival-dir` at any other plugin to add a
// third arm and compare it head-to-head; nothing about that plugin is bundled.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseTranscript, runCheck } = require('./metrics.js');

const ROOT = path.resolve(__dirname, '..');            // hush/benchmarks
const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config.json'), 'utf8'));
const TASKS = JSON.parse(fs.readFileSync(path.join(ROOT, 'tasks.json'), 'utf8'));

// --- CLI args ---------------------------------------------------------------
const argv = process.argv.slice(2);
function flag(name, dflt) {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 ? argv[i + 1] : dflt;
}
const tag = flag('tag', 'dev');
const model = flag('model', CONFIG.model);
const reps = Number(flag('reps', CONFIG.reps));
const concurrency = Number(flag('concurrency', CONFIG.concurrency));

// --- arms -------------------------------------------------------------------
// The hush plugin lives one directory up from this harness; resolve it there
// (or honour HUSH_PLUGIN_DIR) so nothing here is tied to one machine's paths.
const HUSH_DIR = process.env.HUSH_PLUGIN_DIR
  ? path.resolve(process.env.HUSH_PLUGIN_DIR)
  : path.resolve(ROOT, '..');

function parseRivalEnv(s) {
  const env = {};
  if (!s) return env;
  for (const pair of s.split(',')) {
    const i = pair.indexOf('=');
    if (i > 0) env[pair.slice(0, i).trim()] = pair.slice(i + 1);
  }
  return env;
}

const ARMS = {
  baseline: { pluginDirs: [], env: {} },
  hush: {
    pluginDirs: [HUSH_DIR],
    // force-for-plugin output styles don't apply under --setting-sources
    // project in -p mode; pin it explicitly via a settings file instead.
    settings: path.join(ROOT, 'settings-hush.json'),
    env: {},
  },
};

// Optional bring-your-own-rival arm. We never name or ship a rival plugin —
// you point this at whatever plugin dir you want to measure against.
const rivalDir = flag('rival-dir', null);
if (rivalDir) {
  const rivalName = flag('rival-name', 'rival');
  const rivalSettings = flag('rival-settings', null);
  ARMS[rivalName] = {
    pluginDirs: [path.resolve(rivalDir)],
    ...(rivalSettings ? { settings: path.resolve(rivalSettings) } : {}),
    env: parseRivalEnv(flag('rival-env', null)),
  };
}

const armNames = (flag('arms', Object.keys(ARMS).join(','))).split(',');

// --- task selection ---------------------------------------------------------
// No --tasks and no --full -> the cheap default subset from config.json.
const full = argv.includes('--full');
const taskIds = flag('tasks', null);
const tasks = taskIds
  ? TASKS.filter((t) => taskIds.split(',').includes(t.id))
  : full
    ? TASKS
    : TASKS.filter((t) => CONFIG.defaultTasks.includes(t.id));

const outDir = path.join(ROOT, 'results', tag);
for (const d of ['runs', 'transcripts']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

// Workdirs live OUTSIDE the repo, in the OS temp dir. Claude Code injects
// ambient git status / recent commits into the system prompt for any cwd
// inside a git working tree, regardless of tool restrictions — a workdir
// nested under a git repo silently leaks that repo's history into every
// session, and a weak model goes chasing it well past what the task needs.
const workRoot = path.join(os.tmpdir(), 'hush-bench', tag);
fs.mkdirSync(workRoot, { recursive: true });

// --- environment ------------------------------------------------------------
// Strip nested-session and hush-tuning vars so each arm starts clean; the
// arm's own env (including any rival env) is layered on top.
function cleanEnv(armEnv) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|HUSH_)/.test(k)) continue;
    env[k] = v;
  }
  return Object.assign(env, armEnv);
}

function buildArgs(arm) {
  const args = [
    '-p',
    '--output-format', 'stream-json',
    '--verbose',
    '--model', model,
    '--max-turns', String(CONFIG.maxTurns),
    '--setting-sources', 'project',
    '--strict-mcp-config',
    // No blanket permission bypass: scoped allowlist instead. Anything outside
    // it fails closed in -p mode and the agent has to work within the sandbox.
    '--permission-mode', 'acceptEdits',
    // comma-separated, no spaces: survives the shell:true arg join on Windows
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep,TodoWrite,' +
    'Bash(node*),Bash(ls*),Bash(cat*),Bash(grep*),Bash(rg*),Bash(head*),Bash(tail*),Bash(wc*),Bash(find*),Bash(sed*),Bash(dir*),' +
    'PowerShell(node*),PowerShell(ls*),PowerShell(cat*),PowerShell(Get-Content*),PowerShell(Get-ChildItem*),PowerShell(Select-String*),PowerShell(dir*)',
    // --allowedTools alone does not deny what's unlisted in -p mode (verified:
    // a plain `git log` ran fine with only the allowlist above set). Task
    // fixtures never need git/subagents/scheduling; deny them explicitly so a
    // weaker model can't wander into the enclosing repo or spawn busywork.
    '--disallowedTools',
    'Bash(git*),PowerShell(git*),Agent,Task,ScheduleWakeup,CronCreate,RemoteTrigger',
  ];
  for (const d of ARMS[arm].pluginDirs) args.push('--plugin-dir', d);
  if (ARMS[arm].settings) args.push('--settings', ARMS[arm].settings);
  return args;
}

// --- single run -------------------------------------------------------------
function oneRun(task, arm, rep) {
  const key = `${task.id}__${arm}__r${rep}`;
  const workDir = path.join(workRoot, key);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  if (task.fixture) fs.cpSync(path.join(ROOT, 'fixtures', task.fixture), workDir, { recursive: true });

  return new Promise((resolve) => {
    const started = Date.now();
    const child = spawn('claude', buildArgs(arm), {
      cwd: workDir,
      env: cleanEnv(ARMS[arm].env),
      shell: true, // resolves claude.cmd on Windows; all args are space-free
    });

    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(task.prompt);
    child.stdin.end();

    const killer = setTimeout(() => child.kill('SIGKILL'), CONFIG.runTimeoutMs);

    child.on('close', (code) => {
      clearTimeout(killer);
      const wallMs = Date.now() - started;
      fs.writeFileSync(path.join(outDir, 'transcripts', `${key}.jsonl`), stdout);
      let record;
      try {
        const m = parseTranscript(stdout);
        const check = runCheck(task.check, m.finalText, workDir);
        record = {
          key, task: task.id, category: task.category, arm, rep, model,
          exitCode: code, wallMs, check,
          outputStyle: m.outputStyle,
          costUsd: m.costUsd, numTurns: m.numTurns, durationMs: m.durationMs,
          resultSubtype: m.resultSubtype,
          usage: m.usage, contextTraffic: m.contextTraffic, apiCalls: m.apiCalls,
          toolCalls: m.toolCalls, toolResultChars: m.toolResultChars,
          narrationWords: m.narrationWords, finalWords: m.finalWords,
          finalText: m.finalText,
          stderr: stderr.slice(0, 2000),
        };
      } catch (err) {
        record = { key, task: task.id, arm, rep, exitCode: code, wallMs, error: String(err), stderr: stderr.slice(0, 2000) };
      }
      fs.writeFileSync(path.join(outDir, 'runs', `${key}.json`), JSON.stringify(record, null, 2));
      const ok = record.check ? (record.check.pass ? 'PASS' : 'FAIL') : 'ERR ';
      console.log(`${ok} ${key}  cost=$${record.costUsd ?? '?'}  out=${record.usage?.output_tokens ?? '?'}tok  traffic=${record.contextTraffic ?? '?'}  ${Math.round(wallMs / 1000)}s`);
      resolve(record);
    });
  });
}

// --- pool -------------------------------------------------------------------
async function main() {
  const queue = [];
  for (const task of tasks) for (const arm of armNames) for (let r = 1; r <= reps; r++) queue.push([task, arm, r]);
  console.log(`${queue.length} runs (${tasks.length} tasks x ${armNames.length} arms x ${reps} reps), model=${model}, tag=${tag}`);
  console.log(`arms: ${armNames.join(', ')}`);

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const [task, arm, r] = queue[idx++];
      results.push(await oneRun(task, arm, r));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  const failures = results.filter((r) => !r.check || !r.check.pass);
  console.log(`\ndone: ${results.length - failures.length}/${results.length} passed ground truth`);
  if (failures.length) console.log('non-passing:', failures.map((f) => f.key).join(', '));
  console.log(`\nnext: node runner/report.js --tag ${tag}`);
}

main();
