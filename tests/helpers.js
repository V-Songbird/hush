'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

// One private temp directory per test process, removed when the process
// exits. TEMP, TMP and TMPDIR point at it, so os.tmpdir() in every test file
// that loads this module before a hook, and in every hook a test spawns, lands
// inside it: fixture directories, the sidecar store and debug manifests never
// reach the system temp directory, even when a test fails or Windows holds a
// file open.
//
// A process killed before it exits never runs that handler. The directories
// sit under one parent and start with their process id, so each new process
// removes those whose process is gone, and a killed run's temp lasts only
// until the next run.
const TEST_TEMP_PARENT = path.join(os.tmpdir(), 'hush-tests');
fs.mkdirSync(TEST_TEMP_PARENT, { recursive: true });
for (const name of fs.readdirSync(TEST_TEMP_PARENT)) {
  const pid = Number.parseInt(name, 10);
  if (!(pid > 0) || processAlive(pid)) continue;
  try {
    fs.rmSync(path.join(TEST_TEMP_PARENT, name), { recursive: true, force: true });
  } catch {
    // still held open; the next run tries again
  }
}
function processAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err.code === 'EPERM';
  }
}
const TEST_TEMP = fs.mkdtempSync(path.join(TEST_TEMP_PARENT, `${process.pid}-`));
for (const key of ['TEMP', 'TMP', 'TMPDIR']) process.env[key] = TEST_TEMP;
process.on('exit', () => {
  try {
    fs.rmSync(TEST_TEMP, { recursive: true, force: true });
  } catch {
    // a file still held open keeps the directory; the run's result stands
  }
});

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

// The suite must not read hush's own flags out of the developer's shell — a dev
// who exports HUSH_DISABLE=1 would otherwise watch the suite go red for no
// reason. Every test file requires this module before it touches a hook, in
// process or spawned, so clearing them here clears them everywhere. A flag a
// test sets afterwards, in process.env or through runHook's `env`, still binds.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('HUSH_')) delete process.env[key];
}
// The same goes for the host's Bash cut, which hush reads from Claude Code's
// settings files and BASH_MAX_OUTPUT_LENGTH: pointing both settings folders at
// a path that does not exist leaves the host default, 30000.
delete process.env.BASH_MAX_OUTPUT_LENGTH;
process.env.CLAUDE_CONFIG_DIR = process.env.CLAUDE_PROJECT_DIR = path.join(__dirname, 'no-claude-settings');

// Every child the suite spawns gets 90 s, so a machine running several suites
// at once still passes while a hung child fails.
const SPAWN_TIMEOUT_MS = 90000;

/** Run a hook script from hooks/ with JSON stdin; returns spawnSync result. */
function runHook(name, stdinData, env) {
  return spawnSync('node', [path.join(HOOKS_DIR, name)], {
    input: stdinData === undefined ? undefined : JSON.stringify(stdinData),
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, ...(env || {}) },
  });
}

/** Parse hook stdout as JSON, or null when the hook stayed silent. */
function hookOutput(result) {
  const out = (result.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

module.exports = { runHook, hookOutput, HOOKS_DIR, SPAWN_TIMEOUT_MS };
