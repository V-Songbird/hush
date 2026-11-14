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

test("the mod reads /hush:config's markdown setting with style-settings.js's values and default", () => {
  const copy = /const MARKDOWN = \[([^\]]*)\] as const/.exec(read('voice.ts'));
  assert.ok(copy, 'voice.ts keeps its MARKDOWN copy');
  assert.deepStrictEqual([...copy[1].matchAll(/'([^']*)'/g)].map((m) => m[1]), KNOBS.markdown);
});

test('the voice lifts its ban only under the heading the mod composes', () => {
  const heading = /DESKTOP_HEADING = '# ([^']+)'/.exec(read('voice.ts'));
  assert.ok(heading, 'voice.ts names its heading');
  assert.ok(VOICE.includes(`a section headed "${heading[1]}"`), 'hush.md defers to that heading');
  assert.ok(VOICE.includes('## Forms the desktop mod draws'));
  assert.ok(read('voice.ts').includes('"Forms the desktop mod draws"'), 'the marker points at that part of the voice');
});

test('the raw colour list names exactly the hex values the module holds', () => {
  const listed = JSON.parse(fs.readFileSync(path.join(HOOKS_DIR, '..', 'mod-colors.allow.json'), 'utf-8')).exceptions;
  const allowed = new Set(listed.flatMap((e) => e.values.map((v) => v.toLowerCase())));
  const used = new Set();
  for (const file of new Set(listed.map((e) => e.file))) {
    for (const [, hex] of read(file).matchAll(/["'`](#[0-9a-fA-F]{3,8})["'`]/g)) used.add(hex.toLowerCase());
  }
  assert.deepStrictEqual([...used].sort(), [...allowed].sort());
});

test('the ported code keeps its licences beside it', () => {
  assert.match(read('mermaid', 'LICENSE-skins'), /MIT License/);
  assert.match(read('LICENSE-octicons'), /MIT License/);
});
