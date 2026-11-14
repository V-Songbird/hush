'use strict';

// The desktop mod (hooks/register.tsx and fold.ts) is tested by `claude plugin test .`, which
// needs the Claude Code CLI. This check holds the one contract node can read as text: the mod
// sits beside the command hooks, which never depend on it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOOKS_DIR } = require('./helpers');

test('hooks.json names one hooks module beside the command hooks, and it exists', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf-8'));
  assert.deepStrictEqual(hooks.modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(HOOKS_DIR, hooks.modules[0])));
  assert.ok(Object.keys(hooks.hooks).length > 0, 'the command hooks stay registered');
});
