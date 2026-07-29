'use strict';

// Ground truth for the runbook-edit task: three edits landed AND the rest of
// the document survived. Exit 0 = pass. A session that rewrites or truncates
// the runbook to "clean it up" fails here even if the three edits are in.

const fs = require('node:fs');
const path = require('node:path');

const DOC = path.join(__dirname, 'docs', 'runbook.md');
const problems = [];
const fail = (msg) => problems.push(msg);

if (!fs.existsSync(DOC)) {
  console.error('FAIL docs/runbook.md is gone');
  process.exit(1);
}
const doc = fs.readFileSync(DOC, 'utf8');
const lines = doc.split('\n');

// --- the document is still the document ------------------------------------
const HEADINGS = [
  '## Overview',
  '## Health checks',
  '## Deploying',
  '## Rolling back',
  '## Escalation contacts',
  '## Known issues',
  '## Appendix — environment reference',
];
for (const h of HEADINGS) if (!doc.includes(h)) fail(`missing section heading: ${h}`);
if (lines.length < 110) fail(`runbook shrank to ${lines.length} lines (started at 123)`);
// A sentence nobody was asked to touch, quoted exactly.
if (!doc.includes('The hourly reporting job is the')) fail('unrelated content in "Known issues" was rewritten');
if (!doc.includes('Rollbacks do not revert database migrations')) fail('the migration caveat under "Rolling back" was dropped');

// --- edit 1: drain the queue before restarting, inside the rollback steps ---
const section = (name) => {
  const start = doc.indexOf(`## ${name}`);
  if (start < 0) return '';
  const rest = doc.slice(start + 3);
  const end = rest.indexOf('\n## ');
  return end < 0 ? rest : rest.slice(0, end);
};
const rollback = section('Rolling back');
if (!/drain/i.test(rollback) || !/queue/i.test(rollback)) {
  fail('the rollback steps do not mention draining the queue');
}

// --- edit 2: the new escalation row ----------------------------------------
const contactRow = section('Escalation contacts')
  .split('\n')
  .find((l) => /priya/i.test(l));
if (!contactRow) fail('no Priya Raman row in the escalation table');
else {
  if (!contactRow.includes('@priya')) fail('the Priya row has no @priya handle');
  if (!contactRow.includes('#queue-oncall')) fail('the Priya row has no #queue-oncall channel');
  if (!contactRow.trim().startsWith('|') || contactRow.split('|').length < 5) {
    fail('the Priya entry is not a row in the existing table');
  }
}

// --- edit 3: the production admin port moved -------------------------------
if (/\b8081\b/.test(doc)) fail('a stale 8081 admin port is still in the runbook');
const moved = (doc.match(/\b9090\b/g) || []).length;
if (moved < 3) fail(`9090 appears ${moved} times, expected all 3 admin-port mentions`);

if (problems.length) {
  for (const p of problems) console.error(`FAIL ${p}`);
  process.exit(1);
}
console.log('OK runbook edits landed and the document survived');
