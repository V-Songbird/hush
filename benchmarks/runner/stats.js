'use strict';
// Ordering and statistics for the benchmark harness. Pure functions over plain
// record objects — no I/O, no CLI, so every number below is testable offline.
//
// Two jobs live here because they share one idea: a benchmark result is a
// distribution, not a number. Ordering keeps the distribution honest (arm
// order is shuffled, seeded, replayable); the summaries report the spread
// instead of hiding it behind a suite-wide average.

// --- seeded ordering --------------------------------------------------------

/** 32-bit string hash, so a seed can be a word as easily as a number. */
function hashSeed(seed) {
  const s = String(seed);
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

/** mulberry32: tiny, fast, good enough to shuffle a queue. Same seed, same stream. */
function makeRng(seed) {
  let a = hashSeed(seed);
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates on a copy. */
function shuffled(list, rng) {
  const out = list.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

// --- distributions ----------------------------------------------------------

const finite = (xs) => xs.filter((x) => Number.isFinite(x));

/** Linear-interpolation quantile (the R-7 / Excel definition). */
function quantile(values, q) {
  const xs = finite(values).sort((a, b) => a - b);
  if (!xs.length) return NaN;
  const pos = (xs.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return lo === hi ? xs[lo] : xs[lo] + (xs[hi] - xs[lo]) * (pos - lo);
}

const mean = (values) => {
  const xs = finite(values);
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
};

/** Sample standard deviation; NaN under two data points. */
function stdev(values) {
  const xs = finite(values);
  if (xs.length < 2) return NaN;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / (xs.length - 1));
}

/**
 * n, mean, median, quartiles, range, and a 95% CI on the mean.
 * The CI is a normal approximation — with a handful of reps it is a width
 * hint, not a hypothesis test, which is why the quartiles ship alongside it.
 */
function summarize(values) {
  const xs = finite(values);
  const m = mean(xs);
  const sd = stdev(xs);
  const half = xs.length > 1 ? 1.96 * (sd / Math.sqrt(xs.length)) : NaN;
  return {
    n: xs.length,
    mean: m,
    median: quantile(xs, 0.5),
    p25: quantile(xs, 0.25),
    p75: quantile(xs, 0.75),
    min: xs.length ? Math.min(...xs) : NaN,
    max: xs.length ? Math.max(...xs) : NaN,
    sd,
    ci95: Number.isFinite(half) ? [m - half, m + half] : null,
  };
}

// --- metrics ----------------------------------------------------------------
// Everything here is lower-is-better, which is what makes "win" and
// "regression" one-directional below. Pass rate is scored separately.
const METRICS = {
  cost: (r) => r.costUsd,
  outputTokens: (r) => r.usage?.output_tokens,
  contextTraffic: (r) => r.contextTraffic,
  narrationWords: (r) => r.narrationWords,
  toolResultChars: (r) => r.toolResultChars,
  wallS: (r) => (Number.isFinite(r.wallMs) ? r.wallMs / 1000 : NaN),
};

const usable = (records) => records.filter((r) => r && !r.error);

/** segment -> arm -> records. Records with no segment land under "unsegmented". */
function bySegment(records) {
  const out = {};
  for (const r of usable(records)) {
    const seg = r.segment || 'unsegmented';
    (out[seg] ||= {});
    (out[seg][r.arm] ||= []).push(r);
  }
  return out;
}

const pct = (v, base) => (Number.isFinite(v) && Number.isFinite(base) && base > 0 ? ((v - base) / base) * 100 : NaN);

/**
 * One segment's numbers for one metric: the distribution per arm, plus how
 * each non-baseline arm compares to baseline task by task — win rate (share
 * of tasks it is no worse on) and the single worst regression, named.
 *
 * Per-task comparison uses medians, so one wild rep cannot flip a task.
 */
function segmentReport(records, { metric = 'cost', baseline = 'baseline' } = {}) {
  const read = METRICS[metric];
  if (!read) throw new Error(`unknown metric ${metric}`);
  const segments = bySegment(records);
  const out = [];

  for (const [segment, byArm] of Object.entries(segments).sort(([a], [b]) => a.localeCompare(b))) {
    const arms = {};
    for (const [arm, rs] of Object.entries(byArm)) {
      const values = rs.map(read);
      const tasks = [...new Set(rs.map((r) => r.task))];
      arms[arm] = {
        ...summarize(values),
        tasks: tasks.length,
        passRate: mean(rs.map((r) => (r.check?.pass ? 1 : 0))),
        latencyMedianS: quantile(rs.map((r) => r.wallMs / 1000), 0.5),
        vsBaseline: null,
      };
    }

    const base = byArm[baseline];
    if (base) {
      const baseByTask = {};
      for (const r of base) (baseByTask[r.task] ||= []).push(read(r));
      for (const [arm, rs] of Object.entries(byArm)) {
        if (arm === baseline) continue;
        const armByTask = {};
        for (const r of rs) (armByTask[r.task] ||= []).push(read(r));
        const deltas = [];
        for (const [task, values] of Object.entries(armByTask)) {
          if (!baseByTask[task]) continue;
          const d = pct(quantile(values, 0.5), quantile(baseByTask[task], 0.5));
          if (Number.isFinite(d)) deltas.push({ task, deltaPct: d });
        }
        const worst = deltas.reduce((w, d) => (w === null || d.deltaPct > w.deltaPct ? d : w), null);
        arms[arm].vsBaseline = {
          comparedTasks: deltas.length,
          meanDeltaPct: pct(arms[arm].mean, arms[baseline]?.mean),
          medianDeltaPct: pct(arms[arm].median, arms[baseline]?.median),
          winRate: deltas.length ? deltas.filter((d) => d.deltaPct <= 0).length / deltas.length : NaN,
          maxRegression: worst && worst.deltaPct > 0 ? worst : null,
          perTask: deltas.sort((a, b) => b.deltaPct - a.deltaPct),
        };
      }
    }
    out.push({ segment, arms });
  }
  return out;
}

/** Arm names, baseline first, then alphabetical — the order every table uses. */
function armNames(records, baseline = 'baseline') {
  return [...new Set(usable(records).map((r) => r.arm))].sort(
    (a, b) => (a === baseline ? -1 : b === baseline ? 1 : a.localeCompare(b)));
}

module.exports = {
  hashSeed, makeRng, shuffled,
  quantile, mean, stdev, summarize,
  METRICS, bySegment, segmentReport, armNames, pct,
};
