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
const { coreOff } = require("./lib/gate");

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
// per-file count (compressGrep). Corpus-measured: the mass is in the >=4KB
// tail, and per-file counts keep the file map intact.
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
//   4. Fewer than TEMPLATE_MIN_RUN same-shape lines collapse to nothing at all;
//      the run is emitted verbatim.
//
// Anything outside 2-4 is fair game, and the dropped lines are NOT recoverable
// from the view — only from the source, which is what the footer names.
function collapseTemplates(lines, relevanceTokens) {
  if (process.env.HUSH_TEMPLATE === "off") return lines;
  const named = relevanceMatcher(lines, relevanceTokens);
  const exempt = (line) => isKeepLine(line) || named(line);
  const out = [];
  let runStart = -1;
  let anchorTokens = null;
  let runLen = 0;

  function flushRun() {
    if (runLen >= TEMPLATE_MIN_RUN) {
      out.push(lines[runStart]);
      out.push(`[hush hook: ${runLen - 1} similar lines collapsed (same shape, varying values)]`);
    } else {
      for (let i = runStart; i < runStart + runLen; i++) out.push(lines[i]);
    }
    runStart = -1;
    anchorTokens = null;
    runLen = 0;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (exempt(line)) {
      if (runLen > 0) flushRun();
      out.push(line);
      continue;
    }
    const lineTokens = templateTokens(line);
    if (runLen > 0 && shareTemplate(anchorTokens, lineTokens)) {
      runLen++;
      continue;
    }
    if (runLen > 0) flushRun();
    runStart = i;
    anchorTokens = lineTokens;
    runLen = 1;
  }
  if (runLen > 0) flushRun();
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

// Lines that look like they carry the task's actual signal (warnings, errors,
// deprecations) survive the cap regardless of position — only surrounding
// noise (progress logs, install trees) gets cut. A blind head+tail slice was
// caught clipping build warnings out of a passing run, which then made the
// agent re-run the command hunting for what it couldn't see — the cap
// destroying signal cost more tool calls than the cap ever saved. Deliberately
// broad regex: over-matching just keeps a few extra lines, never worse.
// The trailing `(?:Error|Warning)\b` catches compound runtime names —
// ReferenceError, TypeError, SyntaxError, RangeError — that a bare `\bERROR\b`
// misses because the "Error" suffix sits mid-word (no word boundary before
// it). Over-matching a stray "NoError"-style token only keeps a few extra
// lines, never fewer, so the broad form is safe by the same logic as the rest.
// Deliberately UNANCHORED on the left: a leading `\w*` matches the same set of
// lines (it can always match empty, and nothing here reads the matched text)
// while making the pattern backtrack quadratically on a long run of word
// characters — one 256KB line of base64 or minified JS measured at 68 seconds,
// against this hook's own 5-second budget.
const SIGNAL_RE = /\b(WARN(?:ING)?|ERR(?:OR)?|FAIL(?:URE|ED)?|DEPRECATED|CRITICAL)\b|(?:Error|Warning)\b/i;

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
// is exactly injection-shaped; Sonnet has been observed (stochastically)
// flagging it mid-turn and re-reading the whole file. The same base prompt
// also tells the model "Hooks may intercept tool calls", so a marker that
// attributes itself to a hook attaches to a fact the harness itself planted.
// Provenance is stated, never argued: no "trust me", no "not an injection" —
// naming the feared category primes it.
function omittedMarker(n) {
  return `[hush hook: ${n} lines omitted from this view, none with warnings/errors/failures]`;
}

// Closing line on a capped view of a FAILING run — the same recovery advice
// the sidecar header gives its own path, for the failures that stay inline.
// capLines keeps every keep line by construction — and the keep vocabulary is
// the union of signal and failure evidence, so the first causal error (header,
// frame and exception alike) and the failing summary are all above this line:
// the guarantee is provable, which is why it is stated as one rather than as
// reassurance.
const FAILURE_RERUN_NOTE =
  "[hush hook: this run failed and the view above is capped — every warning/error/failure line " +
  "from the full output is kept, in original order. Re-run the command for the lines omitted between them.]";

// Every line this file inserts into a line-oriented view opens this way (the
// omission marker above, the dedupe and template-collapse markers, the grep
// summary header). Used only for manifest accounting — see compress().
const HUSH_MARKER_RE = /^\[hush(?: hook)?: /;

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

function capLines(lines, cap, relevanceTokens) {
  if (lines.length <= cap) return lines;
  const signalIdx = new Set();
  lines.forEach((line, i) => {
    if (isKeepLine(line)) signalIdx.add(i);
  });
  for (const i of relevanceLineIdx(lines, relevanceTokens)) signalIdx.add(i);
  const budget = Math.max(0, cap - signalIdx.size);
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  const kept = new Set(signalIdx);
  for (let i = 0; i < head && i < lines.length; i++) kept.add(i);
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) kept.add(i);
  // A marker hush inserted (a repeat count, a collapse count) sits directly
  // after the line it annotates and is the only trace of the occurrences it
  // stands for — a kept line whose marker got cut silently under-reports
  // itself. So a marker survives whenever its line does. Markers whose line is
  // gone are dropped with it; the omission marker already covers that span.
  for (const i of [...kept]) {
    for (let j = i + 1; j < lines.length && HUSH_MARKER_RE.test(lines[j]); j++) kept.add(j);
  }

  const sortedKept = [...kept].sort((a, b) => a - b);
  const out = [];
  let last = -1;
  for (const i of sortedKept) {
    if (i - last > 1) out.push(omittedMarker(i - last - 1));
    out.push(lines[i]);
    last = i;
  }
  if (lines.length - 1 - last > 0) out.push(omittedMarker(lines.length - 1 - last));
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
const FAILURE_RE =
  /(^|[^0-9a-zA-Z])(fail(ed|ure|ures|ing|s)?|err(or)?s?|err!|not ok|traceback|exception|panic|fatal|✗|✘)([^0-9a-zA-Z]|$)/im;

// A Python traceback's causal location lives in its frame lines, and those
// match neither vocabulary — only the `Traceback` header and the trailing
// exception do. Keeping just those two turns "the first causal error survives"
// into a claim with no file:line in it, so the frame shape itself is a keep
// line. Anchored and quote-delimited, so it costs nothing on other output.
const TRACEBACK_FRAME_RE = /^\s*File "[^"]+", line \d+/;

// The one KEEP vocabulary, shared by every transform that elides lines
// (dedupeConsecutive, collapseTemplates, capLines). It is the union of what
// hush calls signal and what it calls failure evidence: the classification
// half used to be strictly wider — `not ok`, `✗`, `panic`, `fatal`,
// `Traceback`, `exception`, `err!`, `failing` classified a run as failed while
// nothing preserved those same lines — so a capped view could promise every
// failure line was kept and drop most of them. One vocabulary, one promise.
function isKeepLine(line) {
  return SIGNAL_RE.test(line) || FAILURE_RE.test(line) || TRACEBACK_FRAME_RE.test(line);
}

// A green summary states its own score — "0 failures", "no errors", node's own
// "fail 0" — and those words are the opposite of failure evidence. Blanking
// zero-quantified counts before the sniff keeps a passing test run on the pass
// cap; any non-zero count is left alone and still classifies as a failure.
//
// The second branch only blanks when the zero ENDS the phrase — end of line,
// comma, other punctuation. "Error: 0 tests found" counts a different noun,
// and blanking it there left no failure token in a line that plainly is one.
// The lookahead is space/tab-scoped rather than \s so a "# fail 0" ending a
// line still blanks when more output follows on the next line.
const ZERO_COUNT_RE = /\b(?:0|no)\s+(?:\w+\s+){0,2}?(?:fail\w*|error\w*)\b|\b(?:fail\w*|error\w*)\s*[:=]?\s*0\b(?![ \t]*\w)/gi;

function looksLikeFailure(text, exitCode) {
  // Exit-code evidence outranks text sniffing: when preserve-exit-code's
  // trailer reported a real code, a log full of the
  // word "error" is still a passing run, and a silent log with code 1 is still
  // a failure.
  if (typeof exitCode === "number") return exitCode !== 0;
  return FAILURE_RE.test(String(text).replace(ZERO_COUNT_RE, ""));
}

// A command that just dumps a whole file's contents (cat/type/Get-Content,
// no pipe/chain/redirect) exits 0 without meaning "safe to trim like a build
// log" — a clean exit there just means the file was read. Source text has no
// WARN/ERROR markers for capLines' signal-preservation to anchor on, so the
// head+tail cap would cut arbitrary lines out of the middle of the file
// instead of out of actual log noise. Treat these like failures: keep more.
const FILE_DUMP_RE = /^\s*(cat|type|gc|Get-Content)\s+[^|;&<>]+$/i;

function isFileDump(command) {
  return typeof command === "string" && FILE_DUMP_RE.test(command.trim());
}

// preserve-exit-code.js (a PreToolUse hook) wraps Bash/PowerShell commands so
// a non-zero exit still reports success to Claude Code — otherwise the call
// routes through PostToolUseFailure, which this hook never sees at all (see
// that file's header). The wrapper wants an original single-line command to
// still test true against FILE_DUMP_RE above; take only the first line so a
// wrapped multi-statement command doesn't fail that match.
function firstLine(command) {
  if (typeof command !== "string") return command;
  const i = command.indexOf("\n");
  return i === -1 ? command : command.slice(0, i);
}

// Matches the trailer preserve-exit-code.js appends. Real output splits the
// prefix, the number, and the suffix across three separate lines (its
// wrapper never puts a variable inside a quoted string or parens — see that
// file's header for why), CRLF or LF — `\s*` bridges the line breaks either
// way.
//
// Two separate patterns, deliberately: MARKER_ANY has no digit requirement,
// so it also matches a MALFORMED marker (empty capture) — PowerShell only
// sets $LASTEXITCODE for a native executable, so a pure-cmdlet command
// (`Get-ChildItem | Select-Object`, a bare `Get-Content`) leaves it
// null/stale and the wrapper emits `[[hush:exit=\n\n]]` with nothing inside.
// That text must still be stripped — never leaked to the model raw — even
// though it carries no usable exit code. Every occurrence gets removed
// unconditionally (not just the last one): Claude Code's own "output too
// large, persisted to a sidecar file" mechanism has been observed capturing
// RAW pre-hook output including an already-well-formed marker, and a later
// `Get-Content -Tail` on that sidecar file gets wrapped again by this same
// hook — two markers can legitimately land in one tool result.
const EXIT_MARKER_ANY_RE = /\[\[hush:exit=[^[\]]*\]\]/g;
const EXIT_MARKER_VALID_RE = /\[\[hush:exit=\s*(-?\d+)\s*\]\]/g;
// The same pattern without /g, for the one caller that asks "is there a marker
// here at all?" rather than replacing them. Derived from ANY's source so the
// two can never drift, and non-global so a .test() carries no lastIndex state.
const EXIT_MARKER_PRESENT_RE = new RegExp(EXIT_MARKER_ANY_RE.source);

// Returns null when no hush marker appears at all (nothing to strip, caller
// uses the old regex-sniffing heuristic). Otherwise always strips every
// marker occurrence from cleanText; exitCode is the last WELL-FORMED
// occurrence's value, or null if every marker found was malformed/empty —
// callers must treat a null exitCode the same as "no reliable exit code
// known" (fall back to sniffing cleanText) while still using the stripped
// cleanText and skipping the `[hush: exit N]` trailer note.
function extractWrappedExit(text) {
  if (typeof text !== "string" || !text.includes("[[hush:exit=")) return null;

  EXIT_MARKER_VALID_RE.lastIndex = 0;
  let match;
  let lastValid;
  while ((match = EXIT_MARKER_VALID_RE.exec(text))) lastValid = match;

  const cleanText = text.replace(EXIT_MARKER_ANY_RE, "").replace(/\n{3,}/g, "\n\n").replace(/\s+$/, "");
  return { exitCode: lastValid ? parseInt(lastValid[1], 10) : null, cleanText };
}

// A shell reports a signal death as 128+N, so the trailer's own number already
// carries the cause — "exit 137" is a kill, "exit 143" a terminate (both
// verified live through the bash wrapper). Naming the signal beside the code
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
//   2. Every SIGNAL_RE match line and every match line naming a prompt-quoted
//      identifier survives regardless of position (usableRelevanceTokens
//      applies the too-common guard first).
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
    let key = null;
    if (singleMode) {
      if (GREP_SINGLE_RE.test(line)) key = label;
    } else {
      const m = GREP_MATCH_RE.exec(line);
      if (m) key = m[1];
    }
    if (key === null) {
      kept.push(line);
      continue;
    }
    let s = perFile.get(key);
    if (!s) {
      s = { total: 0, shown: 0 };
      perFile.set(key, s);
    }
    s.total++;
    const forced = SIGNAL_RE.test(line) || named(line);
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
  const out = [...kept, marker, ...summary].join("\n");
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
// a 60k-char `Read logs/app.log` enters context whole and is re-sent on every
// subsequent API call — the one noisy-input path hush used to leave open.
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
// session grows. Inert below 400KB (every benchmark session and most short
// real ones), floors keep failing output useful, and the enumeration
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
// Upper bound for SHELL outputs only. Claude Code truncates a Bash/PowerShell
// result to ~29KB for the hook (and the model) once it trips its own
// large-output persistence, keeping the full text in a native file it points
// at. So a shell output arriving at ~28KB+ was likely already truncated: its
// tail — where a build's error or a run's final result usually lives — may be
// gone before this hook sees it, and sidecaring it both (a) writes a "saved in
// full" file that is actually the truncated portion, and (b) adds a second
// "full output elsewhere" pointer competing with Claude Code's own, which just
// sends the model reading the native raw file. Above this bound, shell outputs
// fall through to the normal inline cap (no sidecar, no extra pointer) so hush
// tracks baseline instead of doing worse. Read results are exempt: Read returns
// the file's full content to the hook (its own limits are far larger), so a big
// lockfile/log Read is complete and the sidecar is genuinely full and helpful.
const SIDECAR_SHELL_MAX = intEnv("HUSH_SIDECAR_SHELL_MAX", 28000);
const DIGEST_HEAD = 20;
const DIGEST_TAIL = 15;
const DIGEST_SIGNAL_SAMPLE = 10; // first N + last N signal lines
const OTHER_SIGNAL_CAP = 15; // max line numbers listed in the "not shown" line

// Subpatterns of SIGNAL_RE's own alternation (never edited independently),
// so every line that reached signalIdx matches exactly one of these. Priority
// order when a line matches several (e.g. "ERROR ... ReferenceError"):
// error > failure > critical > warning > deprecation — each line counts once,
// under whichever category wins.
const CENSUS_CATEGORIES = [
  { singular: "error", plural: "errors", re: /Error\b|\bERR(?:OR)?\b/i },
  { singular: "failure", plural: "failures", re: /\bFAIL(?:URE|ED)?\b/i },
  { singular: "critical", plural: "criticals", re: /\bCRITICAL\b/i },
  { singular: "warning", plural: "warnings", re: /Warning\b|\bWARN(?:ING)?\b/i },
  { singular: "deprecation", plural: "deprecations", re: /\bDEPRECATED\b/i },
];

// A bare count ("14 with warnings/errors/failures") makes a model misreport
// on a completeness task without retrieving — a categorical census with named
// counts lets it retrieve correctly (eval-proven against live models). Renders like
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

function buildSidecarDigest(cleaned, relevanceTokens) {
  const lines = cleaned.split("\n");
  const total = lines.length;
  // The header advertises non-empty lines: a trailing newline or blank
  // separator is not output, and a raw element count reads as one-more-than-
  // the-records to anyone doing arithmetic on it.
  const nonBlank = lines.filter((l) => l.trim() !== "").length;
  const signalIdx = [];
  lines.forEach((l, i) => {
    if (SIGNAL_RE.test(l)) signalIdx.push(i);
  });

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
  out.push("Structure (head + tail; read the file for the rest):");
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
  if (process.env.HUSH_SIDECAR === "off") return null;
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

function maybeSidecar(cleaned, relevanceTokens, sessionId, hostMayTruncate, failed) {
  if (process.env.HUSH_SIDECAR === "off") return null;
  if (typeof cleaned !== "string" || cleaned.length < SIDECAR_MIN_CHARS) return null;
  // A shell output at/above the host-truncation size was likely already cut by
  // Claude Code (see SIDECAR_SHELL_MAX): step aside to the inline cap so hush
  // adds no truncated "full" file and no competing pointer.
  //
  // A FAILING run is the exception. That output is evidence, and above this
  // size the inline cap is otherwise the ONLY surviving copy of it — a 40KB
  // failing build log reaches the model as a couple of dozen lines with nowhere
  // to recover the rest from. It gets the recovery copy, and the header drops
  // the "in full" claim it can no longer make.
  const partial = !!(hostMayTruncate && cleaned.length >= SIDECAR_SHELL_MAX);
  if (partial && !failed) return null;
  try {
    // sidecarTarget scans for secrets before ever handing back a path, so a
    // credential-shaped payload falls through to the ordinary inline cap
    // rather than being written out "cleaned".
    const file = sidecarTarget(cleaned, sessionId);
    if (!file) return null;
    const d = buildSidecarDigest(cleaned, relevanceTokens);
    const p = file.replace(/\\/g, "/");
    const saved = partial ? `was saved to ${p} as hush received it` : `was saved in full to ${p}`;
    const header =
      `[hush hook: this output is ${d.nonBlank} non-empty lines (${d.census || "0 signal lines"}) ` +
      `and ${saved}; the digest below keeps the head, tail, ` +
      `every prompt-named line, and a sample of the signal lines, each with its L<n> line number. ` +
      `For anything else — including any total or count you report — Read that file with ` +
      `offset/limit around the L<n> numbers you need. ` +
      `If that file no longer exists, re-run the command — a second run is not guaranteed ` +
      `to reproduce this output.]`;
    const out = `${header}\n${d.body}`;
    // A near-line-free payload (e.g. one giant minified-JSON line) leaves
    // buildSidecarDigest's head/tail trim nothing to cut — the digest would
    // reproduce the whole input plus header overhead, larger than the source.
    // Bail before ever touching disk and let compress() fall through to the
    // ordinary inline cap, which is a no-op here too but at least isn't larger.
    if (out.length >= cleaned.length) return null;
    if (!writeSidecar(file, cleaned)) return null;
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
// decision object is supplied.
function compress(text, exitCode, isDump, enumerate, relevanceTokens, scale, sessionId, noSidecar, hostMayTruncate, decision) {
  const original = String(text);
  const cleaned = resolveCarriageReturns(stripAnsi(original));
  const linesIn = cleaned.split("\n").length;
  if (decision) decision.linesIn = linesIn;
  // Classified once, up front: the same answer picks the cap below AND decides
  // whether the sidecar's shell-window guard steps aside (see maybeSidecar).
  const failed = looksLikeFailure(cleaned, exitCode);
  if (!enumerate && !noSidecar) {
    const side = maybeSidecar(cleaned, relevanceTokens, sessionId, hostMayTruncate, failed);
    if (side !== null) {
      if (decision) {
        decision.action = "sidecar";
        decision.omitted = side.omitted;
        decision.recovery = "sidecar";
        decision.recoveryPath = side.file;
        decision.sidecarPath = side.file;
        decision.retention = "session";
      }
      return side.text;
    }
    // Sidecar was skipped specifically by the shell-truncation guard (large
    // enough to qualify, but the host may have already cut the tail) — note
    // that even though the output falls through to the ordinary cap below.
    if (decision && !failed && hostMayTruncate && cleaned.length >= SIDECAR_MIN_CHARS && cleaned.length >= SIDECAR_SHELL_MAX) {
      decision.action = "shell-guard-skip";
    }
  }
  const s = typeof scale === "number" ? scale : 1;
  const cap = enumerate
    ? CAP_ENUMERATE
    : isDump || failed
      ? Math.max(FLOOR_FAIL, Math.round(CAP_FAIL * s))
      : Math.max(FLOOR_PASS, Math.round(CAP_PASS * s));
  // Enumeration carve-out means "nothing is elided" — same reason it skips the
  // sidecar above; collapsing same-shape runs would remove the very items a
  // completeness request ("list every compiled module") asked to see.
  let lines = dedupeConsecutive(cleaned.split("\n"));
  const dedupedLen = lines.length;
  if (!enumerate) lines = collapseTemplates(lines, relevanceTokens);
  const beforeCapLen = lines.length;
  const collapsed = beforeCapLen < dedupedLen;
  const capped = beforeCapLen > cap; // capLines' own no-op guard is `length <= cap`
  lines = capLines(lines, cap, relevanceTokens);
  if (failed && capped) lines.push(FAILURE_RERUN_NOTE);
  let out = lines.join("\n");
  // The collapse markers themselves say nothing about how to get the collapsed
  // lines back; the footer does, once per view. Appended after the join, so it
  // never enters the line accounting below, and only when the collapse still
  // pays for it — a view that grew to state its own recovery would be a worse
  // deal than not collapsing at all.
  if (collapsed && out.length + TEMPLATE_COLLAPSE_NOTE.length + 1 < cleaned.length) {
    out += `\n${TEMPLATE_COLLAPSE_NOTE}`;
  }
  // Line accounting for the manifest, derived from the view itself rather than
  // threaded out of dedupe/collapse/cap separately: a line hush keeps is kept
  // verbatim and everything hush adds is a bracketed [hush marker, so the
  // non-marker output lines are exactly the input lines this view preserved.
  // An input line that itself opens with a [hush marker (re-reading a digest)
  // counts as one of hush's own — that overstates omission slightly, which can
  // only make recovery metadata MORE required, never less.
  if (decision) decision.omitted = Math.max(0, linesIn - lines.filter((l) => !HUSH_MARKER_RE.test(l)).length);
  if (decision && !decision.action) {
    if (capped) decision.action = "cap";
    else if (collapsed) decision.action = "template-collapse";
    else if (enumerate) decision.action = "enumerate-passthrough";
    else if (out === original) decision.action = "passthrough";
    else decision.action = "scrub-only"; // ansi/CR/dupe/exit-marker cleanup only
  }
  return out;
}

// preserve-exit-code's wrapper marker is hush's own protocol text, and the one
// rewrite that is not a compression bargain: stripping it is mandatory, so a
// response carrying one is exempt from the size invariant below. Dropping back
// to the original there would leak `[[hush:exit=N]]` into the model's context
// raw, which is the single thing extractWrappedExit exists to prevent.
//
// Keyed on the STRIPPABLE marker, not on the `[[hush:exit=` prefix: the host
// truncates raw output around 29KB and can cut a real marker mid-text, and
// hush's own source or docs dumped to stdout carry the bare prefix as
// literal text. In both cases the stripper removes nothing, so exempting the
// size invariant would ship a growing rewrite AND still leave the prefix in
// front of the model — the worst of both.
function mustSanitize(response) {
  const strippable = (v) => typeof v === "string" && EXIT_MARKER_PRESENT_RE.test(v);
  if (typeof response === "string") return strippable(response);
  if (response && typeof response === "object") {
    return SHELL_FIELDS.some((field) => strippable(response[field]));
  }
  return false;
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
      (mustSanitize(data.tool_response) ? null : fail("rejected-not-smaller", sizeGap(record)));
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
// channel and never be embedded in the tool result body: a <system-reminder>
// tag written INTO file content was tried and measured strictly worse — the
// model reads channel-shaped text in the wrong channel as spoofed authority
// ("a fake system-reminder tag... likely a prompt-injection attempt") and
// re-reads the entire file. Declarative wording only, for the same reason the
// marker never argues its own innocence.
const NOTE_TEXT =
  "hush's compression hook is active in this session. Bracketed notes beginning with " +
  "[hush inside tool results are its own telemetry, added as the output is delivered. " +
  "Omission is deterministic: a line is cut only if it matches no warning/error/failure " +
  "pattern, and the underlying files and command outputs are unchanged.";

// Empty sentinel file, atomically claimed with wx so two hook fires racing on
// parallel tool calls emit at most one note. Sessions without a session_id
// (bare test harnesses) never emit — a shared "unknown" key would leak the
// once-only state across unrelated runs. The sentinel is left for OS temp
// cleaning.
function claimSessionNote(sessionId, tmpDir) {
  if (typeof sessionId !== "string" || !sessionId) return false;
  try {
    const notePath = path.join(tmpDir || os.tmpdir(), `hush-note-${sessionId}`);
    // Refuse a pre-planted symlink at the sentinel path before wx even tries
    // it — same residual-defense posture as safe-write's lstat gate.
    try {
      if (fs.lstatSync(notePath).isSymbolicLink()) return false;
    } catch (e) {
      if (e.code !== "ENOENT") return false;
    }
    fs.writeFileSync(notePath, "", { flag: "wx" });
    return true;
  } catch {
    return false; // EEXIST (already noted) or unwritable tmp — never block the rewrite
  }
}

function hasHushNote(updated) {
  try {
    return JSON.stringify(updated).includes("[hush");
  } catch {
    return false;
  }
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
  if (process.env.HUSH_ADAPTIVE !== "off") {
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
        const out = compress(file.content, undefined, true, enumerate, relevance, scale, data.session_id, sideRead, undefined, decision);
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
    if (process.env.HUSH_GREP !== "off" && !enumerate && !contextual && content.length >= GREP_MIN_CHARS) {
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

  const isDump = isFileDump(firstLine(data.tool_input && data.tool_input.command));

  if (typeof response === "string") {
    const wrapped = extractWrappedExit(response);
    // null exitCode = a marker was found but malformed (no native exe ran,
    // so $LASTEXITCODE was never set) — still strip it, but compress() gets
    // undefined so looksLikeFailure falls back to sniffing cleanText, and no
    // untrustworthy "[hush: exit N]" note gets appended.
    const exitCode = wrapped ? wrapped.exitCode : undefined;
    const decision = { bytesIn: response.length };
    let out = compress(wrapped ? wrapped.cleanText : response, exitCode ?? undefined, isDump, enumerate, relevance, scale, data.session_id, undefined, true, decision);
    if (wrapped && exitCode !== null) out += `\n${exitNote(exitCode)}`;
    decision.bytesOut = out.length;
    if (!decision.recovery) decision.recovery = "rerun-command";
    if (out !== response) updated = out;
    return deliver(decision, updated, data);
  } else if (response && typeof response === "object") {
    const wrapped =
      extractWrappedExit(response.stdout) || extractWrappedExit(response.stderr) || extractWrappedExit(response.output);
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
        const fieldWrapped = extractWrappedExit(next[field]);
        const decision = {};
        let out = compress(fieldWrapped ? fieldWrapped.cleanText : next[field], exitCode ?? undefined, isDump, enumerate, relevance, scale, data.session_id, undefined, true, decision);
        if (fieldWrapped && exitCode !== null) out += `\n${exitNote(exitCode)}`;
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
    process.env.HUSH_NOTE !== "off" && hasHushNote(updated) && claimSessionNote(sessionId);
  emitToolOutput(updated, noteRides ? { additionalContext: NOTE_TEXT } : null);
}

if (require.main === module) main();

module.exports = {
  stripAnsi,
  signalCensus,
  resolveCarriageReturns,
  dedupeConsecutive,
  collapseTemplates,
  capLines,
  omittedMarker,
  FAILURE_RERUN_NOTE,
  TEMPLATE_COLLAPSE_NOTE,
  looksLikeFailure,
  isKeepLine,
  exitNote,
  isFileDump,
  isLogPath,
  isGeneratedPath,
  isSidecarPath,
  requestsEnumeration,
  extractRelevanceTokens,
  pressureScale,
  compress,
  firstLine,
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
