'use strict';

// The desktop mod (hooks/register.tsx, fold.ts and lint.ts) is tested by `claude plugin test .`,
// which needs the Claude Code CLI. These checks hold the contracts node can read as text: the mod
// sits beside the command hooks, which never depend on it, and the mod's copies of what
// hooks/style-settings.js knows stay equal to it.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOOKS_DIR } = require('./helpers');
const settings = require('../hooks/style-settings');

const LINT = fs.readFileSync(path.join(HOOKS_DIR, 'lint.ts'), 'utf-8');
// The quoted strings of one `const NAME = [...]` or `{...}` block in lint.ts.
const block = (re) => {
  const m = re.exec(LINT);
  assert.ok(m, `lint.ts keeps ${re}`);
  return m[1];
};
const strings = (text) => [...text.matchAll(/'([^']*)'/g)].map((m) => m[1]);

test('hooks.json names one hooks module beside the command hooks, and it exists', () => {
  const hooks = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, 'hooks.json'), 'utf-8'));
  assert.deepStrictEqual(hooks.modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(HOOKS_DIR, hooks.modules[0])));
  assert.ok(Object.keys(hooks.hooks).length > 0, 'the command hooks stay registered');
});

test("the check knows every /hush:config knob, with style-settings.js's values and defaults", () => {
  const body = block(/const KNOBS = \{([\s\S]*?)\} as const/);
  const copy = Object.fromEntries([...body.matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, k, v]) => [k, strings(v)]));
  // The whole object, in order: a knob added to style-settings.js fails here until the check knows it.
  assert.deepStrictEqual(copy, settings.KNOBS);
});

test('the mod and the CLI share the rule names, the knobs the settings key reads, the tally fields and its size cap', () => {
  assert.deepStrictEqual(strings(block(/export const RULES = \[([\s\S]*?)\] as const/)), settings.TALLY_RULES);
  assert.deepStrictEqual(strings(block(/export const READ = \[([\s\S]*?)\] as const/)), settings.TALLY_KNOBS);
  assert.deepStrictEqual(strings(block(/const FIELDS = \[([\s\S]*?)\]/)), settings.TALLY_FIELDS);
  assert.strictEqual(Number(block(/export const TALLY_MAX = (\d+)/)), settings.TALLY_MAX);
  for (const k of settings.TALLY_KNOBS) assert.ok(Object.hasOwn(settings.KNOBS, k), `${k} is a knob`);
});

test('the CLI names the count’s file exactly as the mod does, for the table the mod is tested on', () => {
  const source = fs.readFileSync(path.join(HOOKS_DIR, 'lint.test.ts'), 'utf-8');
  const table = /const FILES: [^=]+= (\[[\s\S]*?\n\])\n/.exec(source);
  assert.ok(table, 'lint.test.ts keeps its FILES table');
  // The table is plain data: strings, booleans and undefined.
  const rows = new Function(`return ${table[1]}`)();
  assert.ok(rows.length >= 20);
  for (const [named, home, isWindows, want] of rows) {
    assert.strictEqual(settings.countFiles(named, home, isWindows)?.tally, want, JSON.stringify([named, home, isWindows]));
  }
});

test('the mod registers no command', () => {
  for (const f of ['register.tsx', 'lint.ts']) {
    const code = fs.readFileSync(path.join(HOOKS_DIR, f), 'utf-8');
    assert.ok(!code.includes('command.register'), `${f} registers a command`);
  }
});
