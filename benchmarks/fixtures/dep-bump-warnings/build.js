#!/usr/bin/env node
'use strict';

// Fake bundler, post dependency-bump. Deterministic ~950-line noisy log full
// of deprecation warnings from the bump, then a link stage that hits two
// real, sequential bugs the bump exposed: an options-shape mismatch first,
// then a stricter flag check second. No randomness, no timestamps — same
// output every run until both are fixed.

const path = require('node:path');

const MODULES = [];
const dirs = ['core', 'utils', 'legacy', 'net', 'ui', 'state', 'io', 'vendor', 'adapters'];
for (const d of dirs) {
  for (let i = 0; i < 24; i++) MODULES.push(`src/${d}/mod_${String(i).padStart(2, '0')}.js`);
}

const DEPRECATIONS = [
  'WARN DEP0142 `fs.exists` is deprecated, use `fs.stat` or `fs.access` — in src/legacy/adapter.js',
  'WARN DEP0198 `Buffer()` constructor is deprecated, use `Buffer.from()` — in src/legacy/bufferShim.js',
  'WARN DEP0233 synchronous loader hook is deprecated, migrate to the async loader API',
  'WARN DEP0250 `punycode` module is deprecated, install a userland alternative',
  'WARN DEP0267 assigning to `module.parent` is deprecated',
];

const out = [];
out.push('fakepack 4.2.0 (bumped from 3.11.2)');
out.push('entry: src/index.js  target: node18  mode: production');
out.push('resolving lockfile changes: 14 packages updated, 2 added, 1 removed');
out.push('');

let compiled = 0;
for (const m of MODULES) {
  compiled++;
  out.push(`[${String(compiled).padStart(3, ' ')}/${MODULES.length}] compile ${m} ... ok (${(m.length * 7) % 90 + 10}ms)`);
  if (compiled % 6 === 0) {
    out.push(DEPRECATIONS[compiled % DEPRECATIONS.length]);
  }
  if (compiled % 9 === 0) {
    out.push('note: tree-shaking pass deferred until link stage');
    out.push('note: tree-shaking pass deferred until link stage');
  }
  if (compiled % 30 === 0) {
    out.push(`progress: ${Math.round((compiled / MODULES.length) * 100)}% — memory ${380 + compiled}MB — cache warm`);
  }
  if (compiled === 63) out.push('WARN W1042 deprecated-api: `crypto.createCipher` used in src/legacy/adapter.js — remove before v5');
  if (compiled === 131) out.push('WARN W2213 unused-export: `formatLegacyDate` exported but never imported, in src/utils/format.js');
  if (compiled === 178) out.push('WARN W3307 circular-import: src/core/graph.js <-> src/state/tracker.js, resolution order is undefined');
}

out.push('');
out.push(`link stage: ${MODULES.length} modules, 4 chunks`);
for (let i = 0; i < 380; i++) {
  out.push(`  dedupe: vendor chunk symbol ${i % 19} folded (pass ${Math.floor(i / 19) + 1})`);
}
out.push('');

// Real link step, run in two phases so a first fix can still trip the second
// bug the same bump introduced.
try {
  const { resolveRetries } = require(path.join(__dirname, 'src', 'core', 'options.js'));
  const { isBackoffEnabled } = require(path.join(__dirname, 'src', 'net', 'retryPolicy.js'));

  // New bundler hands options in the { retryCount } shape.
  const retries = resolveRetries({ retryCount: 3 });
  out.push(`link ok: retry budget resolved to ${retries}`);

  // New config loader leaves unset flags as `undefined`, not `false`.
  const backoff = isBackoffEnabled({});
  out.push(`link ok: exponential backoff ${backoff ? 'enabled' : 'disabled'}`);

  out.push('emit: dist/bundle.js  1.61 MB');
  out.push('emit: dist/bundle.js.map  3.40 MB');
  out.push(`build finished in 44.9s with ${DEPRECATIONS.length + 3} warnings, 0 errors`);
  process.stdout.write(out.join('\n') + '\n');
  process.exit(0);
} catch (err) {
  out.push(`ERROR EBUILD02 link-failed: ${err.name}: ${err.message}`);
  out.push(`build aborted with ${DEPRECATIONS.length + 3} warnings, 1 error`);
  process.stdout.write(out.join('\n') + '\n');
  process.exit(1);
}
