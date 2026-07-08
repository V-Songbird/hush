'use strict';

const path = require('path');
const { spawnSync } = require('child_process');

const HOOKS_DIR = path.join(__dirname, '..', 'hooks');

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
