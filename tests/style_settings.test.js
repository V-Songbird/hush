'use strict';

const { test, describe, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { HOOKS_DIR, SPAWN_TIMEOUT_MS } = require('./helpers');
const { KNOBS, DEFAULTS, PRESETS, HEADER, parse } = require('../hooks/style-settings');

const SCRIPT = path.join(HOOKS_DIR, 'style-settings.js');
const MODULES = path.join(HOOKS_DIR, '..', 'modules');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hush-style-settings-'));
after(() => fs.rmSync(tmp, { recursive: true, force: true }));

let n = 0;
const freshConfig = () => path.join(tmp, `config-${n++}.json`);

function run(args, { config, input = '{}', env = {} } = {}) {
  return spawnSync('node', [SCRIPT, ...args], {
    input,
    encoding: 'utf-8',
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, HUSH_CONFIG_FILE: config, ...env },
  });
}

describe('style-settings: modules', () => {
  test('every non-default knob value has its module text', () => {
    for (const [k, values] of Object.entries(KNOBS)) {
      for (const v of values.slice(1)) {
        const text = fs.readFileSync(path.join(MODULES, `${k}-${v}.md`), 'utf-8').trim();
        assert.ok(text.length > 0, `${k}-${v}.md is empty`);
      }
    }
  });

  test('every module file belongs to a knob value, so none is left behind', () => {
    const expected = Object.entries(KNOBS).flatMap(([k, values]) => values.slice(1).map((v) => `${k}-${v}.md`));
    assert.deepStrictEqual(fs.readdirSync(MODULES).sort(), expected.sort());
  });

  test('the floor is in the style file and the header, and no module drops it', () => {
    const floor = 'No setting removes a blocker, a pending approval, an unverified claim or anything left unchecked.';
    assert.ok(fs.readFileSync(path.join(HOOKS_DIR, '..', 'output-styles', 'hush.md'), 'utf-8').includes(floor));
    assert.ok(HEADER.includes(floor));
    for (const f of ['caveats-floor.md', 'detail-bare.md']) {
      const text = fs.readFileSync(path.join(MODULES, f), 'utf-8');
      for (const item of ['blocker', 'pending approval', 'unverified claim', 'anything left unchecked']) assert.ok(text.includes(item), `${f} names ${item}`);
    }
    assert.ok(fs.readFileSync(path.join(MODULES, 'detail-bare.md'), 'utf-8').includes('A failed check and anything left unchecked join the warnings prose.'));
  });

  test('emoji stays off by default and its module replaces the no-emoji rule', () => {
    assert.strictEqual(DEFAULTS.emoji, 'off');
    for (const p of Object.values(PRESETS)) assert.strictEqual(p.emoji, 'off');
    assert.ok(fs.readFileSync(path.join(HOOKS_DIR, '..', 'output-styles', 'hush.md'), 'utf-8').includes('No emoji.'));
    const text = fs.readFileSync(path.join(MODULES, 'emoji-on.md'), 'utf-8');
    assert.ok(text.includes('This replaces the "No emoji" rule.'));
    for (const cue of ['✅', '❌', '🛑', '💡', '🔧', '🧪', '⚠️', '🧭', '📝', '👉']) assert.ok(text.includes(`| ${cue} |`), cue);
  });

  test('headers stay off by default and their module replaces the no-label rule', () => {
    assert.strictEqual(DEFAULTS.headers, 'off');
    for (const p of Object.values(PRESETS)) assert.strictEqual(p.headers, 'off');
    assert.ok(fs.readFileSync(path.join(HOOKS_DIR, '..', 'output-styles', 'hush.md'), 'utf-8').includes('A block carries no stock label naming its role.'));
    const text = fs.readFileSync(path.join(MODULES, 'headers-on.md'), 'utf-8');
    assert.ok(text.includes('This replaces the rule that a block carries no stock label naming its role.'));
    assert.ok(fs.readFileSync(path.join(MODULES, 'emoji-on.md'), 'utf-8').includes('When section headers are on, it goes in the header instead.'));
  });

  test('the configurator widget carries the same knobs, and every knob it does not show keeps its saved value', () => {
    const html = fs.readFileSync(path.join(HOOKS_DIR, '..', 'widgets', 'config.html'), 'utf-8');
    assert.deepStrictEqual(JSON.parse(html.match(/^const K=(.*);$/m)[1]), KNOBS);
    const shown = new Set([...html.match(/^const FK=(\{.*?\});/m)[1].matchAll(/'(\w+)'/g)].map((m) => m[1]));
    assert.deepStrictEqual(Object.keys(KNOBS).filter((k) => !shown.has(k)).sort(), ['records', 'why']);
    assert.match(html, /\bk=\{\.\.\.base\}/);
    assert.match(html, /^const CUR=\{\};$/m);
    assert.match(html, /^const ROOT='';$/m);
  });

  test('files are cards by default, and the link module replaces the card rule', () => {
    assert.strictEqual(DEFAULTS.files, 'card');
    const style = fs.readFileSync(path.join(HOOKS_DIR, '..', 'output-styles', 'hush.md'), 'utf-8');
    assert.ok(style.includes('A whole file goes as a file card.'));
    assert.ok(fs.readFileSync(path.join(MODULES, 'files-link.md'), 'utf-8').includes('This replaces the file-card rule.'));
    for (const f of fs.readdirSync(MODULES)) {
      assert.ok(!/line of links/.test(fs.readFileSync(path.join(MODULES, f), 'utf-8')), `${f} still asks for a line of links`);
    }
  });

  test('checks give room only to what did not pass, with no marks, and the message comes after wrap_up', () => {
    const root = path.join(HOOKS_DIR, '..');
    const style = fs.readFileSync(path.join(root, 'output-styles', 'hush.md'), 'utf-8');
    assert.ok(style.includes('Checks give room only to what did not pass.'));
    assert.ok(style.includes('Write the message after `wrap_up`, never before it.'));
    assert.ok(!style.includes('write the message first'));
    const files = [path.join(root, 'output-styles', 'hush.md'), path.join(root, 'widgets', 'config.html'), path.join(root, 'commands', 'config.md')];
    for (const f of fs.readdirSync(MODULES)) files.push(path.join(MODULES, f));
    for (const f of files) {
      const text = fs.readFileSync(f, 'utf-8');
      assert.ok(!/[✓✗○]|bullet led by its mark/.test(text), `${path.basename(f)} still marks checks`);
    }
  });

  test('every preset sets every knob to a known value', () => {
    for (const [name, preset] of Object.entries(PRESETS)) {
      assert.deepStrictEqual(Object.keys(preset), Object.keys(KNOBS), name);
      for (const [k, v] of Object.entries(preset)) assert.ok(KNOBS[k].includes(v), `${name}: ${k}=${v}`);
    }
    assert.deepStrictEqual(PRESETS.standard, DEFAULTS);
  });
});

describe('style-settings hook', () => {
  test('no config file -> silent', () => {
    const r = run([], { config: freshConfig(), input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'startup' }) });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('every knob at its default -> silent', () => {
    const config = freshConfig();
    fs.writeFileSync(config, JSON.stringify(DEFAULTS));
    const r = run([], { config });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('a moved knob -> SessionStart envelope with the header and that module only', () => {
    const config = freshConfig();
    fs.writeFileSync(config, JSON.stringify({ ...DEFAULTS, next: 'top' }));
    const r = run([], { config, input: JSON.stringify({ hook_event_name: 'SessionStart', source: 'compact' }) });
    assert.strictEqual(r.status, 0);
    const out = JSON.parse(r.stdout);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'SessionStart');
    const ctx = out.hookSpecificOutput.additionalContext;
    assert.ok(ctx.startsWith(HEADER));
    assert.ok(ctx.includes(fs.readFileSync(path.join(MODULES, 'next-top.md'), 'utf-8').trim()));
    assert.ok(!ctx.includes(fs.readFileSync(path.join(MODULES, 'rules-off.md'), 'utf-8').trim()));
  });

  test('box=work and box=text -> their own rule; box=decisions adds nothing', () => {
    const config = freshConfig();
    fs.writeFileSync(config, JSON.stringify({ ...DEFAULTS, box: 'work' }));
    const ctx = JSON.parse(run([], { config }).stdout).hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes(fs.readFileSync(path.join(MODULES, 'box-work.md'), 'utf-8').trim()));
    fs.writeFileSync(config, JSON.stringify({ ...DEFAULTS, box: 'text' }));
    const text = JSON.parse(run([], { config }).stdout).hookSpecificOutput.additionalContext;
    assert.ok(text.includes(fs.readFileSync(path.join(MODULES, 'box-text.md'), 'utf-8').trim()));
    assert.ok(!text.includes('work turns only'));
    fs.writeFileSync(config, JSON.stringify({ ...DEFAULTS, box: 'decisions' }));
    assert.strictEqual(run([], { config }).stdout, '');
  });

  test('unknown values in a hand-edited file fall back to defaults', () => {
    const config = freshConfig();
    fs.writeFileSync(config, JSON.stringify({ next: 'sideways', detail: 'short', extra: 1 }));
    const r = run([], { config });
    const ctx = JSON.parse(r.stdout).hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes('80 words'));
    assert.ok(!ctx.includes('Next step on top'));
  });

  test('broken JSON or malformed stdin -> silent, exit 0', () => {
    const config = freshConfig();
    fs.writeFileSync(config, '{ not json');
    const r = run([], { config, input: 'not json {{{' });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });

  test('HUSH_DISABLE=1 -> silent even with settings', () => {
    const config = freshConfig();
    fs.writeFileSync(config, JSON.stringify({ ...DEFAULTS, rules: 'off' }));
    const r = run([], { config, env: { HUSH_DISABLE: '1' } });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout, '');
  });
});

describe('style-settings CLI', () => {
  test('set saves the knobs and prints the reminder', () => {
    const config = freshConfig();
    const r = run(['set', 'next=top', 'terms=inline'], { config });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config, 'utf-8')), { ...DEFAULTS, next: 'top', terms: 'inline' });
    assert.ok(r.stdout.startsWith(HEADER));
  });

  test('set keeps knobs it was not given', () => {
    const config = freshConfig();
    run(['set', 'detail=full'], { config });
    run(['set', 'rules=off'], { config });
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config, 'utf-8')), { ...DEFAULTS, detail: 'full', rules: 'off' });
  });

  test('set rejects an unknown knob or value and writes nothing', () => {
    const config = freshConfig();
    for (const bad of [['set', 'colour=red'], ['set', 'next=middle']]) {
      const r = run(bad, { config });
      assert.strictEqual(r.status, 2);
      assert.ok(r.stderr.length > 0);
    }
    assert.strictEqual(fs.existsSync(config), false);
  });

  test('set preset=<name> sets every knob, and pairs after it win', () => {
    const config = freshConfig();
    run(['set', 'next=top', 'rules=off'], { config });
    const r = run(['set', 'preset=minimal', 'next=top'], { config });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config, 'utf-8')), { ...PRESETS.minimal, next: 'top' });
    assert.ok(r.stdout.includes(fs.readFileSync(path.join(MODULES, 'detail-bare.md'), 'utf-8').trim()));
    assert.ok(!r.stdout.includes('No horizontal rules'));
  });

  test('parse rejects a malformed pair, an inherited name or an untrimmed one, and changes nothing', () => {
    const bad = ['next', 'next=top=end', '=top', 'next=', '=', '', ' next=top', 'next= top', 'next =top',
      'constructor=x', 'toString=x', '__proto__=x', 'hasOwnProperty=on', 'preset=constructor', 'preset=toString',
      'preset=__proto__', 'preset=', 'next=toString', 'next=constructor'];
    for (const pair of bad) {
      const { settings, errors } = parse([pair], DEFAULTS);
      assert.strictEqual(errors.length, 1, JSON.stringify(pair));
      assert.deepStrictEqual(settings, DEFAULTS, JSON.stringify(pair));
    }
    assert.deepStrictEqual(parse(['next=top', 'preset=minimal', 'why=on'], DEFAULTS), { settings: { ...PRESETS.minimal, why: 'on' }, errors: [] });
  });

  test('set rejects an unknown preset and writes nothing', () => {
    const config = freshConfig();
    const r = run(['set', 'preset=loud'], { config });
    assert.strictEqual(r.status, 2);
    assert.ok(r.stderr.includes('preset takes'));
    assert.strictEqual(fs.existsSync(config), false);
  });

  test('presets prints every preset', () => {
    const r = run(['presets'], { config: freshConfig() });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(r.stdout), PRESETS);
  });

  test('an older file with only the first five knobs keeps them and defaults the rest', () => {
    const config = freshConfig();
    fs.writeFileSync(config, JSON.stringify({ next: 'top', rules: 'on', detail: 'short', terms: 'footnote', box: 'work' }));
    assert.deepStrictEqual(JSON.parse(run(['show'], { config }).stdout), { ...DEFAULTS, next: 'top', detail: 'short', box: 'work' });
  });

  test('reset returns every knob to its default', () => {
    const config = freshConfig();
    run(['set', 'next=top', 'detail=short'], { config });
    const r = run(['reset'], { config });
    assert.strictEqual(r.status, 0);
    assert.deepStrictEqual(JSON.parse(fs.readFileSync(config, 'utf-8')), DEFAULTS);
    assert.strictEqual(run(['show'], { config }).stdout.trim(), JSON.stringify(DEFAULTS, null, 2));
  });
});
