'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

// The suite must not read hush's own flags out of the developer's shell — a dev
// who exports HUSH_DISABLE=1 would otherwise watch the suite go red for no
// reason. Every test file requires this module before it touches a hook, in
// process or spawned, so clearing them here clears them everywhere. A flag a
// test sets afterwards, in process.env or through runHook's `env`, still binds.
for (const key of Object.keys(process.env)) {
  if (key.startsWith('HUSH_')) delete process.env[key];
}

/** Run a hook script from hooks/ with JSON stdin; returns spawnSync result. */
function runHook(name, stdinData, env) {
  return spawnSync('node', [path.join(HOOKS_DIR, name)], {
    input: stdinData === undefined ? undefined : JSON.stringify(stdinData),
    encoding: 'utf-8',
    timeout: 30000,
    env: { ...process.env, ...(env || {}) },
  });
}

/** Parse hook stdout as JSON, or null when the hook stayed silent. */
function hookOutput(result) {
  const out = (result.stdout || '').trim();
  return out ? JSON.parse(out) : null;
}

module.exports = { runHook, hookOutput, HOOKS_DIR };
