'use strict';

// The desktop mod (hooks/register.tsx and fold.ts) is tested by `claude plugin test .`, which
// needs the Claude Code CLI. This check holds the one contract node can read as text: the mod
// sits beside the command hooks, which never depend on it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOOKS_DIR } = require('./helpers');
const { KNOBS } = require('../hooks/style-settings');

test('hooks.json names one hooks module beside the command hooks, and it exists', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf-8'));
  assert.deepStrictEqual(hooks.modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(HOOKS_DIR, hooks.modules[0])));
  assert.ok(Object.keys(hooks.hooks).length > 0, 'the command hooks stay registered');
});

test("the check reads /hush:config's knobs with style-settings.js's values and defaults", () => {
  const block = /const KNOBS = \{([\s\S]*?)\} as const/.exec(fs.readFileSync(path.join(HOOKS_DIR, 'lint.ts'), 'utf-8'));
  assert.ok(block, 'lint.ts keeps its KNOBS copy');
  const copy = Object.fromEntries([...block[1].matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, k, v]) => [k, [...v.matchAll(/'([^']*)'/g)].map((m) => m[1])]));
  assert.deepStrictEqual(Object.keys(copy), ['next', 'rules', 'detail', 'markdown', 'sentences']);
  for (const [k, values] of Object.entries(copy)) assert.deepStrictEqual(values, KNOBS[k], `knob ${k}`);
});

test('the mod registers no command and keeps no text of a reply', () => {
  for (const f of ['register.tsx', 'lint.ts']) {
    const code = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf-8');
    assert.ok(!code.includes('command.register'), `${f} registers a command`);
  }
  assert.ok(!/\bsentence\b\s*:/.test(fs.readFileSync(path.join(HOOKS_DIR, 'lint.ts'), 'utf-8')), 'the tally has no text field');
});

test('the tally file sits beside the settings file in the mod and in the CLI', () => {
  const mod = fs.readFileSync(path.join(HOOKS_DIR, 'register.tsx'), 'utf-8');
  assert.ok(mod.includes('/tally.json'));
  assert.ok(mod.includes('/.claude/hush/config.json'));
  assert.strictEqual(path.basename(require('../hooks/style-settings').tallyPath()), 'tally.json');
});
