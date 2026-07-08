#!/usr/bin/env node
'use strict';
// Aggregate run records into report.md (tables) + report.html (tables + SVG
// charts + side-by-side final answers).   node runner/report.js --tag full

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const argv = process.argv.slice(2);
const tag = argv[argv.indexOf('--tag') + 1] || 'dev';
const dir = path.join(ROOT, 'results', tag);

const runs = fs.readdirSync(path.join(dir, 'runs'))
  .filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(dir, 'runs', f), 'utf8')))
  .filter((r) => !r.error);

const ARMS = [...new Set(runs.map((r) => r.arm))].sort(
  (a, b) => (a === 'baseline' ? -1 : b === 'baseline' ? 1 : a.localeCompare(b)));
const TASKS = [...new Set(runs.map((r) => r.task))];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);
const fmt = (x, d = 0) => (Number.isFinite(x) ? x.toFixed(d) : '—');

function agg(rs) {
  return {
    n: rs.length,
    passRate: mean(rs.map((r) => (r.check?.pass ? 1 : 0))),
    score: mean(rs.map((r) => r.check?.score ?? 0)),
    cost: mean(rs.map((r) => r.costUsd ?? NaN)),
    outTok: mean(rs.map((r) => r.usage?.output_tokens ?? NaN)),
    traffic: mean(rs.map((r) => r.contextTraffic ?? NaN)),
    narration: mean(rs.map((r) => r.narrationWords ?? NaN)),
    finalWords: mean(rs.map((r) => r.finalWords ?? NaN)),
    toolChars: mean(rs.map((r) => r.toolResultChars ?? NaN)),
    turns: mean(rs.map((r) => r.numTurns ?? NaN)),
    wallS: mean(rs.map((r) => r.wallMs / 1000)),
  };
}

const byTaskArm = {}; // task -> arm -> agg
for (const t of TASKS) {
  byTaskArm[t] = {};
  for (const a of ARMS) byTaskArm[t][a] = agg(runs.filter((r) => r.task === t && r.arm === a));
}
const byArm = {};
for (const a of ARMS) byArm[a] = agg(runs.filter((r) => r.arm === a));

const delta = (v, base) => (Number.isFinite(v) && Number.isFinite(base) && base > 0
  ? `${v <= base ? '' : '+'}${(((v - base) / base) * 100).toFixed(0)}%` : '—');

const others = ARMS.filter((a) => a !== 'baseline');

// ---------- markdown ----------
let md = `# hush benchmark — run \`${tag}\`\n\n`;
md += `${runs.length} runs · model \`${runs[0]?.model}\` · generated from \`results/${tag}/runs/\`\n\n`;
md += `## Overall (mean per run)\n\n`;
md += `| Arm | Ground truth pass | Cost USD | Output tok | Context traffic tok | Narration words | Final words | Turns | Wall s |\n|---|---|---|---|---|---|---|---|---|\n`;
for (const a of ARMS) {
  const g = byArm[a];
  md += `| **${a}** | ${fmt(g.passRate * 100)}% | ${fmt(g.cost, 4)} | ${fmt(g.outTok)} | ${fmt(g.traffic)} | ${fmt(g.narration)} | ${fmt(g.finalWords)} | ${fmt(g.turns, 1)} | ${fmt(g.wallS)} |\n`;
}
md += `\nDeltas vs baseline — cost: ${others.map((a) => `${a} ${delta(byArm[a].cost, byArm.baseline?.cost)}`).join(', ')}; `;
md += `output tokens: ${others.map((a) => `${a} ${delta(byArm[a].outTok, byArm.baseline?.outTok)}`).join(', ')}; `;
md += `context traffic: ${others.map((a) => `${a} ${delta(byArm[a].traffic, byArm.baseline?.traffic)}`).join(', ')}.\n`;

for (const t of TASKS) {
  md += `\n## ${t}\n\n| Arm | Pass | Score | Cost USD | Output tok | Traffic tok | Narration w | Final w | Tool-result chars | Turns |\n|---|---|---|---|---|---|---|---|---|---|\n`;
  for (const a of ARMS) {
    const g = byTaskArm[t][a];
    md += `| ${a} | ${fmt(g.passRate * 100)}% | ${fmt(g.score, 2)} | ${fmt(g.cost, 4)} | ${fmt(g.outTok)} (${delta(g.outTok, byTaskArm[t].baseline?.outTok)}) | ${fmt(g.traffic)} (${delta(g.traffic, byTaskArm[t].baseline?.traffic)}) | ${fmt(g.narration)} | ${fmt(g.finalWords)} | ${fmt(g.toolChars)} | ${fmt(g.turns, 1)} |\n`;
  }
}
fs.writeFileSync(path.join(dir, 'report.md'), md);

// ---------- html ----------
// Colors are assigned by arm, not hard-coded to any particular plugin name:
// baseline stays neutral grey, hush its blue, any extra arm gets the next hue.
const FIXED = { baseline: '#8a8f98', hush: '#4c9be8' };
const EXTRA = ['#e8a04c', '#6ac47a', '#b07be8', '#e86a8a'];
const COLORS = {};
let ei = 0;
for (const a of ARMS) COLORS[a] = FIXED[a] || EXTRA[ei++ % EXTRA.length];
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

function barChart(title, unit, values /* task -> arm -> number */) {
  const cats = Object.keys(values);
  const max = Math.max(...cats.flatMap((c) => ARMS.map((a) => values[c][a] || 0)), 1);
  const W = 940, H = 320, padL = 70, padB = 90, padT = 30;
  const plotW = W - padL - 20, plotH = H - padT - padB;
  const groupW = plotW / cats.length, barW = Math.min(26, (groupW - 14) / ARMS.length);
  let bars = '', labels = '';
  cats.forEach((c, i) => {
    ARMS.forEach((a, j) => {
      const v = values[c][a] || 0;
      const h = (v / max) * plotH;
      const x = padL + i * groupW + (groupW - barW * ARMS.length) / 2 + j * barW;
      bars += `<rect x="${x.toFixed(1)}" y="${(padT + plotH - h).toFixed(1)}" width="${(barW - 3).toFixed(1)}" height="${h.toFixed(1)}" fill="${COLORS[a] || '#999'}"><title>${esc(c)} · ${a}: ${Math.round(v)}</title></rect>`;
    });
    labels += `<text x="${(padL + i * groupW + groupW / 2).toFixed(1)}" y="${H - padB + 16}" transform="rotate(28 ${(padL + i * groupW + groupW / 2).toFixed(1)} ${H - padB + 16})" font-size="11" fill="#444" text-anchor="start">${esc(c)}</text>`;
  });
  let axis = '';
  for (let k = 0; k <= 4; k++) {
    const v = (max / 4) * k, y = padT + plotH - (plotH / 4) * k;
    axis += `<line x1="${padL}" x2="${W - 20}" y1="${y}" y2="${y}" stroke="#e5e5e5"/><text x="${padL - 8}" y="${y + 4}" font-size="10" fill="#777" text-anchor="end">${Math.round(v)}</text>`;
  }
  const legend = ARMS.map((a, j) =>
    `<rect x="${padL + j * 110}" y="6" width="10" height="10" fill="${COLORS[a] || '#999'}"/><text x="${padL + j * 110 + 15}" y="15" font-size="11" fill="#333">${a}</text>`).join('');
  return `<h3>${esc(title)} <span class="unit">(${unit})</span></h3><svg viewBox="0 0 ${W} ${H}" role="img">${axis}${bars}${labels}${legend}</svg>`;
}

const chartOf = (metric) => Object.fromEntries(TASKS.map((t) => [t,
  Object.fromEntries(ARMS.map((a) => [a, byTaskArm[t][a][metric] || 0]))]));

let answers = '';
for (const t of TASKS) {
  answers += `<details><summary><b>${esc(t)}</b> — final answers (rep 1)</summary><div class="cols">`;
  for (const a of ARMS) {
    const r = runs.find((x) => x.task === t && x.arm === a && x.rep === 1);
    answers += `<div class="col"><h4>${a} ${r?.check?.pass ? '✅' : '❌'} · ${r?.usage?.output_tokens ?? '?'} out-tok</h4><pre>${esc(r?.finalText || '(none)')}</pre></div>`;
  }
  answers += `</div></details>`;
}

const overallRows = ARMS.map((a) => {
  const g = byArm[a];
  return `<tr><td><b>${a}</b></td><td>${fmt(g.passRate * 100)}%</td><td>$${fmt(g.cost, 4)}</td><td>${fmt(g.outTok)}</td><td>${fmt(g.traffic)}</td><td>${fmt(g.narration)}</td><td>${fmt(g.finalWords)}</td><td>${fmt(g.turns, 1)}</td><td>${fmt(g.wallS)}s</td></tr>`;
}).join('');

const html = `<title>hush benchmark — ${esc(tag)}</title>
<style>
body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:24px auto;padding:0 16px;color:#1a1a1a}
table{border-collapse:collapse;margin:12px 0}td,th{border:1px solid #ddd;padding:5px 10px;text-align:right}
td:first-child,th:first-child{text-align:left}
svg{width:100%;height:auto;background:#fafafa;border:1px solid #eee;border-radius:6px}
.unit{color:#888;font-weight:normal;font-size:.85em}
details{margin:10px 0;border:1px solid #e5e5e5;border-radius:6px;padding:8px 12px}
.cols{display:flex;gap:10px;flex-wrap:wrap}.col{flex:1;min-width:280px}
pre{white-space:pre-wrap;background:#f6f6f6;padding:8px;border-radius:4px;font-size:12px;max-height:340px;overflow:auto}
</style>
<h1>hush benchmark — run &ldquo;${esc(tag)}&rdquo;</h1>
<p>${runs.length} headless Claude Code sessions · model <code>${esc(runs[0]?.model || '?')}</code> · token counts from the API's own usage blocks.</p>
<h2>Overall (mean per run)</h2>
<table><tr><th>Arm</th><th>Pass</th><th>Cost</th><th>Output tok</th><th>Context traffic</th><th>Narration words</th><th>Final words</th><th>Turns</th><th>Wall</th></tr>${overallRows}</table>
${barChart('Output tokens per task', 'tokens, mean', chartOf('outTok'))}
${barChart('Context traffic per task', 'Σ input+cache tokens across API calls, mean', chartOf('traffic'))}
${barChart('Cost per task', 'USD ×10000, mean', Object.fromEntries(TASKS.map((t) => [t, Object.fromEntries(ARMS.map((a) => [a, (byTaskArm[t][a].cost || 0) * 10000]))])))}
${barChart('Mid-turn narration per task', 'words, mean', chartOf('narration'))}
${barChart('Tool output entering context', 'chars, mean', chartOf('toolChars'))}
<h2>Behavior — side-by-side final answers</h2>
${answers}
`;
fs.writeFileSync(path.join(dir, 'report.html'), html);
console.log(`wrote ${path.join(dir, 'report.md')} and report.html (${runs.length} runs)`);
