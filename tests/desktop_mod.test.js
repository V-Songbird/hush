'use strict';

// The desktop mod (hooks/register.tsx and its files) is tested by `claude plugin test .`,
// which needs the Claude Code CLI. These checks hold the contracts between the mod and the
// rest of hush that node can read as text: the mod cannot require CommonJS, and the voice
// rule it unlocks lives in the output style, not in the mod.

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { HOOKS_DIR } = require('./helpers');
const { KNOBS } = require('../hooks/style-settings');

const read = (...p) => fs.readFileSync(path.join(HOOKS_DIR, ...p), 'utf-8');
const VOICE = fs.readFileSync(path.join(HOOKS_DIR, '..', 'output-styles', 'hush.md'), 'utf-8');

test('hooks.json names one hooks module beside the command hooks, and it exists', () => {
  const hooks = JSON.parse(read('hooks.json'));
  assert.deepStrictEqual(hooks.modules, ['./register.tsx']);
  assert.ok(fs.existsSync(path.join(HOOKS_DIR, hooks.modules[0])));
  assert.ok(Object.keys(hooks.hooks).length > 0, 'the command hooks stay registered');
});

test("the lint reads /hush:config's knobs with style-settings.js's values and defaults", () => {
  const block = /const KNOBS = \{([\s\S]*?)\} as const/.exec(read('lint.ts'));
  assert.ok(block, 'lint.ts keeps its KNOBS copy');
  const copy = Object.fromEntries([...block[1].matchAll(/(\w+): \[([^\]]*)\]/g)].map(([, k, v]) => [k, [...v.matchAll(/'([^']*)'/g)].map((m) => m[1])]));
  assert.deepStrictEqual(Object.keys(copy), ['next', 'rules', 'detail', 'markdown', 'sentences']);
  for (const [k, values] of Object.entries(copy)) assert.deepStrictEqual(values, KNOBS[k], `knob ${k}`);
});

test('the voice names exactly the alert types the lint allows with the desktop section', () => {
  const allowed = /SECTION_ALERTS: readonly AlertType\[\] = \[([^\]]*)\]/.exec(read('lint.ts'));
  const lint = [...allowed[1].matchAll(/'(\w+)'/g)].map((m) => m[1]).sort();
  const voice = [...new Set([...VOICE.matchAll(/\[!(\w+)\]/g)].map((m) => m[1].toLowerCase()))].filter((t) => t !== 'note').sort();
  // `[!NOTE]` is the voice's example of a banned form; every other type it names is allowed.
  assert.deepStrictEqual(voice, lint);
});

test('the voice lifts its ban only under the heading the mod composes', () => {
  const heading = /DESKTOP_HEADING = '# ([^']+)'/.exec(read('voice.ts'));
  assert.ok(heading, 'voice.ts names its heading');
  assert.ok(VOICE.includes(`a section headed "${heading[1]}"`), 'hush.md defers to that heading');
  assert.ok(VOICE.includes('## Forms the desktop mod draws'));
  assert.ok(read('voice.ts').includes('"Forms the desktop mod draws"'), 'the marker points at that part of the voice');
});

test('the ported code keeps its licences beside it', () => {
  assert.match(read('mermaid', 'LICENSE-skins'), /MIT License/);
  assert.match(read('LICENSE-octicons'), /MIT License/);
});
