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
  candidatePath,
  targetCheck,
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

// A durable-document shape: frontmatter, a negation, a quantity, a link, two
// identifiers, a qualifier, and an ordered pair.
const DURABLE = [
  '---',
  'name: notes',
  'model: opus',
  '---',
  '',
  '# Rules',
  '',
  'The agent must never write to the original file.',
  'Timeout is 30s for each retry, see [the doc](./docs/retry.md).',
  'Set NODE_ENV before running buildAll().',
  'Usually the cache holds; run step A before step B.',
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

describe('unit: frontmatter is mechanical', () => {
  test('an unchanged frontmatter block passes', () => {
    assert.strictEqual(verify(DURABLE, DURABLE).ok, true);
  });

  test('a deleted frontmatter block is caught', () => {
    const mutated = DURABLE.replace('---\nname: notes\nmodel: opus\n---\n\n', '');
    const result = verify(DURABLE, mutated);
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.frontmatter.includes('name: notes'));
  });

  test('a mutated frontmatter value is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('model: opus', 'model: sonnet'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.frontmatter.includes('model: opus'));
  });

  test('frontmatter invented where the original had none is caught', () => {
    const result = verify(SAMPLE, `---\nname: x\n---\n${SAMPLE}`);
    assert.strictEqual(result.ok, false);
    assert.deepStrictEqual(result.missing.frontmatter, ['frontmatter block is not byte-identical']);
  });
});

describe('unit: adversarial edits', () => {
  test('a flipped negation is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('must never write', 'must write'));
    assert.strictEqual(result.ok, false);
    assert.match(result.missing.negations[0], /negation words: 1 in the original, 0 in the candidate/);
  });

  test('an added negation is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('Set NODE_ENV', 'Do not set NODE_ENV'));
    assert.strictEqual(result.ok, false);
    assert.match(result.missing.negations[0], /2 in the candidate/);
  });

  test('a changed quantity is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('30s', '3000s'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.numbers.includes('30'));
  });

  test('a dropped CONST_CASE identifier is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('NODE_ENV', 'the env var'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.identifiers.includes('NODE_ENV'));
  });

  test('a dropped camelCase identifier is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('buildAll()', 'the build'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.identifiers.includes('buildAll'));
  });

  test('a repointed link target is caught', () => {
    const result = verify(DURABLE, DURABLE.replace('./docs/retry.md', './docs/other.md'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.linkTargets.includes('./docs/retry.md'));
  });

  test('an edit inside a code block is caught', () => {
    const result = verify(SAMPLE, SAMPLE.replace('const x = 1;', 'const x = 2;'));
    assert.strictEqual(result.ok, false);
    assert.ok(result.missing.codeBlocks.includes('const x = 1;\n'));
  });

  test('a genuine compression of the same content passes', () => {
    const compressed = DURABLE.replace(
      'The agent must never write to the original file.',
      'Agent must never write to the original file.'
    ).replace('Timeout is 30s for each retry', 'Timeout 30s per retry');
    assert.strictEqual(verify(DURABLE, compressed).ok, true);
  });

  // These two pass mechanically by design: no script here reads meaning, so a
  // dropped qualifier and a reordered dependency are the semantic change
  // report's job, not the verifier's.
  test('a dropped qualifier passes mechanically', () => {
    const result = verify(DURABLE, DURABLE.replace('Usually the cache holds', 'Cache holds'));
    assert.strictEqual(result.ok, true);
  });

  test('reordered meaning passes mechanically', () => {
    const result = verify(
      DURABLE,
      DURABLE.replace('run step A before step B', 'run step B before step A')
    );
    assert.strictEqual(result.ok, true);
  });
});

describe('unit: target check', () => {
  const never = () => false;

  test('candidatePath inserts .hush before the extension', () => {
    assert.strictEqual(
      candidatePath(path.join('some', 'path', 'CLAUDE.md')),
      path.join('some', 'path', 'CLAUDE.hush.md')
    );
  });

  test('candidatePath appends .hush when there is no extension', () => {
    assert.strictEqual(candidatePath('CLAUDE'), path.join('.', 'CLAUDE.hush'));
  });

  test('a supported file with no candidate yet is allowed', () => {
    const result = targetCheck(path.join('notes', 'CLAUDE.md'), never);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.refusals, []);
    assert.strictEqual(result.candidate, path.join('notes', 'CLAUDE.hush.md'));
  });

  test('an existing candidate is refused, never overwritten', () => {
    const result = targetCheck('CLAUDE.md', (p) => p.endsWith('CLAUDE.hush.md'));
    assert.strictEqual(result.ok, false);
    assert.match(result.refusals[0], /refusing to overwrite/);
  });

  test('an unsupported format is refused', () => {
    const result = targetCheck('handbook.pdf', never);
    assert.strictEqual(result.ok, false);
    assert.match(result.refusals[0], /unsupported format \.pdf/);
  });

  test('an extensionless file is an unsupported format', () => {
    const result = targetCheck('CLAUDE', never);
    assert.strictEqual(result.ok, false);
    assert.match(result.refusals[0], /unsupported format \(no extension\)/);
  });
});

describe('CLI', () => {
  const SCRIPT = path.join(__dirname, '..', 'scripts', 'verify-compression.js');

  test('--target exits 0 and prints the candidate path when nothing is there', () => {
    const fs = require('fs');
    const os = require('os');
    const original = path.join(os.tmpdir(), `hush-target-free-${process.pid}.md`);
    fs.writeFileSync(original, SAMPLE);
    try {
      const r = spawnSync('node', [SCRIPT, '--target', original], { encoding: 'utf-8' });
      assert.strictEqual(r.status, 0);
      assert.match(r.stdout, /hush-target-free-\d+\.hush\.md/);
    } finally {
      fs.unlinkSync(original);
    }
  });

  test('--target exits 1 when the candidate already exists', () => {
    const fs = require('fs');
    const os = require('os');
    const original = path.join(os.tmpdir(), `hush-target-taken-${process.pid}.md`);
    const candidate = path.join(os.tmpdir(), `hush-target-taken-${process.pid}.hush.md`);
    fs.writeFileSync(original, SAMPLE);
    fs.writeFileSync(candidate, 'hand-edited draft');
    try {
      const r = spawnSync('node', [SCRIPT, '--target', original], { encoding: 'utf-8' });
      assert.strictEqual(r.status, 1);
      assert.match(r.stdout, /refusing to overwrite/);
      assert.strictEqual(fs.readFileSync(candidate, 'utf-8'), 'hand-edited draft');
    } finally {
      fs.unlinkSync(original);
      fs.unlinkSync(candidate);
    }
  });

  test('--target without a path prints usage and exits 1', () => {
    const r = spawnSync('node', [SCRIPT, '--target'], { encoding: 'utf-8' });
    assert.strictEqual(r.status, 1);
    assert.match(r.stderr, /Usage/);
  });

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
