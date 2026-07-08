'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { spawnSync } = require('child_process');
const {
  verify,
  extractHeadings,
  extractCodeBlocks,
  extractUrls,
  extractPaths,
  extractInlineCode,
} = require('../scripts/verify-compression');

const SAMPLE = [
  '# Title',
  '',
  'Some text with a url https://example.com/page and a path ./src/foo.js and inline `code`.',
  '',
  '## Sub heading',
  '',
  '```js',
  'const x = 1;',
  '```',
  '',
].join('\n');

describe('unit: extractors', () => {
  test('extractHeadings finds level + text', () => {
    assert.deepStrictEqual(extractHeadings(SAMPLE), new Set(['# Title', '## Sub heading']));
  });

  test('extractCodeBlocks captures fenced body verbatim', () => {
    assert.deepStrictEqual(extractCodeBlocks(SAMPLE), new Set(['const x = 1;\n']));
  });

  test('extractUrls finds http(s) links', () => {
    assert.deepStrictEqual(extractUrls(SAMPLE), new Set(['https://example.com/page']));
  });

  test('extractPaths finds file-path-shaped tokens', () => {
    assert.ok(extractPaths(SAMPLE).has('./src/foo.js'));
  });

  test('extractInlineCode ignores fenced blocks, catches backticks', () => {
    assert.deepStrictEqual(extractInlineCode(SAMPLE), new Set(['code']));
  });
});

describe('unit: verify', () => {
  test('identical content passes', () => {
    const result = verify(SAMPLE, SAMPLE);
    assert.strictEqual(result.ok, true);
    for (const arr of Object.values(result.missing)) assert.deepStrictEqual(arr, []);
  });

  test('a dropped URL is caught', () => {
    const mutated = SAMPLE.replace('https://example.com/page', 'a link');
    const result = verify(SAMPLE, mutated);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.urls.includes('https://example.com/page'));
  });

  test('a dropped code block is caught', () => {
    const mutated = SAMPLE.replace('```js\nconst x = 1;\n```\n', '');
    const result = verify(SAMPLE, mutated);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.codeBlocks.includes('const x = 1;\n'));
  });

  test('a dropped heading is caught', () => {
    const mutated = SAMPLE.replace('## Sub heading\n\n', '');
    const result = verify(SAMPLE, mutated);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.headings.includes('## Sub heading'));
  });

  test('a dropped inline code token is caught', () => {
    const mutated = SAMPLE.replace('`code`', 'code');
    const result = verify(SAMPLE, mutated);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.inlineCode.includes('code'));
  });

  test('rewording prose around preserved elements does not false-positive', () => {
    const reworded = SAMPLE.replace(
      'Some text with a url',
      'Text: url'
    );
    const result = verify(SAMPLE, reworded);
    assert.strictEqual(result.ok, true);
  });
});

describe('CLI', () => {
  const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-compression.js');

  test('exits 0 and prints ok:true for identical files', () => {
    const fs = require('fs');
    const os = require('os');
    const a = path.join(os.tmpdir(), `hush-verify-a-${process.pid}.md`);
    const b = path.join(os.tmpdir(), `hush-verify-b-${process.pid}.md`);
    fs.writeFileSync(a, SAMPLE);
    fs.writeFileSync(b, SAMPLE);
    try {
      const r = spawnSync('node', [SCRIPT, a, b], { encoding: 'utf-8' });
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /"ok": true/);
    } finally {
      fs.unlinkSync(a);
      fs.unlinkSync(b);
    }
  });

  test('exits 1 when something is missing', () => {
    const fs = require('fs');
    const os = require('os');
    const a = path.join(os.tmpdir(), `hush-verify-c-${process.pid}.md`);
    const b = path.join(os.tmpdir(), `hush-verify-d-${process.pid}.md`);
    fs.writeFileSync(a, SAMPLE);
    fs.writeFileSync(b, SAMPLE.replace('https://example.com/page', 'a link'));
    try {
      const r = spawnSync('node', [SCRIPT, a, b], { encoding: 'utf-8' });
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /"ok": false/);
    } finally {
      fs.unlinkSync(a);
      fs.unlinkSync(b);
    }
  });

  test('missing args prints usage and exits 1', () => {
    const r = spawnSync('node', [SCRIPT], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /Usage/);
  });
});
