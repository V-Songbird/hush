#!/usr/bin/env node
'use strict';
// Turn retained run records into the published claim set: one markdown table
// and the SVG charts that go with it.
//
//   node runner/publish.js --records records/mine-20260101-abc123
//
// Every number a published chart shows comes out of this script, from records
// on disk. Nothing here is hand-typed, and nothing here can read a `results/`
// directory — only hash-verified records qualify.

const fs = require('node:fs');
const path = require('node:path');
const { readRecords } = require('./records.js');
const { segmentReport, armNames, summarize, METRICS, quantile } = require('./stats.js');
const { barChartSvg, armColors } = require('./chart.js');

// Cost is not comparable across batches — a warm prompt cache roughly halves
// it — so a claim built from two batches is not a claim, it is a splice.
function assertOneBatch(runs) {
  const ids = [...new Set(runs.map((r) => r.batchId || '(none)'))];
  if (ids.length > 1) {
    throw new Error(
      `records span ${ids.length} batches (${ids.join(', ')}). Cost and cache behaviour are not comparable ` +
      'across batches — publish one batch, or re-run every arm together in a new one.');
  }
  return ids[0];
}

const fmt = (x, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : '—');
const pctFmt = (x) => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${x.toFixed(1)}%` : '—');

const TABLES = [
  { metric: 'cost', label: 'Cost per session', unit: 'USD', digits: 4 },
  { metric: 'contextTraffic', label: 'Context traffic per session', unit: 'Σ input+cache tokens', digits: 0 },
  { metric: 'outputTokens', label: 'Output tokens per session', unit: 'tokens', digits: 0 },
  { metric: 'narrationWords', label: 'Mid-turn narration per session', unit: 'words', digits: 0 },
];

function metricTable(runs, { metric, label, unit, digits }, arms) {
  const report = segmentReport(runs, { metric });
  let md = `### ${label} <sub>(${unit})</sub>\n\n`;
  md += '| Segment | Arm | n | median | mean | p25–p75 | 95% CI | vs baseline (median) | win rate | worst task |\n';
  md += '|---|---|---|---|---|---|---|---|---|---|\n';
  for (const { segment, arms: byArm } of report) {
    for (const arm of arms) {
      const s = byArm[arm];
      if (!s) continue;
      const v = s.vsBaseline;
      const worst = v?.maxRegression ? `${v.maxRegression.task} ${pctFmt(v.maxRegression.deltaPct)}` : '—';
      md += `| ${segment} | ${arm} | ${s.n} | ${fmt(s.median, digits)} | ${fmt(s.mean, digits)} | `
        + `${fmt(s.p25, digits)}–${fmt(s.p75, digits)} | `
        + `${s.ci95 ? `${fmt(s.ci95[0], digits)}–${fmt(s.ci95[1], digits)}` : '—'} | `
        + `${v ? pctFmt(v.medianDeltaPct) : '—'} | `
        + `${v && Number.isFinite(v.winRate) ? `${Math.round(v.winRate * 100)}%` : '—'} | ${worst} |\n`;
    }
  }
  return md + '\n';
}

function suiteTable(runs, arms) {
  let md = '| Arm | Runs | Mean cost USD | Median cost USD | Mean context traffic | Pass rate | Median wall s |\n|---|---|---|---|---|---|---|\n';
  for (const arm of arms) {
    const rs = runs.filter((r) => r.arm === arm);
    const cost = summarize(rs.map(METRICS.cost));
    const traffic = summarize(rs.map(METRICS.contextTraffic));
    const passes = rs.filter((r) => r.check?.pass).length;
    md += `| ${arm} | ${rs.length} | ${fmt(cost.mean, 4)} | ${fmt(cost.median, 4)} | ${fmt(traffic.mean, 0)} | `
      + `${rs.length ? Math.round((passes / rs.length) * 100) : 0}% | ${fmt(quantile(rs.map(METRICS.wallS), 0.5), 0)} |\n`;
  }
  return md;
}

function chartValues(runs, metric, arms, scale = 1) {
  const report = segmentReport(runs, { metric });
  const out = {};
  for (const { segment, arms: byArm } of report) {
    out[segment] = Object.fromEntries(arms.map((a) => [a, (byArm[a]?.median || 0) * scale]));
  }
  return out;
}

/** The whole claim set as strings — no disk, so tests can read it directly. */
function buildClaims(runs) {
  if (!runs.length) throw new Error('no records to publish');
  const batchId = assertOneBatch(runs);
  const arms = armNames(runs);
  const models = [...new Set(runs.map((r) => r.model).filter(Boolean))];
  const seeds = [...new Set(runs.map((r) => r.seed).filter((s) => s != null))];
  const segments = [...new Set(runs.map((r) => r.segment || 'unsegmented'))].sort();
  const colors = armColors(arms);

  let md = '# hush benchmark — generated claims\n\n';
  md += `Generated from ${runs.length} retained run records · batch \`${batchId}\` · `
    + `model \`${models.join(', ') || '?'}\` · seed \`${seeds.join(', ') || '?'}\` · arms: ${arms.join(', ')}.\n\n`;
  md += `Segments: ${segments.join(', ')}.\n\n`;
  md += '## By segment\n\nEvery figure below is a per-segment distribution. Arms are compared task by task '
    + 'on medians, so one wild run cannot flip a task, and the worst single regression is named rather than '
    + 'averaged away.\n\n';
  for (const t of TABLES) md += metricTable(runs, t, arms);
  md += '## Suite total\n\nAll segments pooled. Segments hold different numbers of tasks, so this line is a '
    + 'headline, not evidence — the per-segment tables above are the evidence.\n\n';
  md += suiteTable(runs, arms);

  const charts = {
    'cost-by-segment.svg': barChartSvg('Cost per session by segment', 'USD ×10000, median',
      chartValues(runs, 'cost', arms, 10000), arms, { colors }),
    'context-traffic-by-segment.svg': barChartSvg('Context traffic by segment', 'Σ input+cache tokens, median',
      chartValues(runs, 'contextTraffic', arms), arms, { colors }),
    'narration-by-segment.svg': barChartSvg('Mid-turn narration by segment', 'words, median',
      chartValues(runs, 'narrationWords', arms), arms, { colors }),
  };
  return { markdown: md, charts, batchId, arms, segments };
}

function main() {
  const argv = process.argv.slice(2);
  const flag = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const recordsDir = path.resolve(flag('records', path.join(__dirname, '..', 'records')));
  const outDir = path.resolve(flag('out', path.join(recordsDir, 'published')));

  const { runs } = readRecords(recordsDir);
  const claims = buildClaims(runs.filter((r) => !r.error));
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'claims.md'), claims.markdown);
  for (const [name, svg] of Object.entries(claims.charts)) fs.writeFileSync(path.join(outDir, name), svg + '\n');
  console.log(`wrote ${path.join(outDir, 'claims.md')} and ${Object.keys(claims.charts).length} charts `
    + `from ${runs.length} records (batch ${claims.batchId})`);
}

if (require.main === module) main();

module.exports = { buildClaims, assertOneBatch, metricTable, suiteTable, chartValues };
