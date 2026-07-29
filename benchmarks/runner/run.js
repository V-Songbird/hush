#!/usr/bin/env node
'use strict';
// Orchestrates headless `claude -p` sessions: tasks x arms x reps, isolated
// workspaces, stream-json transcripts, metrics + ground-truth check per run.
//
//   node runner/run.js --tag smoke --tasks explain-rerender --reps 1 --model haiku
//   node runner/run.js --tag mine  --reps 2 --model haiku          # default subset
//   node runner/run.js --tag full  --full --reps 2 --model haiku   # whole suite
//   node runner/run.js --tag byo   --rival-dir /path/to/other-plugin
//   node runner/run.js --tag abl   --ablations   # add Core-only and Quiet-only arms
//   node runner/run.js --tag rep   --seed 12345  # replay an earlier run's arm order
//   node runner/run.js --tag dbg   --hush-debug  # attach hush's decision manifest to each hush-arm record
//
// Two arms ship by default: `baseline` (plain Claude Code) and `hush` (this
// plugin). The hush plugin dir is resolved RELATIVE to this harness — no
// machine-specific paths. Point `--rival-dir` at any other plugin to add a
// third arm and compare it head-to-head; nothing about that plugin is bundled.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { parseTranscript, runCheck, readDebugManifest, assertUsableRun } = require('./metrics.js');
const { makeRng, shuffled, hashSeed } = require('./stats.js');
const { writeRecord } = require('./records.js');

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
// Opt-in (Probe 9 Spec 1 ingestion): writes hush's per-decision debug
// manifest for the hush arm and folds a summary into each run's record.
// Off by default — the extra tmpdir I/O has no business skewing a cost/
// timing measurement nobody asked for.
const hushDebug = argv.includes('--hush-debug');
const resume = argv.includes('--resume');
// Build the queue, resolve the arms, write the batch manifest — then stop,
// without spawning a single billable session. The way to check your flags,
// your ablation arms and your seed before you spend anything.
const dryRun = argv.includes('--dry-run');
// Arm order is shuffled inside every task+rep block so no arm always runs
// first into a cold cache. The seed is printed, recorded, and replayable with
// --seed, so "randomized" never means "unreproducible". Resolved below, once
// the tag's directory is known — a --resume reads it back from there.
const seedFlag = flag('seed', null);

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

// Optional bring-your-own-rival arms. We never name or ship a rival plugin —
// you point this at whatever plugin dir you want to measure against. The
// flags repeat for extra rivals and pair up by position: the Nth --rival-name /
// --rival-settings / --rival-env belongs to the Nth --rival-dir.
function flagAll(name) {
  const out = [];
  for (let i = 0; i < argv.length; i++) if (argv[i] === `--${name}`) out.push(argv[i + 1]);
  return out;
}
function addArm(name, dir, settings, env) {
  ARMS[name] = {
    pluginDirs: [path.resolve(dir)],
    ...(settings ? { settings: path.resolve(settings) } : {}),
    env: env || {},
  };
}

const rivalDirs = flagAll('rival-dir');
const rivalNames = flagAll('rival-name');
const rivalSettingsList = flagAll('rival-settings');
const rivalEnvs = flagAll('rival-env');
rivalDirs.forEach((dir, i) => {
  const name = rivalNames[i] || (rivalDirs.length > 1 ? `rival${i + 1}` : 'rival');
  addArm(name, dir, rivalSettingsList[i], parseRivalEnv(rivalEnvs[i] || null));
});

// Ablation arms: hush against itself with one surface switched off, so a win
// can be attributed to a surface instead of to "the plugin". Same plugin dir,
// same settings, same arm plumbing as a rival — only the env differs.
//   hush-core-only   Core on, Quiet off  — compression, exit codes, compaction
//   hush-quiet-only  Quiet on, Core off  — turn nudge, narration meter, brief
if (argv.includes('--ablations')) {
  addArm('hush-core-only', HUSH_DIR, path.join(ROOT, 'settings-hush.json'), { HUSH_QUIET: 'off' });
  addArm('hush-quiet-only', HUSH_DIR, path.join(ROOT, 'settings-hush.json'), { HUSH_CORE: 'off' });
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

// Segments are what the report groups by; a task without a known one would
// quietly land in an "unsegmented" bucket, so fail here instead.
for (const t of tasks) {
  if (!CONFIG.segments[t.segment]) throw new Error(`task ${t.id} has unknown segment "${t.segment}"`);
}

const outDir = path.join(ROOT, 'results', tag);
for (const d of ['runs', 'transcripts']) fs.mkdirSync(path.join(outDir, d), { recursive: true });

// The batch manifest lives here as well as in the records, because this path
// is keyed on the one thing a --resume always has: the tag. Without it the
// seed would only be discoverable from inside the record directory you need
// the seed to find, and an unqualified --resume would fork the batch in two.
const planFile = path.join(outDir, 'batch.json');

function readPlan() {
  try {
    return JSON.parse(fs.readFileSync(planFile, 'utf8'));
  } catch { return null; } // no manifest, or an unreadable one
}

const plan = readPlan();

function resumeSeed() {
  if (plan && plan.seed != null) return String(plan.seed);
  throw new Error(
    `--resume cannot find the seed of the batch it is resuming (${path.relative(ROOT, planFile)} is missing or `
    + 'unreadable). Pass --seed <seed> from the original run\'s output, or start a fresh batch without --resume.');
}

const seed = seedFlag != null ? String(seedFlag) : resume ? resumeSeed() : String(Date.now());

// One batch = one interleaved set of arms run together. Cost is NOT comparable
// across batches (a warm prompt cache roughly halves it), so every record
// carries the batch it came from and the claim generator refuses a mix. The id
// is derived, not stamped with the clock, so a --resume on the same tag lands
// back in the same batch instead of forking a new one.
const batchKey = [tag, seed, model, reps, armNames.join('+'), tasks.map((t) => t.id).join('+')].join('|');
const batchId = `${tag}-${hashSeed(batchKey).toString(16).padStart(8, '0')}`;
const recordDir = path.join(ROOT, 'records', batchId);

// The tag's manifest is the batch's identity, and both directions have to hold
// or the tag stops meaning one batch.
//
// Resuming under different flags is not resuming: the seed carries over but
// every other ingredient of the batch key does not, so the records land in a
// second records/ directory while completedRun() happily reuses the first
// batch's run files (it keys on filename alone) — two half-batches, neither
// publishable. A fresh plan on a tag that already has a manifest is the same
// break from the other end: it would overwrite the seed every later bare
// --resume reads, and the first batch would no longer be reachable through the
// tag at all. Refusing costs a flag; the alternative costs a paid batch.
function batchDrift() {
  const differs = [
    ['seed', plan.seed, seed],
    ['model', plan.model, model],
    ['reps', plan.reps, reps],
    ['arms', (plan.arms || []).join(','), armNames.join(',')],
    ['tasks', (plan.tasks || []).map((t) => t.id).join(','), tasks.map((t) => t.id).join(',')],
  ].filter(([, was, now]) => String(was) !== String(now));
  return differs.map(([name, was, now]) => `${name} was ${was || '(none)'}, this run has ${now || '(none)'}`)
    .join('; ') || 'the batch key differs';
}

if (plan && plan.batchId && plan.batchId !== batchId) {
  throw new Error(resume
    ? `--resume does not reproduce batch ${plan.batchId} — these flags compute ${batchId}. ${batchDrift()}. `
      + 'Re-run --resume with the flags the batch was planned under, or drop --resume to start a new batch on a new tag.'
    : `tag "${tag}" already carries batch ${plan.batchId}, and this run is batch ${batchId}. ${batchDrift()}. `
      + `Overwriting ${path.relative(ROOT, planFile)} would leave the first batch's seed unreachable through the tag `
      + `and re-point every later --resume. Use a different --tag, add --resume to continue ${plan.batchId}, `
      + `or delete ${path.relative(ROOT, planFile)} to reuse the tag.`);
}

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
function cleanEnv(armEnv, arm) {
  const env = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (/^(CLAUDECODE|CLAUDE_CODE_|HUSH_)/.test(k)) continue;
    env[k] = v;
  }
  // Exit-code wrapping is permission-gated inside hush (it only survives
  // permission evaluation under blanket per-tool allow rules, which is
  // exactly how buildArgs() grants Bash/PowerShell here) — opt in
  // explicitly so the arms keep their historical wrapping behavior.
  const extra = { HUSH_WRAP: '1' };
  if (hushDebug && arm === 'hush') extra.HUSH_DEBUG = '1';
  return Object.assign(env, extra, armEnv);
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
    //
    // Bash/PowerShell are blanket (not prefix-scoped to node*/ls*/etc) as of
    // 2026-07-08: a narrow single-command prefix pattern like `PowerShell(node*)`
    // rejects ANY multi-statement command outright ("contains multiple
    // operations... requires approval") — confirmed live. That broke hush's
    // preserve-exit-code.js wrapper (see hooks/preserve-exit-code.js), which
    // must append trailing statements to preserve a real exit code across the
    // PostToolUse/PostToolUseFailure split. Real engineering sessions need
    // multi-statement commands anyway (chained builds, piped output) — a
    // narrow prefix allowlist was never realistic for any arm, not just hush's.
    // --disallowedTools below still fails closed on git/Agent/scheduling.
    '--allowedTools',
    'Read,Edit,Write,Glob,Grep,TodoWrite,Bash,PowerShell',
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
function spawnClaude(args, workDir, env, prompt) {
  return new Promise((resolve) => {
    const child = spawn('claude', args, {
      cwd: workDir,
      env,
      shell: true, // resolves claude.cmd on Windows; all args are space-free
    });
    let stdout = '', stderr = '';
    child.stdout.on('data', (d) => { stdout += d; });
    child.stderr.on('data', (d) => { stderr += d; });
    child.stdin.write(prompt);
    child.stdin.end();
    const killer = setTimeout(() => child.kill('SIGKILL'), CONFIG.runTimeoutMs);
    child.on('close', (code) => {
      clearTimeout(killer);
      resolve({ stdout, stderr, code });
    });
  });
}

// A task may carry `prompt` (single turn) or `prompts` (a multi-turn session:
// the first call plain -p, each later call -p --continue in the same
// workdir, so real history accumulation and re-send costs show up in
// contextTraffic the way they do in an actual multi-prompt session). Per-call
// metrics are summed; finalText/check come from the last turn.
// A batch is a long chain of paid API calls, and the runner is a child of
// whatever shell launched it — a killed parent takes the whole run down
// mid-flight. Completed runs are already on disk, so --resume re-reads them
// instead of paying for them twice.
function completedRun(key) {
  const f = path.join(outDir, 'runs', `${key}.json`);
  if (!resume || !fs.existsSync(f)) return null;
  try {
    const r = JSON.parse(fs.readFileSync(f, 'utf8'));
    return r.error ? null : r;
  } catch { return null; }
}

// Retain a sanitized, hashed, write-once copy alongside the raw result. This
// is the auditable half: `results/` is yours and stays local, `records/` is
// publishable and is the only thing runner/publish.js will read.
function retain(key, record) {
  try {
    writeRecord(recordDir, key, record);
  } catch (err) {
    console.log(`RETAIN-SKIP ${key}  ${err.message}`);
  }
}

async function oneRun(task, arm, rep, orderIndex) {
  const key = `${task.id}__${arm}__r${rep}`;
  const done = completedRun(key);
  if (done) {
    console.log(`SKIP ${key}  (resume: already on disk)`);
    return done;
  }
  const workDir = path.join(workRoot, key);
  fs.rmSync(workDir, { recursive: true, force: true });
  fs.mkdirSync(workDir, { recursive: true });
  if (task.fixture) fs.cpSync(path.join(ROOT, 'fixtures', task.fixture), workDir, { recursive: true });

  const prompts = task.prompts || [task.prompt];
  const env = cleanEnv(ARMS[arm].env, arm);
  const started = Date.now();
  const calls = [];
  let stderrAll = '';
  for (let i = 0; i < prompts.length; i++) {
    const args = buildArgs(arm);
    if (i > 0) args.push('--continue');
    const r = await spawnClaude(args, workDir, env, prompts[i]);
    calls.push(r.stdout);
    stderrAll += r.stderr;
    if (r.code !== 0 && !r.stdout.trim()) break; // hard spawn failure: stop the chain
  }
  const wallMs = Date.now() - started;
  fs.writeFileSync(path.join(outDir, 'transcripts', `${key}.jsonl`), calls.join('\n'));

  let record;
  const provenance = { key, batchId, seed, orderIndex, task: task.id, segment: task.segment, arm, rep };
  try {
    const parsed = calls.map((s) => parseTranscript(s));
    const last = parsed[parsed.length - 1];
    assertUsableRun(parsed);
    const sum = (f) => parsed.reduce((n, p) => n + (p[f] || 0), 0);
    const check = runCheck(task.check, last.finalText, workDir);
    record = {
      ...provenance, category: task.category, model,
      turnsRun: calls.length, wallMs, check,
      outputStyle: parsed[0].outputStyle,
      costUsd: parsed.reduce((n, p) => n + (p.costUsd || 0), 0),
      numTurns: sum('numTurns'), durationMs: sum('durationMs'),
      resultSubtype: last.resultSubtype,
      usage: { output_tokens: parsed.reduce((n, p) => n + (p.usage?.output_tokens || 0), 0) },
      contextTraffic: sum('contextTraffic'), apiCalls: sum('apiCalls'),
      toolCalls: sum('toolCalls'), toolResultChars: sum('toolResultChars'),
      narrationWords: sum('narrationWords'), finalWords: last.finalWords,
      finalText: last.finalText,
      stderr: stderrAll.slice(0, 2000),
      // Fail-soft: null unless --hush-debug was passed and hush actually
      // wrote a manifest for this session (Probe 9 Spec 1 ingestion).
      debugManifest: hushDebug ? readDebugManifest(last.sessionId) : null,
    };
  } catch (err) {
    record = { ...provenance, model, wallMs, error: String(err), stderr: stderrAll.slice(0, 2000) };
  }
  fs.writeFileSync(path.join(outDir, 'runs', `${key}.json`), JSON.stringify(record, null, 2));
  retain(key, record);
  const ok = record.check ? (record.check.pass ? 'PASS' : 'FAIL') : 'ERR ';
  console.log(`${ok} ${key}  cost=$${record.costUsd ?? '?'}  out=${record.usage?.output_tokens ?? '?'}tok  traffic=${record.contextTraffic ?? '?'}  ${Math.round(wallMs / 1000)}s`);
  return record;
}

// --- pool -------------------------------------------------------------------
async function main() {
  // Arms are interleaved inside each task+rep block and shuffled there, so no
  // arm systematically runs first (into a cold cache) or last (into a warm
  // one). Same seed, same order, every time.
  const rng = makeRng(seed);
  const queue = [];
  for (const task of tasks) {
    for (let r = 1; r <= reps; r++) {
      for (const arm of shuffled(armNames, rng)) queue.push([task, arm, r]);
    }
  }
  console.log(`${queue.length} runs (${tasks.length} tasks x ${armNames.length} arms x ${reps} reps), model=${model}, tag=${tag}`);
  console.log(`arms: ${armNames.join(', ')}`);
  console.log(`batch ${batchId} · seed ${seed} (replay this order with --seed ${seed})`);
  const manifest = {
    batchId, seed, model, reps, tag,
    arms: armNames,
    tasks: tasks.map((t) => ({ id: t.id, segment: t.segment })),
    order: queue.map(([t, a, r]) => `${t.id}__${a}__r${r}`),
    startedAt: new Date().toISOString(),
  };
  // The tag-scoped copy is what a later --resume reads the seed back from, so
  // it is written on a dry run too: planning a batch is how you get its seed.
  fs.writeFileSync(planFile, JSON.stringify(manifest, null, 2));
  if (!dryRun) retain('batch', manifest);

  if (dryRun) {
    console.log('\ndry run — nothing was spawned, nothing was billed. Planned order:');
    queue.forEach(([t, a, r], i) => console.log(`  ${String(i).padStart(3)} ${t.id} [${t.segment}] ${a} r${r}`));
    return;
  }

  const results = [];
  let idx = 0;
  async function worker() {
    while (idx < queue.length) {
      const i = idx++;
      const [task, arm, r] = queue[i];
      results.push(await oneRun(task, arm, r, i));
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));

  const failures = results.filter((r) => !r.check || !r.check.pass);
  console.log(`\ndone: ${results.length - failures.length}/${results.length} passed ground truth`);
  if (failures.length) console.log('non-passing:', failures.map((f) => f.key).join(', '));
  console.log(`records retained in ${path.relative(ROOT, recordDir)}`);
  console.log(`\nnext: node runner/report.js --tag ${tag}`);
  console.log(`      node runner/publish.js --records ${path.relative(ROOT, recordDir)}`);
}

main();
