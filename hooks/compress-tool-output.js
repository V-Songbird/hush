#!/usr/bin/env node
"use strict";

// PostToolUse hook: mechanically shrinks Bash/PowerShell output — plus Read
// results for log-shaped and machine-generated files, hush's own recovery
// files, and oversized Grep match lists — before they enter context.
// Deterministic text transforms only — no heuristic ever touches failure
// detail: failing runs get a much larger cap and everything kept is verbatim.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readInput, emitToolOutput, decodeResponse, SHELL_FIELDS, lastUserPromptText } = require("./lib/harness");
const { safeWriteFileSync } = require("./lib/safe-write");
const { combineActions, buildRecord, recoveryGap, sizeGap, fieldGap, debugManifestPath, appendRecord } = require("./lib/transform-manifest");
const sidecarStore = require("./lib/sidecar-store");
const { coreOff, isOff } = require("./lib/gate");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell", "Read", "Grep"]);

// Caps are in lines. Passing output is mostly noise (install trees, progress
// logs); failing output is evidence, so it keeps ~4x more.
const CAP_PASS = intEnv("HUSH_CAP_PASS", 60);
const CAP_FAIL = intEnv("HUSH_CAP_FAIL", 250);
// Enumeration carve-out cap (see requestsEnumeration). Large enough that a
// normal noisy build/log passes whole — no omission markers at all — so a model
// asked to report EVERY item has nothing elided to distrust. Still bounded, so
// a pathological megaline dump can't blow context.
const CAP_ENUMERATE = 2000;
// Grep content-mode results below this size pass whole; above it, each
// matched file keeps its first few match lines and the rest collapse to a
// per-file count (compressGrep). A small result costs little to send whole,
// and per-file counts keep the file map intact. compress() uses the same floor
// for same-shape collapse (collapseTemplates) and for the line cap (capLines).
const GREP_MIN_CHARS = 4000;
const GREP_KEEP_PER_FILE = 3;

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07]*(?:\x07|\x1b\\)/g;

function stripAnsi(text) {
  return text.replace(ANSI_RE, "");
}

// Progress bars redraw via a bare \r (no following \n); only the final state
// of each physical line matters. \r\n is an ordinary Windows line ending, not
// a redraw — normalize it away first or every CRLF-terminated line (i.e.
// nearly all native Windows console output) collapses to empty.
function resolveCarriageReturns(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => {
      const i = line.lastIndexOf("\r");
      return i === -1 ? line : line.slice(i + 1);
    })
    .join("\n");
}

// Keep lines (isKeepLine) never join a repeat run: six identical
// "ERROR: connection refused" lines are six failures, and folding them into
// one line plus a count contradicts what the capped-failure footer promises
// about keeping every failure line in original order.
function dedupeConsecutive(lines) {
  const out = [];
  let run = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && out.length && lines[i] === out[out.length - 1] && lines[i].trim() !== "" && !isKeepLine(lines[i])) {
      run++;
      continue;
    }
    if (run > 0) out.push(`[hush: previous line repeated ${run}x]`);
    run = 0;
    if (i < lines.length) out.push(lines[i]);
  }
  return out;
}

// Real logs repeat the same SHAPE far more than they repeat identical lines
// (dedupeConsecutive only catches the latter) — "INFO worker-3 processing job
// 8841" x hundreds, each with a different id/timestamp. Collapsing those runs
// compounds hush's strongest domain. Two lines "share a template" iff: same
// token count; >=50% of positions token-identical; and >=2 of those identical
// positions are "anchor" tokens (>=3 chars, no digits) — the anchor floor is
// what stops two lines merging on a shared timestamp or short flag alone.
// Comparison is always against the run's first line (its exemplar), so the
// whole run stays anchored to one shape instead of drifting line to line.
const TEMPLATE_MIN_RUN = 5;

function templateTokens(line) {
  return line.trim().split(/\s+/).filter(Boolean);
}

function isAnchorToken(tok) {
  return tok.length >= 3 && !/\d/.test(tok);
}

function shareTemplate(aTokens, bTokens) {
  if (!aTokens.length || aTokens.length !== bTokens.length) return false;
  let same = 0;
  let anchors = 0;
  for (let i = 0; i < aTokens.length; i++) {
    if (aTokens[i] === bTokens[i]) {
      same++;
      if (isAnchorToken(aTokens[i])) anchors++;
    }
  }
  return same / aTokens.length >= 0.5 && anchors >= 2;
}

// INVARIANTS of template collapse — what may be collapsed, and what never
// may. Stated here because the view's own footer
// (TEMPLATE_COLLAPSE_NOTE) states them to the model, and a promise the code
// does not keep is worse than no promise:
//
//   1. Only a line that shares its run exemplar's shape is ever dropped: same
//      token count, >=50% of positions token-identical, >=2 identical anchor
//      tokens (shareTemplate). The exemplar itself is always kept verbatim.
//   2. A keep line (isKeepLine — warning/error/failure/deprecation/critical) is
//      never collapsed — it never joins a run and always breaks one. Over-normalizing
//      distinct errors into one exemplar is the known failure mode this
//      sidesteps entirely, rather than trying to tune around it.
//   3. A line naming a prompt-quoted identifier is never collapsed either, on
//      the same terms capLines and compressGrep use it: high-precision spans
//      only, and a span matching more than RELEVANCE_COMMON lines is dropped as
//      too common to discriminate.
//   4. A line that names a failing go test (`=== RUN` and the like, see
//      goFailureIdx) is never collapsed, so capLines can still tell which
//      test the lines after it belong to.
//   5. In a failing run, or a file dump whose text reads as one, a line kept
//      for where it sits next to a failure (contextIdx: a first frame, a
//      failed check's values and file:line) is never collapsed, so capLines
//      can keep what the fold would have hidden.
//      That set holds at most REPORT_LINES_MAX go test lines per failed
//      test, so the rest of a long test may fold.
//   6. Fewer than TEMPLATE_MIN_RUN same-shape lines collapse to nothing at all;
//      the run is emitted verbatim.
//
// Anything outside 2-6 is fair game, and the dropped lines are NOT recoverable
// from the view — only from the source, which is what the footer names.
function collapseTemplates(lines, relevanceTokens, failed) {
  if (isOff("HUSH_TEMPLATE")) return lines;
  const named = relevanceMatcher(lines, relevanceTokens);
  const goNames = new Set(goFailureIdx(lines, true));
  const context = new Set(failed ? contextIdx(lines) : []);
  const exempt = (line, i) => isKeepLine(line) || named(line) || goNames.has(i) || context.has(i);
  const out = [];
  let runStart = -1;
  let anchorTokens = null;
  let runLen = 0;
  let repeats = 0;

  function flushRun(end) {
    if (runLen >= TEMPLATE_MIN_RUN) {
      out.push(lines[runStart]);
      out.push(`[hush hook: ${runLen - 1 + repeats} similar lines collapsed (same shape, varying values)]`);
    } else {
      out.push(...lines.slice(runStart, end));
    }
    runStart = -1;
    anchorTokens = null;
    runLen = 0;
    repeats = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // A repeat marker counts copies of the line before it. Inside a run those
    // copies share the run's shape, so the collapse counts them too: left in
    // the view, the marker would follow a line the fold dropped.
    const repeated = runLen > 0 && FOLD_MARKER_RE.exec(line)?.[2];
    if (repeated) {
      repeats += Number(repeated);
      continue;
    }
    if (exempt(line, i)) {
      if (runLen > 0) flushRun(i);
      out.push(line);
      continue;
    }
    const lineTokens = templateTokens(line);
    if (runLen > 0 && shareTemplate(anchorTokens, lineTokens)) {
      runLen++;
      continue;
    }
    if (runLen > 0) flushRun(i);
    runStart = i;
    anchorTokens = lineTokens;
    runLen = 1;
  }
  if (runLen > 0) flushRun(lines.length);
  return out;
}

// The one line a collapsed view owes the model: which lines could not have
// been collapsed (so the visible slice can be trusted for signal), and where
// the collapsed ones actually are. Stated once per view rather than per run —
// the per-run marker stays cheap, and a view with a dozen collapses does not
// repeat 300 characters of guidance a dozen times.
//
// The retrieval instruction has to be true for BOTH sources this transform
// runs on: a shell command (nothing on disk to read) and a watched Read (the
// file is there, but a plain re-read gets compressed again). A ranged read is
// the one route that returns source text verbatim in every case — see the
// isRangeRead guard in main() — so that is what it names, with "re-run into a
// file" as the shell half.
//
// The prompt-named half carries its own caveat (invariant 3 above): a quoted
// span matching more than RELEVANCE_COMMON lines is dropped as too common to
// discriminate, so an absolute "never collapsed" was a promise the code did
// not keep. One clause states the exception rather than hiding it.
const TEMPLATE_COLLAPSE_NOTE =
  "[hush hook: each collapse above kept its run's first line verbatim and dropped only later lines of the same shape; " +
  "no warning/error/failure line is ever collapsed, and no line naming something quoted in your prompt — " +
  "unless the quote matches too many lines to single any out. " +
  "For the dropped lines themselves, Read the source file with offset/limit — ranged reads are returned verbatim — " +
  "or re-run the command into a file and read that.]";

// The retrieval half alone, for a view whose collapses saved less than the
// full note costs.
const TEMPLATE_RECOVERY_NOTE =
  "[hush hook: to see collapsed lines, Read the file with offset/limit or re-run the command into a file.]";

// Lines that look like they carry the task's actual signal (warnings, errors,
// deprecations) survive the cap regardless of position — only surrounding
// noise (progress logs, install trees) gets cut. A blind head+tail slice can
// clip a build warning out of a passing run, and the model then re-runs the
// command to find what it cannot see — a cap that destroys signal costs more
// tool calls than it saves. Deliberately
// broad regex: over-matching just keeps a few extra lines, never worse.
// The trailing `(?:Error|Warning)\b` catches compound runtime names —
// ReferenceError, TypeError, SyntaxError, RangeError — that a bare `\bERROR\b`
// misses because the "Error" suffix sits mid-word (no word boundary before
// it). Over-matching a stray "NoError"-style token only keeps a few extra
// lines, never fewer, so the broad form is safe by the same logic as the rest.
// `Exception` does the same for Java-style names — IllegalStateException,
// NullPointerException — which FAILURE_RE misses, because it needs a
// non-alphanumeric character before "exception".
// Deliberately UNANCHORED on the left: a leading `\w*` matches the same set of
// lines (it can always match empty, and nothing here reads the matched text)
// while making the pattern backtrack quadratically on a long run of word
// characters — one 256KB line of base64 or minified JS takes about 68 seconds,
// against this hook's own 5-second budget.
// `WARNINGS?` takes the plural a toolchain summary uses ("Compiled with
// warnings.", "3 warnings generated."). FAILURE_RE cannot supply it: a warning
// never means the run failed, so that pattern has no warning alternative. The
// plural sits in the left-anchored alternation, so a longer word that merely
// ends in "warnings" never matches.
// `ERR(?:OR)?` and `FAIL(?:URE|ED)?` name the signal words here and widen
// nothing: isKeepLine ORs SIGNAL_RE with FAILURE_RE, which matches every line
// those two match, so deleting them would change no line kept. What only
// SIGNAL_RE keeps is warnings, deprecations, criticals and the compound
// *Error, *Warning and *Exception names.
const SIGNAL_RE = /\b(WARN(?:INGS?)?|ERR(?:OR)?|FAIL(?:URE|ED)?|DEPRECATED|CRITICAL)\b|(?:Error|Warning|Exception)\b/i;

// A bare "N lines omitted" reads to the model as "signal might be hidden in
// this gap." On a completeness task ("report EVERY warning") that distrust is
// rational and expensive: the model can't know the cap preserved every signal
// line, so it re-runs the command to recover what it thinks it's missing —
// each extra turn re-sends full context and the compression backfires. But
// capLines keeps every keep line by construction, so an omitted span
// PROVABLY contains no warning/error/failure line. State that guarantee in the
// marker itself: it converts hush's internal knowledge into something the model
// can act on, so the visible slice is trustworthy and no re-run is needed.
//
// The marker also names its own provenance ("hush hook") and frames the cut as
// a view, not a mutation. Claude Code's base system prompt orders the model to
// flag suspected prompt injections in tool results, and an anonymous bracketed
// claim sitting inside file content — telling the model it may skip content —
// is exactly injection-shaped, so a model may flag it mid-turn and re-read
// the whole file. The same base prompt
// also tells the model "Hooks may intercept tool calls", so a marker that
// attributes itself to a hook attaches to a fact the harness itself planted.
// Provenance is stated, never argued: no "trust me", no "not an injection" —
// naming the feared category primes it.
function omittedMarker(n) {
  return `[hush hook: ${n} lines omitted from this view, none with warnings/errors/failures]`;
}

// Closing line on a capped view of a FAILING run — the same recovery advice
// the sidecar header gives its own path, for the failures that stay inline.
// Never on a Read: it ran nothing, and its omission markers already say no
// failure line was cut.
// capLines keeps every keep line by construction — and the keep vocabulary is
// the union of signal and failure evidence, so the first causal error and the
// failing summary are all above this line, with stack frames as well:
// every frame of a Python traceback is a keep line, and for Node, Java and Go
// the first frame after each keep line joins them (firstFrameIdx), never the
// rest of the stack. The values and file:line lines of a failure's own
// report join them too (contextIdx), for go test, Jest, Vitest, RSpec,
// cargo test and pytest. The guarantee is provable, which is why it is
// stated as one rather than as reassurance.
const FAILURE_RERUN_NOTE =
  "[hush hook: this run failed and the view above is capped — every warning/error/failure line " +
  "from the full output is kept, in original order. Re-run the command for the lines omitted between them.]";

// Every line this file inserts into a line-oriented view opens this way (the
// omission marker and failure note above, the dedupe and template-collapse
// markers and notes, the grep summary header, the exit note and the sidecar
// digest header). compress() counts lines by it for the manifest, capLines
// keeps a marker with the line it annotates, and hasHushNote tells a rewrite
// that carries one of hush's notes from one that does not.
const HUSH_MARKER_RE = /^\[hush(?: hook)?: /;

// Characters a model reads and a person does not see: zero-width characters,
// the word joiner, a byte order mark, bidi embeddings, overrides and isolates,
// and Unicode tags. Copied from HIDDEN_CHARACTERS in Foreman's
// scripts/check-prompt.js (Foreman 632); a plugin never loads another's code.
const HIDDEN = "\\u200B-\\u200D\\u2060\\uFEFF\\u202A-\\u202E\\u2066-\\u2069\\u{E0000}-\\u{E007F}";

// A line of the output itself that opens like a marker would pass for hush
// talking, and the accounting would count it as hush's own. A backslash in
// front of the bracket, `\[hush`, keeps it readable and takes it out of both.
// The match reads the line as a model does: any spaces (what \s matches, less
// the line breaks) or hidden characters before it, hidden characters inside
// `[hush`, and letters that read as `[hush` in any case. Every visible
// character folds on its own under NFKC, which turns fullwidth, mathematical,
// circled and modifier letters and the fullwidth and vertical brackets into
// the plain ones; one at a time, so a combining mark cannot merge with the
// last h and hide the rest. HOMOGLYPHS then maps the Cyrillic and Greek
// letters drawn like H, h, u, S and s, which NFKC leaves alone. Only a
// bracket followed by h, H or a non-ASCII character reaches the fold, so a
// `[INFO]` line costs one regex step. compress() applies it to the input
// before any view is built, and compressGrep to the lines of a view it
// shortens, so every marker left opening with `[hush` is one this file wrote.
const LEAD = ` \\t\\v\\f\\u00A0\\u1680\\u2000-\\u200A\\u202F\\u205F\\u3000${HIDDEN}`;
const MARKER_LOOKALIKE_RE = new RegExp(`^([${LEAD}]*)([\\[\\uFE47\\uFF3B](?=[hH]|[^\\x00-\\x7F]).*)`, "gmu");
const HIDDEN_RE = new RegExp(`[${HIDDEN}]`, "u");
// Cyrillic Н (en), Һ and һ (shha) and Greek Η (eta) for h; Greek υ (upsilon)
// for u; Cyrillic Ѕ and ѕ (dze) for s. Each is drawn the same as the Latin
// letter. The set is short on purpose: look-alikes from other scripts, such
// as Armenian, are not matched.
const HOMOGLYPHS = {
  "\u041D": "h", "\u04BA": "h", "\u04BB": "h", "\u0397": "h",
  "\u03C5": "u",
  "\u0405": "s", "\u0455": "s",
};

function opensLikeHush(rest) {
  let folded = "";
  for (const ch of rest) {
    if (folded.length >= 5) break;
    if (!HIDDEN_RE.test(ch)) folded += (HOMOGLYPHS[ch] ?? ch.normalize("NFKC")).toLowerCase();
  }
  return folded.startsWith("[hush");
}

function escapeMarkerLookalikes(text) {
  return text.replace(MARKER_LOOKALIKE_RE, (line, lead, rest) => (opensLikeHush(rest) ? `${lead}\\${rest}` : line));
}

// Identifiers the user's own prompt names — backticked or quoted spans like
// `ioredis` or "W1042" — are that turn's signal even when they match no
// warning/error pattern. A capped view that happens to cut the one entry the
// prompt asked about forces a second lookup, and every extra tool call
// re-sends the whole history; keeping prompt-named lines makes the single-
// read path the common case. High-precision extraction only (explicitly
// marked spans, never bare words), and a span matching more than
// RELEVANCE_COMMON lines is dropped as too common to discriminate.
const RELEVANCE_COMMON = 50;
const RELEVANCE_MAX_TOKENS = 8;

function extractRelevanceTokens(prompt) {
  if (typeof prompt !== "string" || !prompt) return [];
  const spans = [];
  for (const m of prompt.matchAll(/`([^`\n]{3,80})`|"([^"\n]{3,80})"|'([^'\n]{3,80})'/g)) {
    const s = (m[1] || m[2] || m[3] || "").trim().toLowerCase();
    if (s && !spans.includes(s)) spans.push(s);
  }
  return spans.slice(0, RELEVANCE_MAX_TOKENS);
}

// The too-common guard, in the shape the line-by-line transforms need it: a
// prompt-named span matching more than RELEVANCE_COMMON lines cannot
// discriminate — for a Grep the quoted SEARCH PATTERN itself sits in every
// match line by definition — so it is dropped rather than exempting the whole
// view from compression.
function usableRelevanceTokens(lines, relevanceTokens) {
  if (!relevanceTokens || !relevanceTokens.length) return [];
  const lower = lines.map((l) => l.toLowerCase());
  return relevanceTokens.filter((tok) => {
    let hits = 0;
    for (const l of lower) if (l.includes(tok)) hits++;
    return hits > 0 && hits <= RELEVANCE_COMMON;
  });
}

// "Does this line name something the prompt quoted?", with the too-common
// guard already applied — the one shape every transform needs (capLines,
// collapseTemplates, compressGrep, buildSidecarDigest). Built once per view so
// the lowercasing and the hit counting happen once, not per call site.
function relevanceMatcher(lines, relevanceTokens) {
  const tokens = usableRelevanceTokens(lines, relevanceTokens);
  if (!tokens.length) return () => false;
  return (line) => {
    const lower = line.toLowerCase();
    return tokens.some((t) => lower.includes(t));
  };
}

// The same answer as indices, for the transforms that select by position.
function relevanceLineIdx(lines, relevanceTokens) {
  const named = relevanceMatcher(lines, relevanceTokens);
  return lines.map((line, i) => (named(line) ? i : -1)).filter((i) => i !== -1);
}

const FOLD_MARKER_RE = /^\[hush hook: (\d+) similar lines collapsed |^\[hush: previous line repeated (\d+)x\]$/;

function capLines(lines, cap, relevanceTokens) {
  if (lines.length <= cap) return lines;
  const signalIdx = new Set();
  lines.forEach((line, i) => {
    if (isKeepLine(line)) signalIdx.add(i);
  });
  for (const i of relevanceLineIdx(lines, relevanceTokens)) signalIdx.add(i);
  for (const i of contextIdx(lines)) signalIdx.add(i);
  const budget = Math.max(0, cap - signalIdx.size);
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  const kept = new Set(signalIdx);
  for (let i = 0; i < head && i < lines.length; i++) kept.add(i);
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) kept.add(i);
  // A marker hush inserted (a repeat count, a collapse count) sits directly
  // after the line it annotates and is the only trace of the occurrences it
  // stands for — a kept line whose marker got cut silently under-reports
  // itself. So a marker survives whenever its line does, and only then: the
  // tail can open on a marker whose line it cut. Markers whose line is gone
  // are dropped with it; the omission marker already covers that span.
  for (const i of kept) if (HUSH_MARKER_RE.test(lines[i])) kept.delete(i);
  for (const i of [...kept]) {
    for (let j = i + 1; j < lines.length && HUSH_MARKER_RE.test(lines[j]); j++) kept.add(j);
  }

  // The omission marker counts source lines: a cut collapse or repeat marker
  // stands for the lines it replaced, not for one line of the view.
  const out = [];
  let cut = 0;
  for (let i = 0; i < lines.length; i++) {
    if (!kept.has(i)) {
      const folded = FOLD_MARKER_RE.exec(lines[i]);
      cut += folded ? Number(folded[1] || folded[2]) : 1;
      continue;
    }
    if (cut) out.push(omittedMarker(cut));
    out.push(lines[i]);
    cut = 0;
  }
  if (cut) out.push(omittedMarker(cut));
  return out;
}

// One vocabulary decides failed-ness for every path that needs it (cap
// selection and the sidecar's shell-window exception). It is the FAILURE half
// of SIGNAL_RE's alternation — a WARN or DEPRECATED line is signal worth
// keeping, never evidence that the run itself failed — matched
// case-insensitively like SIGNAL_RE is: `error TS2304` out of tsc and `Build
// failed with exit code 1` out of a build tool are failures on every real
// toolchain, and a case-sensitive pattern read both as passes and handed them
// the 60-line pass cap while SIGNAL_RE simultaneously read them as signal.
// Beyond those, false positives only make the cap more generous — safe
// direction.
// The cross marks are the marks test runners print beside a failed test: ✕
// is Jest's, and × is Vitest's and Jest's on Windows. Those two count only
// as a line's leading mark, the place a runner prints them: × is also the
// multiplication sign, and a passing log's "320 × 240" is no failure. The
// indent is spaces and tabs, not \s: under the m flag \s* crosses newlines,
// and a long run of blank lines makes it backtrack quadratically.
// A mark that passing output also prints stays out: ESLint opens its
// summary with ✖ even when the run found only warnings and exited 0.
// npm's `ERR!` needs no alternative of its own: `err` followed by `!`, a
// non-alphanumeric character, already matches.
const FAILURE_RE =
  /(^|[^0-9a-zA-Z])(fail(ed|ure|ures|ing|s)?|err(or)?s?|not ok|traceback|exception|panic|fatal|✗|✘)([^0-9a-zA-Z]|$)|^[ \t]*[✕×][ \t]/im;

// A Python traceback's causal location lives in its frame lines, and those
// match neither vocabulary — only the `Traceback` header and the trailing
// exception do. Keeping just those two turns "the first causal error survives"
// into a claim with no file:line in it, so the frame shape itself is a keep
// line. Anchored and quote-delimited, so it costs nothing on other output.
const TRACEBACK_FRAME_RE = /^\s*File "[^"]+", line \d+/;

// The one KEEP vocabulary, shared by every transform that elides lines
// (dedupeConsecutive, collapseTemplates, capLines). It is the union of what
// hush calls signal and what it calls failure evidence, so every word that
// makes a run read as failed — `not ok`, `✗`, `panic`, `fatal`, `Traceback`,
// `exception`, `failing` — also keeps its line past the cap, and a capped view
// can promise that every failure line was kept. One vocabulary, one promise.
// Zero-quantified counts are blanked first, as looksLikeFailure blanks them: a
// passing summary ("Failures: 0, Errors: 0", "0 failed", node's "# fail 0")
// states a score, not a failure, so it is neither kept past the cap nor
// counted in a digest. Any non-zero count still keeps its line.
function isKeepLine(line) {
  const scored = line.replace(ZERO_COUNT_RE, "");
  return SIGNAL_RE.test(scored) || FAILURE_RE.test(scored) || TRACEBACK_FRAME_RE.test(line);
}

// Node, Java and Go print a stack after the error line, and its first frame
// is where the causal file and line usually sit. The rest is mostly runtime
// and framework frames, so these frames are not keep lines on their own:
// only the first frame after each keep line joins the kept set
// (firstFrameIdx), never the whole stack. Each pattern is anchored and has no
// nested quantifier, so a long line cannot make it backtrack quadratically.
const STACK_FRAME_RES = [
  /^\s+at (?:async )?(?:[^()]*\()?[^\s()]+:\d+:\d+\)?$/, // Node: at fn (file:line:col)
  /^\s+at [\w$.<>/@]+\([^()]*:\d+\)$/, // Java, Kotlin: at pkg.Class.method(File.java:N)
  /^\t\S+\.go:\d+(?:\s|$)/, // Go: <tab>/path/file.go:N +0x1d
];
// How far after a keep line the first frame may sit: a Jest code excerpt or a
// Go goroutine header comes between the error and its first frame.
const FIRST_FRAME_WINDOW = 10;

function isStackFrame(line) {
  return STACK_FRAME_RES.some((re) => re.test(line));
}

// Indices of the first Node, Java or Go frame after each keep line, within
// FIRST_FRAME_WINDOW lines and before the next keep line.
function firstFrameIdx(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!isKeepLine(lines[i]) || isStackFrame(lines[i])) continue;
    for (let j = i + 1; j < lines.length && j - i <= FIRST_FRAME_WINDOW; j++) {
      if (isStackFrame(lines[j])) {
        out.push(j);
        break;
      }
      if (isKeepLine(lines[j])) break;
    }
  }
  return out;
}

// go test prints every t.Error and t.Log line as <indent><file>_test.go:<N>:
// <message>, so a failed check names its file, line and values there. A
// passing test prints its t.Log lines in the same shape under -v, so the
// shape alone is no failure evidence: a line joins the kept set only when
// the test it belongs to has a `--- FAIL:` line. It belongs to the test named
// last before it: -v streams a test's lines after its `=== RUN`, `=== CONT`
// or `=== NAME` line, and without -v they follow its `--- FAIL:` line. Test
// names repeat across packages, so each package's `ok` or `FAIL` result line
// closes its tests. collapseTemplates never drops a line that names a failing
// test, so a capped view still knows whose lines follow a collapsed run.
// gotestsum's summary names each failed test as `=== FAIL: <pkg> <Test>
// (0.00s)`, with the test's lines under it; the last token before the
// parenthesis is the test (GOTESTSUM_NAME_RE, same groups).
// A failing test keeps its first REPORT_LINES_MAX lines, like every other
// runner's report, so a test that logs hundreds of lines cannot flood a
// capped view. The first ones, because go prints a test's lines in the
// order they ran: the earliest failed check is where the test first went
// wrong, and the checks after it usually fail because of it.
const GO_TEST_LINE_RE = /^\s+\S+_test\.go:\d+:(?:\s|$)/;
const GO_TEST_NAME_RE = /^\s*(?:=== (?:RUN|CONT|NAME)|--- (FAIL|PASS|SKIP):)\s+(\S+)/;
const GOTESTSUM_NAME_RE = /^=== (FAIL): (?:\S+ )?(\S+) \(/;
const GO_PACKAGE_RESULT_RE = /^(?:ok|FAIL)\s+\S/;

// Indices of the go test lines that belong to a failing test, at most `max`
// per test, or, with `names`, of the lines that name a failing test.
function goFailureIdx(lines, names, max = Infinity) {
  const out = [];
  let failed = new Set();
  let owned = [];
  let test = null;
  const settle = () => {
    const counts = new Map();
    for (const [i, t] of owned) {
      const n = counts.get(t) || 0;
      if (failed.has(t) && n < max) out.push(i);
      counts.set(t, n + 1);
    }
    failed = new Set();
    owned = [];
    test = null;
  };
  lines.forEach((line, i) => {
    const m = GO_TEST_NAME_RE.exec(line) || GOTESTSUM_NAME_RE.exec(line);
    if (m) {
      test = m[2];
      if (m[1] === "FAIL") failed.add(test);
      if (names) owned.push([i, test]);
    } else if (!names && test !== null && GO_TEST_LINE_RE.test(line)) {
      owned.push([i, test]);
    } else if (GO_PACKAGE_RESULT_RE.test(line)) {
      settle();
    }
  });
  settle();
  return out;
}

// Test runners print a failed check's values and its file:line on lines no
// keep pattern names, and each runner prints some of the same shapes on a
// passing run too. So these lines join the kept set only inside a failure's
// own report, never through FAILURE_RE, and a report keeps at most
// REPORT_LINES_MAX value lines, so a long diff cannot flood a capped view.
const REPORT_LINES_MAX = 10;

// A report under its own header: the value lines under the header and its
// first frame. The block ends at the next header or at a line `end` matches.
// `offset` maps a slice's indices back to the whole output.
function blockIdx(lines, { header, value, frame, end }, offset = 0) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!header.test(lines[i])) continue;
    out.push(offset + i);
    let values = 0;
    let framed = !frame;
    for (let j = i + 1; j < lines.length && !header.test(lines[j]) && !end.test(lines[j]); j++) {
      if (value && values < REPORT_LINES_MAX && value.test(lines[j])) {
        out.push(offset + j);
        values++;
      } else if (!framed && frame.test(lines[j])) {
        out.push(offset + j);
        framed = true;
      }
    }
  }
  return out;
}

// Jest: a failed test's detail sits under an indented bullet header,
// `  ● orders › charges the stored card`, with the Expected and Received
// values and then the stack. A toEqual failure prints its values as a diff
// instead: the `- Expected` / `+ Received` legend, then `-` and `+` lines for
// what differs, which REPORT_LINES_MAX caps per block; unchanged lines carry
// no sign and stay out. Jest prints the bullet before a passing run's
// warnings and console blocks too, so those headers start no block.
const JEST_BLOCK = {
  header: /^\s+● (?!Console\s*$)(?!.*Warning)/,
  value: /^\s+(?:[-+] |Expected\b|Received\b)/,
  frame: { test: (line) => isStackFrame(line) },
  end: /^\s*(?:PASS|FAIL) |^(?:Test Suites|Tests|Snapshots|Time):/,
};

// Vitest: the `→ expected ...` lines right under a failed test's `×`, and
// the first ` ❯ file:line:col` frame under each ` FAIL  file > test` detail.
const VITEST_MESSAGE_BLOCK = { header: /^\s+× /, value: /^\s+→ /, end: /^(?!\s+→ )/ };
const VITEST_DETAIL_BLOCK = {
  header: /^\s*FAIL\s+\S+ > /,
  frame: /^\s*❯ (?:\S+ )?\S+:\d+:\d+$/,
  end: /^\s*⎯/,
};

// RSpec: `expected:` and `got:` under `Failure/Error:`, and the first
// `# ./spec/file_spec.rb:N:in` frame. Only inside the Failures section: the
// Pending section prints the same report for examples that fail on purpose.
// The Failed examples section then lists one rerun line per failure,
// `rspec ./spec/file_spec.rb:42 # description`, and every one of them is kept.
const RSPEC_BLOCK = {
  header: /^\s+Failure\/Error:/,
  value: /^\s+(?:expected|got)\b/,
  frame: /^\s+# \S+:\d+:in /,
  end: /^\s+\d+\) /,
};
const RSPEC_RERUN_RE = /^rspec \S+ # /;

function rspecFailureIdx(lines) {
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] === "Failed examples:") {
      for (let j = i + 1; j < lines.length && (lines[j].trim() === "" || RSPEC_RERUN_RE.test(lines[j])); j++) {
        if (lines[j].trim() !== "") out.push(j);
      }
      continue;
    }
    if (lines[i] !== "Failures:") continue;
    let end = i + 1;
    while (end < lines.length && !/^\S/.test(lines[end])) end++;
    out.push(...blockIdx(lines.slice(i + 1, end), RSPEC_BLOCK, i + 1));
    i = end - 1;
  }
  return out;
}

// cargo test: the panic line and the message under it (`left:`, `right:`),
// for a test the same run lists as FAILED. A passing #[should_panic] test
// prints its panic too under --nocapture. `test result:` closes a run,
// because test names repeat across a workspace's test binaries.
const CARGO_PANIC_RE = /^thread '([^']+)'(?: \(\d+\))? panicked at (?:'.*', )?\S+:\d+:\d+:?$/;
const CARGO_FAILED_RE = /^(?:test )?(\S+) (?:\.\.\.|---) FAILED$/;
const CARGO_MESSAGE_END_RE = /^\s*$|^(?:note|stack backtrace):|^(?:thread|test) /;

function cargoFailureIdx(lines) {
  const out = [];
  let failed = new Set();
  let panics = [];
  const settle = () => {
    for (const [test, idx] of panics) if (failed.has(test)) out.push(...idx);
    failed = new Set();
    panics = [];
  };
  lines.forEach((line, i) => {
    const panic = CARGO_PANIC_RE.exec(line);
    const fail = CARGO_FAILED_RE.exec(line);
    if (panic) {
      const idx = [i];
      for (let j = i + 1; j < lines.length && idx.length <= REPORT_LINES_MAX && !CARGO_MESSAGE_END_RE.test(lines[j]); j++) idx.push(j);
      panics.push([panic[1], idx]);
    } else if (fail) {
      failed.add(fail[1]);
    } else if (line.startsWith("test result: ")) {
      settle();
    }
  });
  settle();
  return out;
}

// pytest: the `E   ` explanation lines inside the FAILURES or ERRORS section,
// at most REPORT_LINES_MAX under each `____ test ____` report header.
const PYTEST_SECTION_RE = /^={3,} (.+?) ={3,}$/;
const PYTEST_REPORT_RE = /^_{3,} .+ _{3,}$/;
const PYTEST_E_RE = /^E {2,}\S/;

function pytestFailureIdx(lines) {
  const out = [];
  let inFailures = false;
  let left = 0;
  lines.forEach((line, i) => {
    const section = PYTEST_SECTION_RE.exec(line);
    if (section) {
      inFailures = section[1] === "FAILURES" || section[1] === "ERRORS";
      left = REPORT_LINES_MAX;
    } else if (PYTEST_REPORT_RE.test(line)) {
      left = REPORT_LINES_MAX;
    } else if (inFailures && left > 0 && PYTEST_E_RE.test(line)) {
      out.push(i);
      left--;
    }
  });
  return out;
}

// Lines kept for where they sit next to a failure rather than for their
// words. capLines and the sidecar digest keep the same set, and a failing
// run's template collapse spares it.
function contextIdx(lines) {
  return [
    ...firstFrameIdx(lines),
    ...goFailureIdx(lines, false, REPORT_LINES_MAX),
    ...blockIdx(lines, JEST_BLOCK),
    ...blockIdx(lines, VITEST_MESSAGE_BLOCK),
    ...blockIdx(lines, VITEST_DETAIL_BLOCK),
    ...rspecFailureIdx(lines),
    ...cargoFailureIdx(lines),
    ...pytestFailureIdx(lines),
  ];
}

// A green summary states its own score — "0 failures", "no errors", node's own
// "fail 0" — and those words are the opposite of failure evidence. Blanking
// zero-quantified counts before the sniff keeps a passing test run on the pass
// cap; any non-zero count is left alone and still classifies as a failure.
//
// A label with `:` or `=` ("Failures: 0,", "errors=0") only blanks when the
// zero ENDS the phrase — end of line, comma, other punctuation. "Error: 0
// tests found" counts a different noun, and blanking it there left no failure
// token in a line that plainly is one. The lookahead is space/tab-scoped
// rather than \s so a zero ending a line still blanks when more output follows
// on the next line. A bare label ("# fail 0") blanks only when the zero ends
// the line: "ERROR 0: connection refused" numbers an error rather than
// counting one, and isKeepLine blanks zero counts too, so blanking it would
// cut a real error line from a capped view.
const ZERO_COUNT_RE =
  /\b(?:0|no)\s+(?:\w+\s+){0,2}?(?:fail\w*|error\w*)\b|\b(?:fail\w*|error\w*)\s*[:=]\s*0\b(?![ \t]*\w)|\b(?:fail\w*|error\w*)[ \t]+0[ \t]*(?=\r?\n|$)/gi;

function looksLikeFailure(text, exitCode) {
  // Exit-code evidence outranks text sniffing: when preserve-exit-code's
  // trailer reported a real code, a log full of the
  // word "error" is still a passing run, and a silent log with code 1 is still
  // a failure.
  if (typeof exitCode === "number") return exitCode !== 0;
  return FAILURE_RE.test(String(text).replace(ZERO_COUNT_RE, ""));
}

// A command that just dumps a whole file's contents (cat/type/Get-Content,
// no pipe, chain or stdout redirect) exits 0 without meaning "safe to trim
// like a build log" — a clean exit there just means the file was read. Source
// text has no WARN/ERROR markers for capLines' signal-preservation to anchor
// on, so the head+tail cap would cut arbitrary lines out of the middle of the
// file instead of out of actual log noise. Treat these like failures: keep
// more.
// A git diff or git show prints file text the same way, so it counts too.
// One command on one line, read through unwrapCommand below.
const FILE_DUMP_RE = /^(?=[^|;&<>\r\n]*$)(?:(?:cat|type|gc|Get-Content)\s+\S|git\s+(?:diff|show)(?:\s|$))/i;

function isFileDump(command) {
  return typeof command === "string" && FILE_DUMP_RE.test(unwrapCommand(command));
}

// A directory listing, a print of a line range the command bounds itself
// (sed -n, head/tail -n, Get-Content -TotalCount/-Tail), or a git diff or git
// show has no warning or error lines for the cap to keep, so a trim cuts
// arbitrary names, code or diff lines and sends the model back for a second
// read; a re-run gets the same cut. compress() passes these
// whole up to CAP_FAIL lines, as main() passes a ranged Read, and past that
// keeps CAP_FAIL of them without folding any. One command
// only, on one line, read through unwrapCommand below as isFileDump reads it.
// find is a listing unless -exec/-ok prints another command's output.
const BOUNDED_PRINT_RE = new RegExp(
  "^(?=[^|;&<>\\r\\n]*$)(?:(?:ls|dir|gci|Get-ChildItem)(?:\\s|$)|find(?!.*\\s-(?:exec|ok)(?:dir)?(?:\\s|$))(?:\\s|$)|sed\\s+-n\\s" +
    "|(?:head|tail)\\s+-(?:n\\s*)?\\+?\\d|(?:cat|type|gc|Get-Content)\\s.*\\s-(?:TotalCount|Head|First|Tail|Last)\\s+\\d|git\\s+(?:diff|show)(?:\\s|$))",
  "i"
);
const PS_WRAP_RE = /^& \{ (.*) \} 2>&1 \| Out-String -Width 4096$/;
const EXIT_WRAP_TAIL_RE = /\r?\n(?:__hush_exit=\$\?|Write-Output '\[\[hush:exit=')[\s\S]*$/;

// The command as the model wrote it. preserve-exit-code.js (a PreToolUse hook)
// wraps Bash/PowerShell commands so a non-zero exit still reports success to
// Claude Code — otherwise the call routes through PostToolUseFailure, which
// this hook never sees at all (see that file's header). PostToolUse receives
// the wrapped command, so the lines the wrapper appends and PowerShell's
// `& { }` come off here; a multi-line script keeps its newlines. A stderr
// redirect, 2>&1 included, comes off after them, since it leaves stdout as
// printed; a stdout redirect stays, so neither print check matches it.
function unwrapCommand(command) {
  const line = command.replace(EXIT_WRAP_TAIL_RE, "").trim();
  const ps = PS_WRAP_RE.exec(line);
  return (ps ? ps[1] : line).replace(/\s+2>\S*/g, "").trim();
}

// An explicit read of a whole file is a bounded print too, unless the file is
// a log or generated (isLogPath, isGeneratedPath), which stays a dump: source
// has no warning lines to keep, so a cut sends the model back for a re-read.
// A read can come after a cd and between echo separators, chained with &&, ;
// or a newline, as long as every step is one of these. A step with a pipe, a
// redirect, a background & or a command substitution ($(, a backtick, or an
// unquoted argument opening with a parenthesis) runs something else; a
// parenthesis inside a quoted path does not.
const WHOLE_READ_RE = /^(?:cat|type|gc|Get-Content)\s+\S/i;
const NEUTRAL_STEP_RE = /^(?:cd|Set-Location|sl|pushd|echo|printf|Write-Output|Write-Host)(?:\s|$)/i;
const ARG_RE = /"[^"]*"|'[^']*'|\S+/g;

function isPlainStep(step) {
  return !/[|<>&`]|\$\(/.test(step) && !/(?:^|\s)\(/.test(step.replace(ARG_RE, (a) => (/^["']/.test(a) ? '""' : a)));
}

function isNeutralStep(step) {
  return NEUTRAL_STEP_RE.test(step) && isPlainStep(step);
}

function isSourceRead(step) {
  // The slash lets a relative logs/x.txt match as the absolute paths Read gets do.
  const paths = step.match(ARG_RE).slice(1).map((arg) => "/" + arg.replace(/^["']|["',]+$/g, ""));
  return WHOLE_READ_RE.test(step) && isPlainStep(step) && !paths.some((p) => isLogPath(p) || isGeneratedPath(p));
}

function isBoundedPrint(command) {
  if (typeof command !== "string") return false;
  const steps = unwrapCommand(command).split(/&&|;|\r?\n/).map((s) => s.trim()).filter(Boolean);
  return steps.some((s) => !isNeutralStep(s)) &&
    steps.every((s) => isNeutralStep(s) || BOUNDED_PRINT_RE.test(s) || isSourceRead(s));
}

// Reads the trailer preserve-exit-code.js appends. Real output splits the
// prefix, the number, and the suffix across three separate lines (its
// wrapper never puts a variable inside a quoted string or parens — see that
// file's header for why), CRLF or LF — `\s*` bridges the line breaks either
// way.
//
// Only the trailer counts: the last marker, closing the output. The wrapper's
// statements run after the command, so the real one always comes last. Any
// other occurrence is text the command printed (hush's own source, a saved
// earlier output, a quoted report) and stays in the view as printed; honoring
// it would let output fabricate an exit code. main() also requires the
// command to carry the wrapper, so an unwrapped command's output that happens
// to end in a marker is text too.
//
// A MALFORMED trailer (nothing between the brackets) is still stripped, with
// no exit code: PowerShell only sets $LASTEXITCODE for a native executable,
// so a pure-cmdlet command (`Get-ChildItem | Select-Object`, a bare
// `Get-Content`) leaves it null/stale and the wrapper emits
// `[[hush:exit=\n\n]]` with nothing inside.
const EXIT_MARKER_PREFIX = "[[hush:exit=";
const EXIT_MARKER_PARTS = Array.from(EXIT_MARKER_PREFIX.slice(1), (_, i) => EXIT_MARKER_PREFIX.slice(0, i + 1));
const EXIT_TRAILER_RE = /^\[\[hush:exit=([^[\]]*)\]\]\s*$/;

// Returns null when the text does not end in a marker (nothing to strip,
// caller uses the old regex-sniffing heuristic). Otherwise cleanText is the
// text without that trailer; exitCode is its value, or null when it was
// malformed/empty — callers must treat a null exitCode the same as "no
// reliable exit code known" (fall back to sniffing cleanText) while still
// using the stripped cleanText and skipping the `[hush: exit N]` trailer note.
function extractWrappedExit(text) {
  if (typeof text !== "string") return null;
  const start = text.lastIndexOf(EXIT_MARKER_PREFIX);
  const trailer = start === -1 ? null : EXIT_TRAILER_RE.exec(text.slice(start));
  if (!trailer) return null;
  const code = /^\s*(-?\d+)\s*$/.exec(trailer[1]);
  return { exitCode: code ? parseInt(code[1], 10) : null, cleanText: text.slice(0, start).replace(/\s+$/, "") };
}

// The field of a structured response whose trailer supplies the exit code, or
// null. The bash wrapper echoes its trailer to stdout, so stdout decides.
// stderr is read only when stdout does not end in a marker: that is
// `exec 1>&2`, which moves the real trailer there. The host hands the hook a
// plain prefix of a long output, with nothing appended after the cut (see
// hostCutAt), so a stdout that arrives at the cut and ends in part of a
// trailer (from its first `[`, or the whole prefix and then at most the code
// and one `]`) keeps stderr and output from being read: a marker either of
// them prints never supplies the code. A shorter stdout was not cut, so a
// part of the marker at its end is text the command printed, as is a marker
// earlier in stdout. Only this field is stripped and annotated; a marker
// ending any other field is text and stays as printed.
function endsInCutTrailer(text) {
  const start = text.lastIndexOf(EXIT_MARKER_PREFIX);
  const cutTail =
    (start !== -1 && /^[\s\d-]*\]?$/.test(text.slice(start + EXIT_MARKER_PREFIX.length))) ||
    EXIT_MARKER_PARTS.some((part) => text.endsWith(part));
  return cutTail && text.length >= hostCutAt() - HOST_CUT_SLACK;
}
function exitField(response) {
  const open = !(typeof response.stdout === "string" && endsInCutTrailer(response.stdout));
  return ["stdout", open && "stderr", open && "output"].find((f) => f && extractWrappedExit(response[f])) || null;
}

// True when preserve-exit-code.js wrapped this call's command. PostToolUse
// receives the command as the PreToolUse hook rewrote it.
function isExitWrapped(data) {
  const command = data.tool_input && data.tool_input.command;
  return typeof command === "string" && EXIT_WRAP_TAIL_RE.test(command);
}

// A shell reports a signal death as 128+N, so the trailer's own number already
// carries the cause — "exit 137" is a kill, "exit 143" a terminate, both as
// the bash wrapper reports them. Naming the signal beside the code
// keeps the native semantics intact and legible in one line; nothing is
// inferred beyond the arithmetic.
//
// The table is the SHELL's POSIX numbering, deliberately not Node's
// os.constants.signals: that is the HOST's table (win32 numbers SIGABRT 22,
// not 6) while a bash trailer reports POSIX numbers wherever it runs.
// PowerShell has no signal channel to derive anything from — a process killed
// on Windows surfaces an ordinary exit code, and a pure-cmdlet command leaves
// $LASTEXITCODE unset (a malformed marker, no code at all) — so on that shell
// the code stands alone and no signal is ever claimed.
const SIGNALS = {
  1: "SIGHUP", 2: "SIGINT", 3: "SIGQUIT", 4: "SIGILL", 6: "SIGABRT",
  8: "SIGFPE", 9: "SIGKILL", 11: "SIGSEGV", 13: "SIGPIPE", 15: "SIGTERM",
};

function exitNote(exitCode) {
  const sig = SIGNALS[exitCode - 128];
  return sig ? `[hush: exit ${exitCode} (${sig})]` : `[hush: exit ${exitCode}]`;
}

// When the user's prompt explicitly asks to enumerate EVERY / ALL / EACH of
// some countable thing (warnings, errors, files, items, ...), a capped slice —
// even one whose omission markers promise "no signal cut" — still reads as
// incomplete: the model can't audit a completeness claim it can't see the whole
// of, so (on the stronger models especially) it re-runs the command to a file
// and greps to recover what it assumes is hidden, and each extra turn re-sends
// full context — the compression backfires exactly on the noisy task where it
// would save the most. On these prompts we skip the cap (raise it to
// CAP_ENUMERATE): the log still gets ANSI-stripped, \r-resolved, and
// dupe-collapsed, but nothing is elided, so there is nothing to distrust.
// Two shapes: a completeness quantifier near a countable noun ("every warning",
// "all of the errors"), or a bare enumeration verb + that noun ("list the
// files"). Kept tight — a countable noun is required — so ordinary prose
// ("explore the whole repo") doesn't disable compression wholesale.
const ENUM_NOUN =
  "warn(?:ing)?s?|errors?|failures?|deprecat\\w*|issues?|items?|entr(?:y|ies)|" +
  "lines?|occurrences?|matches|results?|files?|records?|rows?|messages?|" +
  "violations?|findings?|instances?|columns?|tests?";
const ENUM_QUANTIFIED = new RegExp(
  `\\b(?:every|each|all|complete|full|entire|exhaustive)\\b[^.?!\\n]{0,30}?\\b(?:${ENUM_NOUN})\\b`,
  "i"
);
const ENUM_VERB = new RegExp(`\\b(?:list|enumerate)\\b[^.?!\\n]{0,20}?\\b(?:${ENUM_NOUN})\\b`, "i");

function requestsEnumeration(prompt) {
  if (typeof prompt !== "string" || !prompt) return false;
  return ENUM_QUANTIFIED.test(prompt) || ENUM_VERB.test(prompt);
}

// Grep content-mode results: the matches ARE the deliverable, so nothing
// disappears silently. Lines that don't parse as matches (multiline-match
// continuations, separators) are kept verbatim. Two line formats exist:
// `path:line:` for directory searches and bare `line:` when a single explicit
// file was searched — whichever parses more lines wins, decided once per
// result so an ambiguous line can't flip mid-list. The non-greedy prefix
// backtracks across Windows drive-letter colons (`C:\x.js:12:` parses as path
// `C:\x.js`).
//
// INVARIANTS of the search elision — what may be elided, and what never may.
// The emitted marker states these, so they are contracts:
//
//   1. Every matched file keeps its first GREP_KEEP_PER_FILE match lines, in
//      order, verbatim — with their path:line coordinates intact, so any kept
//      match is one targeted Read away from its own context.
//   2. Every match whose text after `path:line:` is a keep line (isKeepLine,
//      the vocabulary the capped views keep) and every match line naming a
//      prompt-quoted identifier survives regardless of position
//      (usableRelevanceTokens applies the too-common guard first).
//   3. No matched file ever vanishes: a file whose extra matches were elided
//      is named in the summary with its exact total and shown counts, and the
//      aggregate omitted count is stated.
//   4. Nothing that failed to parse as a match line is ever elided.
//   5. The elided match lines are persisted verbatim before the view naming
//      them is built (persistGrepMatches), so the retrieval instruction points
//      at a file that already exists. When they cannot be persisted — sidecar
//      off, secret-shaped content, or any write failure — the marker drops the
//      pointer and offers the re-run instead, and the record says so.
const GREP_MATCH_RE = /^(.*?):(\d+):/;
const GREP_SINGLE_RE = /^\d+:/;

function compressGrep(content, relevanceTokens, fileLabel, decision, sessionId) {
  const lines = content.split("\n");
  if (decision) { decision.linesIn = lines.length; decision.omitted = 0; }
  const named = relevanceMatcher(lines, relevanceTokens);
  let multiHits = 0;
  let singleHits = 0;
  for (const l of lines) {
    if (GREP_MATCH_RE.test(l)) multiHits++;
    if (GREP_SINGLE_RE.test(l)) singleHits++;
  }
  const singleMode = singleHits > multiHits;
  const label = fileLabel || "searched file";
  const perFile = new Map(); // path -> { total, shown }
  const kept = [];
  let omitted = 0;
  for (const line of lines) {
    const prefix = (singleMode ? GREP_SINGLE_RE : GREP_MATCH_RE).exec(line);
    if (!prefix) {
      kept.push(line);
      continue;
    }
    const key = singleMode ? label : prefix[1];
    let s = perFile.get(key);
    if (!s) {
      s = { total: 0, shown: 0 };
      perFile.set(key, s);
    }
    s.total++;
    // The keep vocabulary reads the match text after `path:line:` only: a
    // directory named error/ or errors/ is no failure evidence, and reading it
    // forced every match under it past the per-file keep. The prompt match
    // still reads the whole line, since a prompt may quote a file name.
    const forced = isKeepLine(line.slice(prefix[0].length)) || named(line);
    if (forced || s.shown < GREP_KEEP_PER_FILE) {
      s.shown++;
      kept.push(line);
    } else {
      omitted++;
    }
  }
  if (!omitted) return content;
  const summary = [...perFile.entries()]
    .filter(([, s]) => s.total > s.shown)
    .map(([file, s]) => `${file}: ${s.total} matches, ${s.shown} shown`);
  // Written BEFORE the marker that names it, and only named when the write
  // actually landed — a retrieval instruction pointing at a file that isn't
  // there is worse than the re-run advice it replaced.
  const saved = persistGrepMatches(content, sessionId);
  const markerHead =
    `[hush hook: ${omitted} match lines omitted from this view; every matched file is counted below, ` +
    `and every warning/error-shaped match was kept. `;
  const marker = saved
    ? markerHead +
      `The complete match list was saved to ${saved.replace(/\\/g, "/")} — Read that file for the omitted matches ` +
      `(offset/limit returns an exact slice). If it is gone, re-run the search.]`
    : markerHead + `Files on disk are unchanged — re-run with a narrower pattern or a path filter for the full list]`;
  // A single-file search without line numbers, and a line that parses as no
  // match, keep their text bare, so a kept line can open like the marker
  // below it; the summary names paths from the output too.
  const out = [escapeMarkerLookalikes(kept.join("\n")), marker, escapeMarkerLookalikes(summary.join("\n"))].join("\n");
  // A rewrite rejected here leaves the persisted copy behind unread — bounded
  // (it is this session's own directory, deleted at SessionEnd) and rare (the
  // summary would have to be bigger than the whole match list).
  if (out.length >= content.length) return content;
  if (decision) {
    decision.omitted = omitted;
    if (saved) {
      decision.recovery = "sidecar";
      decision.recoveryPath = saved;
      decision.sidecarPath = saved;
      decision.retention = "session";
    }
  }
  return out;
}

// Read results are compressed ONLY for log-shaped files: a `.log` (optionally
// rotated: `.log.1`) extension anywhere, or a `.log`/`.txt`/`.out` file living
// under a directory literally named log/logs. Source code never matches, so a
// capped Read can never cut lines the model might need to edit byte-exactly —
// and for genuine logs, capLines' signal preservation (every WARN/ERROR/FAIL
// line survives) is the same guarantee shell output already gets. Without this
// a 60k-char `Read logs/app.log` would enter context whole and be re-sent on
// every subsequent API call.
const LOG_PATH_RE = /\.log(?:\.\d+)?$|[\\/]logs?[\\/][^\\/]+\.(?:log|txt|out)$/i;

function isLogPath(filePath) {
  return typeof filePath === "string" && LOG_PATH_RE.test(filePath.trim());
}

// Machine-generated files nobody edits by hand: lockfiles, minified bundles,
// sourcemaps, and anything under node_modules or a build-output directory. A
// Read of package-lock.json enters context whole (often thousands of lines)
// and is re-sent on every later API call, yet the model usually needs one
// entry — which the omission marker's re-read invitation (or a Grep) still
// reaches. Path-shaped detection only, mirroring isLogPath's discipline:
// hand-written source can never match, so a capped Read can never cut lines
// the model might need to edit byte-exactly.
const GENERATED_PATH_RE = new RegExp(
  "(?:^|[\\\\/])(?:package-lock\\.json|yarn\\.lock|pnpm-lock\\.yaml|npm-shrinkwrap\\.json|" +
    "cargo\\.lock|poetry\\.lock|gemfile\\.lock|composer\\.lock|go\\.sum|uv\\.lock|flake\\.lock)$" +
    "|\\.(?:min\\.(?:js|css)|bundle\\.js|map)$" +
    "|(?:^|[\\\\/])(?:node_modules|dist|\\.next|__pycache__)[\\\\/]",
  "i"
);

function isGeneratedPath(filePath) {
  return typeof filePath === "string" && GENERATED_PATH_RE.test(filePath.trim());
}

// Context-pressure scaling: the transcript file's size is a free, local proxy
// for how full the context already is. Deep in a long session every kept line
// is re-sent more times and pushes auto-compaction (an expensive full-context
// summarization, plus permanent detail loss) closer — so caps tighten as the
// session grows. Inert below 400KB (most short sessions never reach it),
// floors keep failing output useful, and the enumeration
// carve-out is never scaled: its whole point is a completeness promise.
const PRESSURE_MID_BYTES = 400 * 1024;
const PRESSURE_HIGH_BYTES = 1024 * 1024;
const FLOOR_PASS = 30;
const FLOOR_FAIL = 125;

function pressureScale(transcriptBytes) {
  if (!Number.isFinite(transcriptBytes) || transcriptBytes < PRESSURE_MID_BYTES) return 1;
  return transcriptBytes < PRESSURE_HIGH_BYTES ? 0.75 : 0.5;
}

// Very large outputs don't enter context at all: the full cleaned text goes to
// a sidecar file and a line-numbered digest goes in its place. Even a capped
// inline view of a huge log is re-sent with every later API call in the
// session; the digest is an order of magnitude smaller, and the file is one
// Read away — with real L<n> line numbers in the digest so a follow-up Read
// can use offset/limit surgically instead of re-reading the whole thing. The
// digest keeps the head, the tail, a bounded sample of signal lines with an
// exact total count, and every prompt-named (relevance) line, so most tasks
// never need the follow at all. Fail-open: any filesystem trouble falls back
// to the normal capped view. The enumeration carve-out is exempt — its whole
// point is that nothing is elided. Files are content-addressed (idempotent on
// re-fire) inside a directory this session owns, and are deleted when the
// session ends (see lib/sidecar-store.js).
const SIDECAR_MIN_CHARS = intEnv("HUSH_SIDECAR_MIN", 15000);
// For SHELL outputs only: the size from which an output counts as cut by the
// host, when HUSH_SIDECAR_SHELL_MAX sets it. Otherwise it is the host's own cut
// (see hostCutAt): a shell output that arrives at the cut was cut, and its tail
// — where a build's error or a run's final result usually lives — never reached
// this hook. Claude Code keeps that complete output in its own file, so
// maybeSidecar's digest points the model there first and names hush's copy of
// the received part as the fallback. Read results are exempt: Read returns the file's full
// content to the hook (its own limits are far larger), so a big lockfile/log
// Read is complete and its sidecar is full.
const SIDECAR_SHELL_MAX = intEnv("HUSH_SIDECAR_SHELL_MAX", 0);

// Claude Code hands this hook a plain prefix of a long Bash/PowerShell output:
// the cut lands at N characters, then the host trims blank lines at the edges,
// so a cut output arrives as N or a little short of it (N - 1 when the cut
// lands just after a newline). N is the bashOutputMaxChars setting, clamped to
// 4000-128000, else BASH_MAX_OUTPUT_LENGTH, else 30000. hush reads the setting
// from the user, project and local settings files, a later file winning;
// managed settings and a --settings flag are out of its sight. Read once per
// process, and only when an output is big enough or ends like a cut trailer.
const HOST_CUT_SLACK = 100;
let hostCut;
function hostCutAt() {
  if (hostCut !== undefined) return hostCut;
  const home = process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const project = process.env.CLAUDE_PROJECT_DIR || process.cwd();
  let setting;
  for (const file of [path.join(home, "settings.json"), path.join(project, ".claude", "settings.json"), path.join(project, ".claude", "settings.local.json")]) {
    try {
      const v = JSON.parse(fs.readFileSync(file, "utf8").replace(/^\uFEFF/, "")).bashOutputMaxChars;
      if (typeof v === "number" && Number.isFinite(v)) setting = Math.min(128000, Math.max(4000, Math.floor(v)));
    } catch {
      /* missing or unreadable: the other files decide */
    }
  }
  return (hostCut = setting ?? intEnv("BASH_MAX_OUTPUT_LENGTH", 30000));
}
const DIGEST_HEAD = 20;
const DIGEST_TAIL = 15;
const DIGEST_SIGNAL_SAMPLE = 10; // first N + last N signal lines
const OTHER_SIGNAL_CAP = 15; // max line numbers listed in the "not shown" line

// Every line that reached signalIdx (the keep vocabulary, isKeepLine, and the
// lines contextIdx keeps) counts under one of these. The first five are
// subpatterns of SIGNAL_RE's alternation, never edited independently; the
// error and failure words among them are FAILURE_RE's words too, so each
// names only lines isKeepLine keeps. The
// last takes every other signal line, all of it failure evidence SIGNAL_RE
// does not name: `not ok`, `panic`, `fatal`, `Traceback`, cross marks, plural
// errors and failures, Python traceback frames, and the frames, values and
// file:line lines a failure's own report carries.
// Priority order when a line matches several (e.g. "ERROR ... ReferenceError"):
// error > failure > critical > warning > deprecation > failure evidence — each
// line counts once, under whichever category wins.
const CENSUS_CATEGORIES = [
  { singular: "error", plural: "errors", re: /Error\b|Exception\b|\bERR(?:OR)?\b/i },
  { singular: "failure", plural: "failures", re: /\bFAIL(?:URE|ED)?\b/i },
  { singular: "critical", plural: "criticals", re: /\bCRITICAL\b/i },
  { singular: "warning", plural: "warnings", re: /Warning\b|\bWARN(?:INGS?)?\b/i },
  { singular: "deprecation", plural: "deprecations", re: /\bDEPRECATED\b/i },
  {
    singular: "failure-evidence line",
    plural: "failure-evidence lines",
    re: /^/,
  },
];

// A bare count ("14 with warnings/errors/failures") makes a model misreport
// on a completeness task without retrieving — a categorical census with named
// counts lets it retrieve correctly. Renders like
// "2 errors, 1 failure, 3 warnings", omitting any category with zero hits.
function signalCensus(lines, signalIdx) {
  const counts = CENSUS_CATEGORIES.map(() => 0);
  for (const i of signalIdx) {
    const catIdx = CENSUS_CATEGORIES.findIndex((c) => c.re.test(lines[i]));
    if (catIdx !== -1) counts[catIdx]++;
  }
  const parts = [];
  CENSUS_CATEGORIES.forEach((c, idx) => {
    const n = counts[idx];
    if (n > 0) parts.push(`${n} ${n === 1 ? c.singular : c.plural}`);
  });
  return parts.join(", ");
}

function cheapHash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16);
}

function buildSidecarDigest(cleaned, relevanceTokens, cut) {
  const lines = cleaned.split("\n");
  const total = lines.length;
  // The header advertises non-empty lines: a trailing newline or blank
  // separator is not output, and a raw element count reads as one-more-than-
  // the-records to anyone doing arithmetic on it.
  const nonBlank = lines.filter((l) => l.trim() !== "").length;
  // The keep vocabulary plus the lines kept for their place next to a
  // failure (contextIdx), the same set every capped view keeps: a
  // traceback's header and frames carry the causal file and line, and
  // SIGNAL_RE names neither.
  const signal = new Set(contextIdx(lines));
  lines.forEach((l, i) => {
    if (isKeepLine(l)) signal.add(i);
  });
  const signalIdx = [...signal].sort((a, b) => a - b);

  // Signal (and prompt-named) lines lead the digest, ahead of the structural
  // head/tail. When a raw output is large enough to trip Claude Code's own
  // large-output persistence (~29KB), the host shows this rewritten digest
  // only as a truncated "first ~2KB preview" and keeps a pointer to the raw
  // file — so a head-first digest buries the actual error below the cut and
  // the model reads the raw file anyway, re-inflating everything it just
  // saved. Leading with the errors/warnings (and prompt-named lines) keeps
  // them inside that preview window, so the visible slice answers the question
  // and no raw re-read is needed. Line numbers stay real (out of order is
  // fine — they exist for targeted offset/limit reads, not for reading order).
  const lead = [
    ...signalIdx.slice(0, DIGEST_SIGNAL_SAMPLE),
    ...signalIdx.slice(-DIGEST_SIGNAL_SAMPLE),
    ...relevanceLineIdx(lines, relevanceTokens),
  ];
  const leadSet = new Set(lead);
  const leadSorted = [...leadSet].sort((a, b) => a - b);

  // Structural context (head + tail) follows, in line order with gap markers,
  // skipping any line already shown in the lead so nothing is printed twice.
  const structIdx = new Set();
  for (let i = 0; i < Math.min(DIGEST_HEAD, total); i++) if (!leadSet.has(i)) structIdx.add(i);
  for (let i = Math.max(0, total - DIGEST_TAIL); i < total; i++) if (!leadSet.has(i)) structIdx.add(i);
  const structSorted = [...structIdx].sort((a, b) => a - b);
  const census = signalCensus(lines, signalIdx);

  const out = [];
  if (leadSorted.length) {
    out.push(`Signal lines (${signalIdx.length} total: ${census}):`);
    for (const i of leadSorted) out.push(`L${i + 1}: ${lines[i]}`);
    // The lead sample is provably exhaustive-or-not: signalIdx is every
    // matching line, so naming exactly which ones weren't shown (with real
    // L<n> targets for a follow-up offset/limit Read) is a completeness claim
    // hush can actually prove, not a bare "trust me" count.
    const unshown = signalIdx.filter((i) => !leadSet.has(i));
    if (unshown.length) {
      const shown = unshown.slice(0, OTHER_SIGNAL_CAP);
      const remaining = unshown.length - shown.length;
      let line = `Other signal lines (not shown): ${shown.map((i) => `L${i + 1}`).join(", ")}`;
      if (remaining > 0) line += ` ... (+${remaining} more)`;
      out.push(line);
    }
    out.push("");
  }
  // A cut output's last lines are where the host cut it, not where it ended.
  out.push(cut ? "Structure (head + the tail of what hush received; read the file for the rest):" : "Structure (head + tail; read the file for the rest):");
  let last = -1;
  for (const i of structSorted) {
    if (i - last > 1) out.push(`  ... ${i - last - 1} lines in the file only ...`);
    out.push(`L${i + 1}: ${lines[i]}`);
    last = i;
  }
  return {
    body: out.join("\n"),
    total,
    nonBlank,
    signalCount: signalIdx.length,
    census,
    // Manifest accounting: every source line the digest reproduces is one of
    // these two sets, each rendered verbatim behind its L<n> number.
    shown: leadSorted.length + structSorted.length,
  };
}

// Credential-shaped content is screened out of the sidecar path entirely,
// never redacted-and-persisted: a hit here means the caller falls through to
// the ordinary inline cap (below) — the same view the model gets without
// hush — rather than writing a "cleaned" file that still carries the secret.
// Clean-room, deliberately over-matching (a false positive only costs a
// slightly more common inline fallback, never a leak): provider key-prefix
// families (OpenAI/Anthropic-style sk-, GitHub ghp_ tokens, AWS AKIA access
// key ids, Slack xox* tokens), PEM private-key blocks (not certificates —
// those are public), Bearer/Basic auth values, and connection-string
// embedded credentials (scheme://user:pass@host).
const SECRET_RES = [
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9]{20,}\b/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[A-Z0-9 ]*-----/,
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{8,}/,
  /\b\w+:\/\/[^\s/:@]+:[^\s/:@]+@[^\s/]+/,
];

function containsSecret(text) {
  return SECRET_RES.some((re) => re.test(text));
}

// The one place a sidecar file's name is decided, for every caller that parks
// content: this session's own directory carries ownership and cleanup, and the
// name is just the content hash, so re-firing on identical output reuses the
// file instead of multiplying it. Returns null when the content must not be
// persisted at all — the secret screen runs here, strictly before any caller
// can be handed a path to write to.
function sidecarTarget(content, sessionId) {
  if (isOff("HUSH_SIDECAR")) return null;
  try {
    if (containsSecret(content)) return null;
    return path.join(sidecarStore.sessionDir(sessionId), `${cheapHash(content)}.txt`);
  } catch {
    return null;
  }
}

// Materializes a sidecarTarget. Returns true only when the file is on disk
// afterwards (safeWriteFileSync throws on any refusal or I/O failure), so no
// caller can print a path for a write that never landed.
function writeSidecar(file, content) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    if (!fs.existsSync(file)) safeWriteFileSync(file, content);
    return true;
  } catch {
    return false;
  }
}

// The elided half of a collapsed match list has nowhere else to live —
// re-running the search regenerates it from files still on disk, but
// only if the exact invocation is reproduced and nothing changed underneath.
// Parking the complete list turns retrieval into one Read. Returns the path
// when the copy is really there, null when it is not — the caller words its
// marker from that answer, never the other way round.
function persistGrepMatches(content, sessionId) {
  const file = sidecarTarget(content, sessionId);
  if (!file) return null;
  return writeSidecar(file, content) ? file : null;
}

function maybeSidecar(cleaned, relevanceTokens, sessionId, received, failed) {
  if (typeof cleaned !== "string" || cleaned.length < SIDECAR_MIN_CHARS) return null;
  // A shell output that arrived at the host's cut (see SIDECAR_SHELL_MAX) was
  // most likely cut by Claude Code, which then keeps the complete output in
  // its own file and names it above a 2KB preview of whatever this hook
  // returns, however small. The digest leads that preview and sends follow-up
  // Reads to the host's file. hush still writes its copy of the part it
  // received: an output that ends just under the cut was not cut, no host file
  // exists, and that copy is the only place the lines the digest drops survive.
  // The received text is measured, not the cleaned one: cleaning (colour
  // codes, redrawn progress lines) can take a cut output well under the cut.
  const cut = typeof received === "string" && received.length >= (SIDECAR_SHELL_MAX || hostCutAt() - HOST_CUT_SLACK);
  try {
    // sidecarTarget scans for secrets before ever handing back a path, so a
    // credential-shaped payload falls through to the ordinary inline cap
    // rather than being written out "cleaned". At a cut the digest goes out
    // anyway, with no hush copy: the screen guards the write, and an inline cap
    // there can push the signal lines past the host's 2KB preview.
    // HUSH_SIDECAR=off is documented as the trimmed view instead of a digest,
    // so it keeps that meaning at a cut too.
    if (isOff("HUSH_SIDECAR")) return null;
    const file = sidecarTarget(cleaned, sessionId);
    if (!file && !cut) return null;
    const d = buildSidecarDigest(cleaned, relevanceTokens, cut);
    const p = file && file.replace(/\\/g, "/");
    const lines = `${d.nonBlank} non-empty lines (${d.census || "0 signal lines"})`;
    const keeps =
      `the digest below keeps the head, tail, every prompt-named line, and a sample of the ` +
      `signal lines, each with its L<n> line number`;
    // The host trims the blank lines an output begins with before this hook
    // sees it, and nothing tells hush how many there were, so at a cut the
    // L<n> numbers are exact in hush's copy and can sit that many lines early
    // against the host's file.
    const header = cut && file
      ? `[hush hook: this output reached Claude Code's cut. If Claude Code named a file above, ` +
        `that file holds all of it; hush saved the ${lines} it received to ${p}, and ${keeps} ` +
        `in hush's copy (in Claude Code's file, add the blank lines the output began with, if any). ` +
        `For anything else — including any total or count you report — Read Claude Code's file, ` +
        `or hush's copy when no file is named above, with offset/limit around the L<n> numbers you need.]`
      : cut
      ? `[hush hook: this output reached Claude Code's cut. If Claude Code named a file above, ` +
        `that file holds all of it; hush received ${lines} and kept no copy, and ${keeps} ` +
        `(in Claude Code's file, add the blank lines the output began with, if any). ` +
        `For anything else — including any total or count you report — Read Claude Code's file ` +
        `with offset/limit around the L<n> numbers you need, or re-run the command when no file is named above.]`
      : `[hush hook: this output is ${lines} and was saved in full to ${p}; ${keeps}. ` +
        `For anything else — including any total or count you report — Read that file with ` +
        `offset/limit around the L<n> numbers you need. ` +
        `If that file no longer exists, re-run the command — a second run is not guaranteed ` +
        `to reproduce this output.]`;
    const out = `${header}
${d.body}`;
    // A near-line-free payload (e.g. one giant minified-JSON line) leaves
    // buildSidecarDigest's head/tail trim nothing to cut — the digest would
    // reproduce the whole input plus header overhead, larger than the source.
    // Bail before ever touching disk and let compress() fall through to the
    // ordinary inline cap, which is a no-op here too but at least isn't larger.
    if (out.length >= cleaned.length) return null;
    if (file && !writeSidecar(file, cleaned)) return null;
    // The written file IS the recovery location for everything the digest
    // left out — the manifest record carries it (see deliver).
    return { text: out, file, linesIn: d.total, omitted: Math.max(0, d.total - d.shown) };
  } catch {
    return null; // fall back to the normal capped view
  }
}

// A full Read of a sidecar file would pull the entire saved output straight
// back into context — undoing the digest and then re-sending it with every
// later call. Cap those reads like any log (a full read then yields exactly
// the capped view the digest replaced — worst case is the old inline
// behavior, by construction) but never re-sidecar them, or the middle of the
// file would become unreachable. Range reads (offset/limit) come back small
// and pass untouched — that's the intended path the digest teaches.
const isSidecarPath = sidecarStore.isSidecarPath;

// `decision`, when passed, is mutated with the single action token that
// classifies what this call actually did (see HUSH_DEBUG below) — purely an
// observation side-channel: the return value is identical whether or not a
// decision object is supplied. `fileRead` marks a Read's file content: its
// failure words still guard the fold, but no failure note follows the cap.
function compress(text, exitCode, isDump, enumerate, relevanceTokens, scale, sessionId, noSidecar, hostMayTruncate, decision, bounded, fileRead) {
  const original = String(text);
  const unescaped = resolveCarriageReturns(stripAnsi(original));
  const cleaned = escapeMarkerLookalikes(unescaped);
  const linesIn = cleaned.split("\n").length;
  if (decision) {
    decision.linesIn = linesIn;
    // deliver() ships an escaping view even when it is not smaller.
    if (cleaned !== unescaped) decision.escaped = true;
  }
  // A listing or ranged print (isBoundedPrint) keeps every line up to
  // CAP_FAIL, unscaled, and skips the sidecar too; only the scrubs above,
  // which remove no line, apply. A trailing newline is not a line. Past
  // CAP_FAIL it is parked like any output, or keeps CAP_FAIL lines with only
  // exact repeats folded.
  if (bounded && linesIn - (cleaned.endsWith("\n") ? 1 : 0) <= CAP_FAIL) {
    if (decision && !decision.action) {
      decision.omitted = 0;
      decision.action = cleaned === original ? "passthrough" : "scrub-only";
    }
    return cleaned;
  }
  // Classified once, up front: the same answer picks the cap below. maybeSidecar
  // parks every oversized output, passing or failing; at the host's cut a
  // shell digest points first to the host's complete file.
  const failed = looksLikeFailure(cleaned, exitCode);
  if (!enumerate && !noSidecar) {
    const side = maybeSidecar(cleaned, relevanceTokens, sessionId, hostMayTruncate && original, failed);
    if (side !== null) {
      if (decision) {
        decision.action = "sidecar";
        decision.omitted = side.omitted;
        if (side.file) {
          decision.recovery = "sidecar";
          decision.recoveryPath = side.file;
          decision.sidecarPath = side.file;
          decision.retention = "session";
        }
      }
      return side.text;
    }
  }
  // Below GREP_MIN_CHARS the output passes uncut, and only exact consecutive
  // repeats fold (dedupeConsecutive), for Grep's reason: the rows of a short
  // table all share one shape, and a short file print is all code lines, so a
  // template collapse or a cap hides the answer itself and the model re-runs
  // the command to get it back, which costs more than the few characters the
  // trim saved.
  const short = cleaned.length < GREP_MIN_CHARS;
  const s = typeof scale === "number" ? scale : 1;
  const cap = short
    ? Infinity
    : enumerate
      ? CAP_ENUMERATE
      : bounded
        ? CAP_FAIL
        : isDump || failed
          ? Math.max(FLOOR_FAIL, Math.round(CAP_FAIL * s))
          : Math.max(FLOOR_PASS, Math.round(CAP_PASS * s));
  // Enumeration carve-out means "nothing is elided" beyond exact consecutive
  // repeats, which fold into a count — same reason it skips the sidecar above;
  // collapsing same-shape runs would remove the very items a completeness
  // request ("list every compiled module") asked to see. A listing or ranged
  // print past CAP_FAIL keeps CAP_FAIL lines with no template collapse, only
  // exact repeats folded, for the reason it passes whole below that: its rows
  // are the names or code lines asked for, all of one shape.
  const deduped = dedupeConsecutive(cleaned.split("\n"));
  // A dump's exit code says whether the file printed, not whether the text it
  // printed reports a failure, so its fold reads the text.
  const foldFailed = failed || (isDump && looksLikeFailure(cleaned));
  const folded = !enumerate && !bounded && !short ? collapseTemplates(deduped, relevanceTokens, foldFailed) : deduped;
  let collapsed = folded.length < deduped.length;
  let capped, lines, out;
  const build = (from) => {
    lines = capLines(from, cap, relevanceTokens);
    // Past the cap, a view whose every line is a keep line still loses none,
    // and a cut always leaves an omission marker where the first lost line was.
    capped = lines.some((l, i) => l !== from[i]);
    if (failed && capped && !fileRead) lines.push(FAILURE_RERUN_NOTE);
    out = lines.join("\n");
  };
  build(folded);
  // The collapse markers themselves say nothing about how to get the collapsed
  // lines back; the footer does, once per view. Appended after the join, so it
  // never enters the line accounting below: the full note when the collapse
  // pays for it, else the short one. A collapse that cannot pay even for the
  // short one is undone, so no view hides lines without naming a way back and
  // none grows to state it. So is a fold whose every marker the cap cut: the
  // note would point at nothing.
  if (collapsed) {
    const note = lines.some((l) => /^\[hush hook: \d+ similar lines collapsed /.test(l)) &&
      [TEMPLATE_COLLAPSE_NOTE, TEMPLATE_RECOVERY_NOTE].find((n) => out.length + n.length + 1 < cleaned.length);
    if (note) out += `\n${note}`;
    else {
      collapsed = false;
      build(deduped);
    }
  }
  // Line accounting for the manifest, derived from the view itself rather than
  // threaded out of dedupe/collapse/cap separately: a line hush keeps is kept
  // verbatim and everything hush adds is a bracketed [hush marker, so the
  // non-marker output lines are exactly the input lines this view preserved.
  // An input line that opened like a marker was escaped on the way in, so it
  // counts as preserved input, not as one of hush's own.
  if (decision) decision.omitted = Math.max(0, linesIn - lines.filter((l) => !HUSH_MARKER_RE.test(l)).length);
  if (decision && !decision.action) {
    if (capped) decision.action = "cap";
    else if (collapsed) decision.action = "template-collapse";
    else if (enumerate) decision.action = "enumerate-passthrough";
    else if (out === original) decision.action = "passthrough";
    else decision.action = "scrub-only"; // ansi/CR/dupe/exit-marker cleanup or a marker escape only
  }
  return out;
}

// preserve-exit-code's wrapper marker is hush's own protocol text, and one of
// two rewrites that are not a compression bargain: stripping it is mandatory, so
// a response carrying one is exempt from the size invariant below. Dropping back
// to the original there would leak `[[hush:exit=N]]` into the model's context
// raw, which is the single thing extractWrappedExit exists to prevent. The other
// is escapeMarkerLookalikes: a view that escaped a line (decision.escaped) ships
// whatever its size, or the raw lookalike would reach the model.
//
// Keyed on the trailer extractWrappedExit strips, on a wrapped command, not on
// the `[[hush:exit=` prefix: the host truncates raw output around 29KB and can
// cut a real marker mid-text, and hush's own source or docs dumped to stdout
// carry the prefix as literal text. In both cases the stripper removes
// nothing, so exempting the size invariant would ship a growing rewrite AND
// still leave the prefix in front of the model — the worst of both.
function mustSanitize(data) {
  if (!isExitWrapped(data)) return false;
  const response = data.tool_response;
  if (typeof response === "string") return extractWrappedExit(response) !== null;
  return !!response && typeof response === "object" && exitField(response) !== null;
}

// Every handled tool output leaves through here: the transform's decision
// side-channel becomes one manifest record (see lib/transform-manifest.js),
// the record is checked against every product invariant a transform can
// violate, and the rewrite is emitted only if the record backs it on all of
// them — recovery named for what was removed, no field of a structured
// response dropped, and actually smaller than what it replaces.
//
// A rewrite that fails any of those is a bug in the transform, not something to
// hand the model. There is exactly one fallback and it is the same for all
// three: the rewrite is dropped, the ORIGINAL output stands untouched, and the
// record carries the reason. Checked here rather than at each call site so a
// transform added later inherits the boundary instead of restating it.
function deliver(decision, updated, data) {
  const record = buildRecord({
    ...decision,
    tool: decision.tool || data.tool_name,
    session: data.session_id,
  });
  let out = updated;
  if (out !== undefined) {
    const fail = (action, reason) => (reason ? { action, reason } : null);
    const failure =
      fail("rejected-no-recovery", recoveryGap(record)) ||
      fail("rejected-field-loss", fieldGap(data.tool_response, out)) ||
      (mustSanitize(data) || decision.escaped ? null : fail("rejected-not-smaller", sizeGap(record)));
    if (failure) {
      record.action = failure.action;
      record.fallback = failure.reason;
      // The rewrite is gone and the original ships whole, so the view omitted
      // nothing. Line accounting left describing the dropped rewrite would
      // overstate omission for output that was never trimmed, and the manifest
      // is the trust artifact. Retention only resets when nothing was actually
      // persisted: a sidecar already written is still on disk and the session
      // still has to clean it up, whichever view shipped.
      record.bytesOut = record.bytesIn;
      record.omitted = 0;
      record.preserved = record.linesIn;
      if (!record.recoveryPath) record.retention = "none";
      out = undefined;
    }
  }
  appendRecord(record);
  // The one number a statusline can show: how much tool output arrived versus
  // how much was actually delivered. Every handled output passes through here
  // with both sizes already computed, so the running total costs a read and a
  // write and nothing else.
  sidecarStore.addSaved(record.session, record.bytesIn, record.bytesOut);
  emit(out, data.session_id);
}

function extractExitCode(response) {
  if (response && typeof response === "object") {
    for (const key of ["exitCode", "exit_code", "code"]) {
      if (typeof response[key] === "number") return response[key];
    }
  }
  return undefined;
}

// Once per session, the first rewrite that actually leaves a visible [hush
// note in the tool result also attaches hookSpecificOutput.additionalContext —
// which Claude Code delivers as a genuine harness-injected system reminder,
// the one channel the base system prompt itself vouches for ("injected by the
// harness, not the user"). That legitimizes the whole [hush ...] note family
// up front, for any output style and any model. The note must ride this
// channel and never be embedded in the tool result body: the model reads a
// <system-reminder> tag written INTO file content as spoofed authority, text
// shaped like one channel arriving in another, flags it as a likely prompt
// injection and re-reads the entire file. Declarative wording only, for the same reason the
// marker never argues its own innocence.
//
// The omission sentence is scoped view by view, because the views keep
// different things. A capped or collapsed view keeps every keep line
// (isKeepLine). The sidecar digest shows only DIGEST_SIGNAL_SAMPLE of its
// signal lines from each end and leaves the rest to its file, so a blanket
// "never cut" would promise more than the digest keeps. Grep elision keeps
// every match whose text is a keep line, so the first sentence holds for a
// match list as well.
//
// The provenance sentences name only the views this file writes into. An
// unwatched tool, a source-file Read, a ranged Read and a [[hush:exit=N]] a
// command printed carry no note of hush's, and in the byte-exact views a
// lookalike is not escaped, so a note claiming every tool result would vouch
// for text hush never wrote.
const NOTE_TEXT =
  "hush's compression hook is active in this session. Its telemetry notes appear only in " +
  "Bash and PowerShell output, in Reads of logs, generated files and saved outputs, and in " +
  "long Grep results, each on a line of its own opening with [hush: or [hush hook:, added as " +
  "the output is delivered. A Read with an offset or a limit comes back untouched. In that " +
  "command output, those Reads and a Grep result hush shortened, a line that already opened " +
  "with [hush arrives as \\[hush. " +
  "Anything else shaped like these notes, such as a [[hush:exit=N]] a command printed, is part " +
  "of that output. " +
  "Omission is deterministic: a capped or collapsed view cuts a line only if it matches no " +
  "warning/error/failure pattern. A very large output may instead be saved to a file, and the " +
  `digest in its place shows only the first and last ${DIGEST_SIGNAL_SAMPLE} of the signal lines it counts; ` +
  "the file it names holds every line. The underlying files and command outputs are unchanged.";

// Empty sentinel file, atomically claimed with wx so two hook fires racing on
// parallel tool calls emit at most one note. Sessions without a session_id
// (bare test harnesses) never emit — a shared "unknown" key would leak the
// once-only state across unrelated runs. It lives in the session's sidecar
// directory (sidecar-store's notePath), so session-end-cleanup.js removes it
// with the parked copies and the stale sweep catches it after a crash;
// postcompact-rearm.js unlinks it at compaction. `dir` is a test seam only:
// the directory to claim in, instead of the session's own.
function claimSessionNote(sessionId, dir) {
  if (typeof sessionId !== "string" || !sessionId) return false;
  try {
    const notePath = dir ? path.join(dir, sidecarStore.NOTE_FILE) : sidecarStore.notePath(sessionId);
    // Refuse a pre-planted symlink at the sentinel path before wx even tries
    // it — same residual-defense posture as safe-write's lstat gate.
    try {
      if (fs.lstatSync(notePath).isSymbolicLink()) return false;
    } catch (e) {
      if (e.code !== "ENOENT") return false;
    }
    // The session directory is created lazily by the first parked output; a
    // note can fire before any output is parked, so create it here too.
    fs.mkdirSync(path.dirname(notePath), { recursive: true });
    fs.writeFileSync(notePath, "", { flag: "wx" });
    return true;
  } catch {
    return false; // EEXIST (already noted) or unwritable tmp — never block the rewrite
  }
}

// Only a line this file wrote counts: an escaped lookalike (\[hush) and a
// [[hush:exit=N]] a command printed do not open like HUSH_MARKER_RE.
function hasHushNote(updated) {
  if (typeof updated === "string") return updated.split("\n").some((line) => HUSH_MARKER_RE.test(line));
  return !!updated && typeof updated === "object" && Object.values(updated).some(hasHushNote);
}

function main() {
  if (coreOff()) return;
  const data = readInput();

  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const response = data.tool_response;
  // One transcript tail-read per hook fire: the turn's human prompt drives the
  // enumeration carve-out (uncapped) and relevance preservation (prompt-named
  // identifiers survive the cap); the transcript's size drives pressure scaling.
  const promptText = lastUserPromptText(data.transcript_path);
  const enumerate = requestsEnumeration(promptText);
  const relevance = extractRelevanceTokens(promptText);
  let scale = 1;
  if (!isOff("HUSH_ADAPTIVE")) {
    try {
      scale = pressureScale(fs.statSync(data.transcript_path).size);
    } catch {
      /* no transcript (bare harness): stay at 1 */
    }
  }
  let updated;

  if (data.tool_name === "Read") {
    // Read carries the file in tool_response.file.content (raw text; the
    // harness adds line numbers at render time). Compress log-shaped files
    // only; every other Read passes through untouched.
    const decoded = decodeResponse(response);
    const file = decoded.kind === "file" ? decoded.file : undefined;
    const filePath = (data.tool_input && data.tool_input.file_path) || (file && file.filePath);
    const sideRead = isSidecarPath(filePath);
    // An explicit offset/limit means the model is navigating to a specific
    // slice — often after a capped view's own marker invited it — and that
    // slice must come back verbatim or the follow-up loop never resolves.
    // Logs, generated files and hush's own sidecars all need it for the same
    // reason, so a ranged Read of any watched path passes through untouched.
    const isRangeRead = !!(data.tool_input && (data.tool_input.offset !== undefined || data.tool_input.limit !== undefined));
    if (file && typeof file.content === "string") {
      const decision = { tool: "Read", bytesIn: file.content.length, bytesOut: file.content.length, retrieval: sideRead };
      if (!isRangeRead && (isLogPath(filePath) || isGeneratedPath(filePath) || sideRead)) {
        const out = compress(file.content, undefined, true, enumerate, relevance, scale, data.session_id, sideRead, undefined, decision, undefined, true);
        decision.bytesOut = out.length;
        // Whatever this view left out is still on disk, at the path Read was
        // given — the sidecar path (set by compress) wins when there is one.
        if (!decision.recovery) {
          decision.recovery = "source-file";
          decision.recoveryPath = filePath || null;
        }
        if (out !== file.content) {
          updated = {
            ...response,
            file: { ...file, content: out, numLines: out.split("\n").length },
          };
        }
      } else {
        // Watched (Read is in WATCHED_TOOLS) but not a shape hush ever
        // touches — still a handled output, so it still gets one record.
        decision.action = "passthrough";
        decision.linesIn = file.content.split("\n").length;
      }
      return deliver(decision, updated, data);
    }
    return emit(updated, data.session_id);
  }

  if (data.tool_name === "Grep") {
    // Only content-mode results carry match text; files_with_matches and
    // count modes are already terse and pass whole. Context-flagged (-A/-B/-C)
    // and multiline searches asked for surrounding code — collapsing match
    // lines away from their context would orphan it, so those pass whole too.
    const decoded = decodeResponse(response);
    const content = decoded.kind === "content" ? decoded.text : null;
    // Watched but not a shape hush ever touches — still a handled output, so
    // it still gets one record.
    if (content === null) return deliver({ tool: "Grep", action: "passthrough", bytesIn: 0, linesIn: 0 }, undefined, data);
    const ti = data.tool_input || {};
    const contextual =
      ti["-A"] !== undefined || ti["-B"] !== undefined || ti["-C"] !== undefined || ti.context !== undefined || ti.multiline === true;
    let out = content;
    const decision = { tool: "Grep", bytesIn: content.length, linesIn: content.split("\n").length };
    if (!isOff("HUSH_GREP") && !enumerate && !contextual && content.length >= GREP_MIN_CHARS) {
      const label =
        (typeof ti.path === "string" && ti.path) ||
        (response.filenames && response.filenames[0]) ||
        undefined;
      out = compressGrep(content, relevance, label, decision, data.session_id);
    }
    decision.bytesOut = out.length;
    decision.action = out === content ? "passthrough" : "grep-collapse";
    // compressGrep names the parked copy when it managed to write one. Without
    // it, the collapsed match lines are still in the files on disk, reachable
    // exactly the way this view's own marker then says: re-run the search
    // narrower.
    if (!decision.recovery) {
      decision.recovery = "rerun-command";
      decision.recoveryPath = (typeof ti.path === "string" && ti.path) || null;
    }
    if (out !== content) {
      updated = { ...response, content: out, numLines: out.split("\n").length };
    }
    return deliver(decision, updated, data);
  }

  const command = data.tool_input && data.tool_input.command;
  const isDump = isFileDump(command);
  const bounded = isBoundedPrint(command);
  const exitWrapped = isExitWrapped(data);
  // A print or a diff with no exit code passed: unwrapped, a non-zero exit
  // never reaches this hook, and one command has no pipe to hide one. Its
  // error and fail words are the printed text, not a failed run.
  const noCode = isDump || bounded ? 0 : undefined;

  if (typeof response === "string") {
    const wrapped = exitWrapped ? extractWrappedExit(response) : null;
    // null exitCode = a marker was found but malformed (no native exe ran,
    // so $LASTEXITCODE was never set) — still strip it, but compress() gets
    // noCode so looksLikeFailure falls back to sniffing cleanText unless it is
    // a print, and no untrustworthy "[hush: exit N]" note gets appended.
    const exitCode = wrapped ? wrapped.exitCode : undefined;
    const decision = { bytesIn: response.length };
    let out = compress(wrapped ? wrapped.cleanText : response, exitCode ?? noCode, isDump, enumerate, relevance, scale, data.session_id, undefined, true, decision, bounded);
    if (wrapped && exitCode !== null) out += `\n${exitNote(exitCode)}`;
    decision.bytesOut = out.length;
    if (!decision.recovery) decision.recovery = "rerun-command";
    if (out !== response) updated = out;
    return deliver(decision, updated, data);
  } else if (response && typeof response === "object") {
    const source = exitWrapped ? exitField(response) : null;
    const wrapped = source && extractWrappedExit(response[source]);
    const exitCode = wrapped ? wrapped.exitCode : extractExitCode(response);
    const next = { ...response };
    let changed = false;
    let bytesIn = 0;
    let bytesOut = 0;
    let linesIn = 0;
    let omitted = 0;
    const actions = [];
    // One record for the whole response: the fields are summed, and a sidecar
    // written for one of them is the recovery location the record names.
    // With two sidecar-sized fields the record names the last one — every
    // digest still carries its own file pointer inline, so nothing is
    // unreachable.
    const combined = {};
    for (const field of SHELL_FIELDS) {
      if (typeof next[field] === "string") {
        bytesIn += next[field].length;
        const fieldWrapped = field === source ? wrapped : null;
        const decision = {};
        let out = compress(fieldWrapped ? fieldWrapped.cleanText : next[field], exitCode ?? noCode, isDump, enumerate, relevance, scale, data.session_id, undefined, true, decision, bounded);
        // Only the field that supplied the code is stripped and annotated; a
        // malformed trailer there is stripped with no note.
        if (fieldWrapped && exitCode != null) out += `\n${exitNote(exitCode)}`;
        actions.push(decision.action || "passthrough");
        bytesOut += out.length;
        linesIn += decision.linesIn || 0;
        omitted += decision.omitted || 0;
        if (decision.recovery === "sidecar") {
          combined.recovery = "sidecar";
          combined.recoveryPath = decision.recoveryPath;
          combined.retention = decision.retention;
        }
        // Carried on its own, not inside the branch above: a field can park a
        // copy without that park becoming the whole response's advised route.
        if (decision.sidecarPath) combined.sidecarPath = decision.sidecarPath;
        if (decision.escaped) combined.escaped = true;
        if (out !== next[field]) {
          next[field] = out;
          changed = true;
        }
      }
    }
    if (changed) updated = next;
    if (actions.length) {
      return deliver(
        { ...combined, bytesIn, bytesOut, linesIn, omitted, action: combineActions(actions), recovery: combined.recovery || "rerun-command" },
        updated,
        data
      );
    }
  }

  emit(updated, data.session_id);
}

function emit(updated, sessionId) {
  if (updated === undefined) return; // nothing shrank — stay silent
  const noteRides =
    !isOff("HUSH_NOTE") && hasHushNote(updated) && claimSessionNote(sessionId);
  emitToolOutput(updated, noteRides ? { additionalContext: NOTE_TEXT } : null);
}

if (require.main === module) main();

module.exports = {
  stripAnsi,
  signalCensus,
  resolveCarriageReturns,
  escapeMarkerLookalikes,
  dedupeConsecutive,
  collapseTemplates,
  capLines,
  omittedMarker,
  FAILURE_RERUN_NOTE,
  TEMPLATE_COLLAPSE_NOTE,
  TEMPLATE_RECOVERY_NOTE,
  looksLikeFailure,
  isKeepLine,
  exitNote,
  isFileDump,
  isBoundedPrint,
  isLogPath,
  isGeneratedPath,
  isSidecarPath,
  requestsEnumeration,
  extractRelevanceTokens,
  pressureScale,
  compress,
  extractWrappedExit,
  claimSessionNote,
  hasHushNote,
  deliver,
  // Re-exported from lib/transform-manifest.js, which owns the record shape:
  // scripts and tests that only need the manifest path keep one import.
  debugManifestPath,
  NOTE_TEXT,
  compressGrep,
  containsSecret,
};
