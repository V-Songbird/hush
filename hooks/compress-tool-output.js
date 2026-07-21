#!/usr/bin/env node
"use strict";

// PostToolUse hook: mechanically shrinks Bash/PowerShell output — plus Read
// results for log-shaped files and oversized Grep match lists — before they
// enter context. Deterministic text transforms only — no heuristic ever
// touches failure detail: failing runs get a much larger cap and everything
// kept is verbatim.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { lastUserPromptText } = require("./lib/transcript");
const { safeWriteFileSync } = require("./lib/safe-write");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell", "Read", "Grep"]);
// Edit/Write/MultiEdit never get their own output touched (see EDIT_TOOLS
// below) — watched only so a re-read delta on the same path can tell "the
// session changed this itself" apart from "this changed for some other
// reason", per the re-read delta's correctness guard.
const EDIT_TOOLS = new Set(["Edit", "Write", "MultiEdit"]);

// Caps are in lines. Passing output is mostly noise (install trees, progress
// logs); failing output is evidence, so it keeps ~4x more.
const CAP_PASS = intEnv("HUSH_CAP_PASS", 60);
const CAP_FAIL = intEnv("HUSH_CAP_FAIL", 250);
// Enumeration carve-out cap (see requestsEnumeration). Large enough that a
// normal noisy build/log passes whole — no omission markers at all — so a model
// asked to report EVERY item has nothing elided to distrust. Still bounded, so
// a pathological megaline dump can't blow context.
const CAP_ENUMERATE = intEnv("HUSH_CAP_ENUMERATE", 2000);
// Grep content-mode results below this size pass whole; above it, each
// matched file keeps its first few match lines and the rest collapse to a
// per-file count (compressGrep). Corpus-measured: the mass is in the >=4KB
// tail, and per-file counts keep the file map intact.
const GREP_MIN_CHARS = intEnv("HUSH_GREP_MIN", 4000);
const GREP_KEEP_PER_FILE = intEnv("HUSH_GREP_KEEP", 3);

function intEnv(name, fallback) {
  const n = parseInt(process.env[name] || "", 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf-8") || "{}");
  } catch {
    return {};
  }
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

function dedupeConsecutive(lines) {
  const out = [];
  let run = 0;
  for (let i = 0; i <= lines.length; i++) {
    if (i < lines.length && out.length && lines[i] === out[out.length - 1] && lines[i].trim() !== "") {
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
const TEMPLATE_MIN_RUN = intEnv("HUSH_TEMPLATE_MIN_RUN", 5);

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

// A SIGNAL_RE line never joins a run and always breaks one — over-normalizing
// distinct errors into one exemplar is the known failure mode this sidesteps
// entirely, rather than trying to tune around it.
function collapseTemplates(lines) {
  if (process.env.HUSH_TEMPLATE === "off") return lines;
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
    if (SIGNAL_RE.test(line)) {
      if (runLen > 0) flushRun();
      out.push(line);
      continue;
    }
    const tokens = templateTokens(line);
    if (runLen > 0 && shareTemplate(anchorTokens, tokens)) {
      runLen++;
      continue;
    }
    if (runLen > 0) flushRun();
    runStart = i;
    anchorTokens = tokens;
    runLen = 1;
  }
  if (runLen > 0) flushRun();
  return out;
}

// Lines that look like they carry the task's actual signal (warnings, errors,
// deprecations) survive the cap regardless of position — only surrounding
// noise (progress logs, install trees) gets cut. A blind head+tail slice was
// caught clipping build warnings out of a passing run, which then made the
// agent re-run the command hunting for what it couldn't see — the cap
// destroying signal cost more tool calls than the cap ever saved. Deliberately
// broad regex: over-matching just keeps a few extra lines, never worse.
// The trailing `\w*(?:Error|Warning)\b` catches compound runtime names —
// ReferenceError, TypeError, SyntaxError, RangeError — that a bare `\bERROR\b`
// misses because the "Error" suffix sits mid-word (no word boundary before
// it). Over-matching a stray "NoError"-style token only keeps a few extra
// lines, never fewer, so the broad form is safe by the same logic as the rest.
const SIGNAL_RE = /\b(WARN(?:ING)?|ERR(?:OR)?|FAIL(?:URE|ED)?|DEPRECATED|CRITICAL)\b|\w*(?:Error|Warning)\b/i;

// A bare "N lines omitted" reads to the model as "signal might be hidden in
// this gap." On a completeness task ("report EVERY warning") that distrust is
// rational and expensive: the model can't know the cap preserved every signal
// line, so it re-runs the command to recover what it thinks it's missing —
// each extra turn re-sends full context and the compression backfires. But
// capLines keeps every SIGNAL_RE match by construction, so an omitted span
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

function capLines(lines, cap, relevanceTokens) {
  if (lines.length <= cap) return lines;
  const signalIdx = new Set();
  lines.forEach((line, i) => {
    if (SIGNAL_RE.test(line)) signalIdx.add(i);
  });
  if (relevanceTokens && relevanceTokens.length) {
    const lower = lines.map((l) => l.toLowerCase());
    for (const tok of relevanceTokens) {
      const hits = [];
      for (let i = 0; i < lower.length; i++) if (lower[i].includes(tok)) hits.push(i);
      if (hits.length > 0 && hits.length <= RELEVANCE_COMMON) for (const i of hits) signalIdx.add(i);
    }
  }
  const budget = Math.max(0, cap - signalIdx.size);
  const head = Math.ceil(budget * 0.6);
  const tail = budget - head;
  const kept = new Set(signalIdx);
  for (let i = 0; i < head && i < lines.length; i++) kept.add(i);
  for (let i = Math.max(0, lines.length - tail); i < lines.length; i++) kept.add(i);

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

// Deliberately simple: word-boundary failure sniff, exit-code field wins when present.
// False positives only make the cap more generous — safe direction.
const FAILURE_RE = /(^|[^0-9a-zA-Z])(FAIL(ED|URE)?|fail(ed|ure)?s?:|Error|error:|ERR!|✗|✘|not ok|Traceback|exception|panic|fatal)([^0-9a-zA-Z]|$)/m;

function looksLikeFailure(text, exitCode) {
  if (typeof exitCode === "number") return exitCode !== 0;
  return FAILURE_RE.test(text);
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
// disappears silently — each matched file keeps its first few match lines,
// every SIGNAL_RE or prompt-named line survives regardless, the rest collapse
// to one per-file count line, and the marker states the rule. Lines that
// don't parse as matches (multiline-match continuations, separators) are kept
// verbatim. Two line formats exist: `path:line:` for directory searches and
// bare `line:` when a single explicit file was searched — whichever parses
// more lines wins, decided once per result so an ambiguous line can't flip
// mid-list. The non-greedy prefix backtracks across Windows drive-letter
// colons (`C:\x.js:12:` parses as path `C:\x.js`).
const GREP_MATCH_RE = /^(.*?):(\d+):/;
const GREP_SINGLE_RE = /^\d+:/;

function compressGrep(content, relevanceTokens, fileLabel) {
  const lines = content.split("\n");
  // Same too-common guard capLines applies: a prompt-named span that matches
  // more than RELEVANCE_COMMON lines can't discriminate — and for Grep the
  // quoted SEARCH PATTERN itself sits in every match line by definition, so
  // without this guard relevance-forcing would exempt the whole result.
  let tokens = [];
  if (relevanceTokens && relevanceTokens.length) {
    const lower = lines.map((l) => l.toLowerCase());
    tokens = relevanceTokens.filter((tok) => {
      let hits = 0;
      for (const l of lower) if (l.includes(tok)) hits++;
      return hits > 0 && hits <= RELEVANCE_COMMON;
    });
  }
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
    const lowerLine = line.toLowerCase();
    const forced = SIGNAL_RE.test(line) || tokens.some((t) => lowerLine.includes(t));
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
  const out = [
    ...kept,
    `[hush hook: ${omitted} match lines omitted; every matched file is counted below, and every warning/error-shaped match was kept. Files on disk are unchanged — re-run with a narrower pattern or a path filter for the full list]`,
    ...summary,
  ].join("\n");
  return out.length < content.length ? out : content;
}

// MCP JSON table-ification (ROADMAP 007 / Probe 7): a measured probe over
// 6,739 real MCP tool_results on this machine found 429 eligible (>=2KB,
// homogeneous JSON-record array) payloads with a MEDIAN 27.9% char savings
// rendering as a schema-header + tab-rows table instead of raw JSON — gate
// (>=100 eligible, >=15% median) passed. Scoped by MCP METHOD suffix, not
// server prefix, so it survives whatever alias a user's MCP config gives the
// JetBrains server (measured as "idea" here, "jetbrains" elsewhere); only
// methods with >=20 measured eligible payloads are included.
const MCP_TABLE_MIN_CHARS = 2048;
const MCP_TABLE_MIN_RECORDS = 5;
const MCP_TABLE_KEY_SHARE = 0.8;
const MCP_TABLE_RE =
  /^mcp__.+__(get_file_problems|search_regex|search_in_files_by_text|search_in_files_by_regex|build_project|get_run_configurations|search_text)$/;

function isMcpTableTool(toolName) {
  return typeof toolName === "string" && MCP_TABLE_RE.test(toolName);
}

// JetBrains MCP payloads are usually a bare array of records, or an object
// wrapping one (`{results:[...]}`); a shallow (depth<=2) search covers both
// without guessing at every possible field name.
function findMcpRecordsArray(parsed, depth) {
  if (Array.isArray(parsed)) return parsed;
  if (depth >= 2 || !parsed || typeof parsed !== "object") return null;
  for (const key of Object.keys(parsed)) {
    const val = parsed[key];
    if (Array.isArray(val) && val.length >= MCP_TABLE_MIN_RECORDS) return val;
  }
  for (const key of Object.keys(parsed)) {
    const val = parsed[key];
    if (val && typeof val === "object" && !Array.isArray(val)) {
      const found = findMcpRecordsArray(val, depth + 1);
      if (found) return found;
    }
  }
  return null;
}

function isPlainObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

// Eligibility mirrors the probe exactly: >=2KB text, a JSON-parseable array
// of >=5 objects whose keys overlap (intersection/union) >=80%.
function mcpTableCandidate(text) {
  if (typeof text !== "string" || text.length < MCP_TABLE_MIN_CHARS) return null;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return null;
  }
  const records = findMcpRecordsArray(parsed, 0);
  if (!records || records.length < MCP_TABLE_MIN_RECORDS || !records.every(isPlainObject)) return null;
  const keySets = records.map((r) => new Set(Object.keys(r)));
  const union = new Set();
  keySets.forEach((s) => s.forEach((k) => union.add(k)));
  let intersection = new Set(keySets[0]);
  for (let i = 1; i < keySets.length; i++) {
    intersection = new Set([...intersection].filter((k) => keySets[i].has(k)));
  }
  if (!union.size || intersection.size / union.size < MCP_TABLE_KEY_SHARE) return null;
  return { records, columns: [...union] };
}

function tableCell(v) {
  if (v === undefined) return "";
  if (typeof v === "string") return v.replace(/[\t\n\r]+/g, " ");
  if (typeof v === "object") return JSON.stringify(v).replace(/[\t\n\r]+/g, " ");
  return String(v);
}

// Lossless: every record becomes a row, all values present, zero rows
// dropped. Only the column classification (constant vs variable) is derived;
// nothing is elided or summarized. The header is count-based, naming its own
// provenance, matching every other [hush hook: ...] marker in this file.
function renderMcpTable(records, columns) {
  const constantCols = [];
  const variableCols = [];
  for (const col of columns) {
    if (!records.length) {
      variableCols.push(col);
      continue;
    }
    const values = records.map((r) => JSON.stringify(r[col]));
    if (values.every((v) => v === values[0])) constantCols.push(col);
    else variableCols.push(col);
  }
  const out = [`[hush hook: ${records.length} MCP JSON records rendered as a schema table below.]`];
  if (records.length) {
    if (constantCols.length) out.push("constant: " + constantCols.map((c) => `${c}=${tableCell(records[0][c])}`).join(", "));
    out.push(variableCols.join("\t"));
    for (const r of records) out.push(variableCols.map((c) => tableCell(r[c])).join("\t"));
  }
  return out.join("\n");
}

// MCP tool_response is a bare array of content blocks (Part 2 fact #6), or
// occasionally a plain string; nothing else.
function extractMcpText(response) {
  if (typeof response === "string") return response;
  if (Array.isArray(response)) {
    const text = response
      .filter((b) => b && b.type === "text" && typeof b.text === "string")
      .map((b) => b.text)
      .join("\n");
    return text || null;
  }
  return null;
}

// `decision` mirrors compress()'s side-channel: mutated with the action token
// and byte counts, never affecting the return value.
function compressMcpTable(response, decision) {
  const text = extractMcpText(response);
  if (text === null) {
    if (decision) decision.action = "passthrough";
    return undefined;
  }
  if (decision) { decision.bytesIn = text.length; decision.bytesOut = text.length; }
  const candidate = mcpTableCandidate(text);
  if (!candidate) {
    if (decision) decision.action = "passthrough";
    return undefined;
  }
  const rendered = renderMcpTable(candidate.records, candidate.columns);
  if (rendered.length >= text.length) {
    if (decision) decision.action = "rejected-not-smaller";
    return undefined;
  }
  if (decision) { decision.action = "mcp-table"; decision.bytesOut = rendered.length; }
  // The replacement must be a plain string or that same bare content-block
  // array — an object wrapper ({content:[...]}) throws harness-side
  // (`e.reduce is not a function`, Part 2 fact #6). Mirror the arrival shape.
  return Array.isArray(response) ? [{ type: "text", text: rendered }] : rendered;
}

// JetBrains-style exec results arrive as one JSON blob {exitCode, output}
// with the whole run's console inside the output string. The wrapper is
// noise-free; the inner text is ordinary shell output, so it gets exactly the
// treatment shell output gets — exit-code-aware caps, dedupe, signal kept —
// and is re-embedded in the same JSON shape it arrived in.
const MCP_EXEC_RE = /^mcp__.+__(execute_run_configuration|execute_terminal_command)$/;

function isMcpExecTool(toolName) {
  return typeof toolName === "string" && MCP_EXEC_RE.test(toolName);
}

function compressMcpExec(response, decision) {
  const text = extractMcpText(response);
  if (text === null) {
    if (decision) decision.action = "passthrough";
    return undefined;
  }
  if (decision) { decision.bytesIn = text.length; decision.bytesOut = text.length; decision.action = "passthrough"; }
  if (text.length < MCP_TABLE_MIN_CHARS) return undefined;
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!isPlainObject(parsed) || typeof parsed.output !== "string") return undefined;
  const exitCode = typeof parsed.exitCode === "number" ? parsed.exitCode : undefined;
  const out = compress(parsed.output, exitCode, false, false, [], 1, null, true, false);
  if (out.length >= parsed.output.length) return undefined;
  const rendered = JSON.stringify({ ...parsed, output: out });
  if (rendered.length >= text.length) {
    if (decision) decision.action = "rejected-not-smaller";
    return undefined;
  }
  if (decision) { decision.action = "mcp-exec"; decision.bytesOut = rendered.length; }
  return Array.isArray(response) ? [{ type: "text", text: rendered }] : rendered;
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
// re-fire) and, like the meter's state files, left to OS temp cleaning.
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
const SIDECAR_DIR = path.join(os.tmpdir(), "hush-sidecar");
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
  { singular: "error", plural: "errors", re: /\w*Error\b|\bERR(?:OR)?\b/i },
  { singular: "failure", plural: "failures", re: /\bFAIL(?:URE|ED)?\b/i },
  { singular: "critical", plural: "criticals", re: /\bCRITICAL\b/i },
  { singular: "warning", plural: "warnings", re: /\w*Warning\b|\bWARN(?:ING)?\b/i },
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
  const lead = [...new Set([...signalIdx.slice(0, DIGEST_SIGNAL_SAMPLE), ...signalIdx.slice(-DIGEST_SIGNAL_SAMPLE)])];
  if (relevanceTokens && relevanceTokens.length) {
    const lower = lines.map((l) => l.toLowerCase());
    for (const tok of relevanceTokens) {
      const hits = [];
      for (let i = 0; i < lower.length; i++) if (lower[i].includes(tok)) hits.push(i);
      if (hits.length > 0 && hits.length <= RELEVANCE_COMMON) for (const i of hits) lead.push(i);
    }
  }
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
  return { body: out.join("\n"), total, nonBlank, signalCount: signalIdx.length, census };
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

function maybeSidecar(cleaned, relevanceTokens, sessionId, hostMayTruncate) {
  if (process.env.HUSH_SIDECAR === "off") return null;
  if (typeof cleaned !== "string" || cleaned.length < SIDECAR_MIN_CHARS) return null;
  // A shell output at/above the host-truncation size was likely already cut by
  // Claude Code (see SIDECAR_SHELL_MAX): step aside to the inline cap so hush
  // adds no truncated "full" file and no competing pointer.
  if (hostMayTruncate && cleaned.length >= SIDECAR_SHELL_MAX) return null;
  try {
    // Scan before ever touching disk. A scanner exception falls into the same
    // catch as every I/O failure below and returns null (fail-open for the
    // hook's output, but never a reason to persist ambiguous content).
    if (containsSecret(cleaned)) return null;
    const name = (sessionId ? `${String(sessionId).slice(0, 8)}-` : "") + `${cheapHash(cleaned)}.txt`;
    const file = path.join(SIDECAR_DIR, name);
    const d = buildSidecarDigest(cleaned, relevanceTokens);
    const header =
      `[hush hook: this output is ${d.nonBlank} non-empty lines (${d.census || "0 signal lines"}) ` +
      `and was saved in full to ${file.replace(/\\/g, "/")}; the digest below keeps the head, tail, ` +
      `every prompt-named line, and a sample of the signal lines, each with its L<n> line number. ` +
      `For anything else — including any total or count you report — Read that file with ` +
      `offset/limit around the L<n> numbers you need. ` +
      `If that file no longer exists, re-run the command instead.]`;
    const out = `${header}\n${d.body}`;
    // A near-line-free payload (e.g. one giant minified-JSON line) leaves
    // buildSidecarDigest's head/tail trim nothing to cut — the digest would
    // reproduce the whole input plus header overhead, larger than the source.
    // Bail before ever touching disk and let compress() fall through to the
    // ordinary inline cap, which is a no-op here too but at least isn't larger.
    if (out.length >= cleaned.length) return null;
    fs.mkdirSync(SIDECAR_DIR, { recursive: true });
    if (!fs.existsSync(file)) safeWriteFileSync(file, cleaned);
    return out;
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
function isSidecarPath(filePath) {
  return (
    typeof filePath === "string" &&
    path.resolve(path.dirname(filePath.trim())) === path.resolve(SIDECAR_DIR)
  );
}

// Claude Code's own large-output persistence writes the RAW result to
// .claude/projects/<slug>/<session>/tool-results/<id>.txt and hands the model
// a pointer. Reading that file back is the host-side twin of reading a hush
// sidecar — machine-persisted tool output, never user source — so it gets the
// same treatment: full reads capped with the generous failure-grade cap and
// every signal line kept; offset/limit range reads pass untouched. Both path
// segments are required so a project's own "tool-results" folder never matches.
const HOST_TOOLRESULTS_RE = /[\\/]\.claude[\\/]projects[\\/].+[\\/]tool-results[\\/][^\\/]+\.txt$/i;

function isHostToolResultsPath(filePath) {
  return (
    process.env.HUSH_TOOLRESULTS !== "off" &&
    typeof filePath === "string" &&
    HOST_TOOLRESULTS_RE.test(filePath.trim())
  );
}

// Re-read delta (ROADMAP 066b, corpus-probed): a watched Read path (log or
// generated — never source, see the isLogPath/isGeneratedPath callers below)
// whose content changed since this session last read it gets only the
// changed lines, plus any SIGNAL_RE lines, instead of the full view again. A
// local-transcript probe found 12.4% of full-file re-reads changed with no
// self-edit in between — real, if modest, volume; the sibling idea (a delta
// on a re-RUN command) measured under its own bar on the same corpus and was
// deliberately not built. State lives per session, keyed by the exact path
// string Read was given, and holds only cheap line hashes — never the file's
// actual content — so there is nothing here for the secrets guard to screen.
const DELTA_FORCE_FULL_EVERY = 3; // every Nth changed re-read of a path goes out full, not delta

function deltaStatePath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(os.tmpdir(), `hush-delta-${safe}.json`);
}

function readDeltaState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(deltaStatePath(sessionId), "utf-8"));
  } catch {
    return {};
  }
}

function writeDeltaState(sessionId, state) {
  try {
    safeWriteFileSync(deltaStatePath(sessionId), JSON.stringify(state));
  } catch {
    /* best effort — losing state just means the next re-read goes out full */
  }
}

// Edit/Write/MultiEdit on a path this session is tracking means the next
// content change is self-caused, not the external-change signal the delta
// targets — the corpus probe counted those separately and excluded them from
// the build target. Dropping the entry makes the next read a fresh baseline
// (full output, no diff), which is exactly the expected shape.
function invalidateDeltaPath(filePath, sessionId) {
  if (typeof filePath !== "string" || !filePath || !sessionId) return;
  const state = readDeltaState(sessionId);
  if (!(filePath in state)) return;
  delete state[filePath];
  writeDeltaState(sessionId, state);
}

function hashLines(text) {
  return text.split("\n").map(cheapHash);
}

// Index-position comparison — exact for the shapes this targets (a log
// appended to, or a generated file rewritten with mostly the same rows), not
// a general line-diff. A line inserted or removed mid-file shifts every
// later hash and the tail reads as "changed" too; that only makes the delta
// larger, never wrong, since every genuinely different line still shows.
function changedLineIndexes(prevHashes, hashes) {
  const out = [];
  const max = Math.max(prevHashes.length, hashes.length);
  for (let i = 0; i < max; i++) {
    if (prevHashes[i] !== hashes[i]) out.push(i);
  }
  return out;
}

function renderDelta(lines, changedIdx) {
  const total = lines.length;
  const signalIdx = [];
  lines.forEach((l, i) => {
    if (SIGNAL_RE.test(l)) signalIdx.push(i);
  });
  const shown = new Set([...changedIdx.filter((i) => i < total), ...signalIdx]);
  const sorted = [...shown].sort((a, b) => a - b);
  const out = [
    `[hush hook: this file changed since your last read of it this session — ${sorted.length} of ${total} ` +
      `lines shown below (the changed lines, plus any warnings/errors/failures); everything else is unchanged. ` +
      `Read it again without offset/limit for the full file.]`,
  ];
  let last = -1;
  for (const i of sorted) {
    if (i - last > 1) out.push(`  ... ${i - last - 1} unchanged lines ...`);
    out.push(`L${i + 1}: ${lines[i]}`);
    last = i;
  }
  if (total - 1 - last > 0) out.push(`  ... ${total - 1 - last} unchanged lines ...`);
  return out.join("\n");
}

// Returns the delta text, or null whenever the caller should fall through to
// the ordinary compress() view instead: delta turned off, no session to key
// state on, first read of this path this session (nothing to diff against
// yet), content identical to the last read, this is the forced-full Nth
// changed re-read, or the delta isn't actually smaller than the cleaned text
// it would replace (the same rejected-not-smaller discipline every other
// rewrite in this file follows). Fail-open: any state-file trouble falls
// through the same way.
function maybeDelta(cleaned, filePath, sessionId) {
  if (process.env.HUSH_DELTA === "off") return null;
  if (typeof filePath !== "string" || !filePath || !sessionId) return null;
  try {
    const state = readDeltaState(sessionId);
    const prev = state[filePath];
    const hashes = hashLines(cleaned);

    if (!prev) {
      state[filePath] = { hashes, rereads: 0 };
      writeDeltaState(sessionId, state);
      return null;
    }

    const changedIdx = changedLineIndexes(prev.hashes, hashes);
    if (!changedIdx.length) return null;

    const rereads = (prev.rereads || 0) + 1;
    if (rereads % DELTA_FORCE_FULL_EVERY === 0) {
      state[filePath] = { hashes, rereads: 0 };
      writeDeltaState(sessionId, state);
      return null;
    }

    const rendered = renderDelta(cleaned.split("\n"), changedIdx);
    state[filePath] = { hashes, rereads };
    writeDeltaState(sessionId, state);
    if (rendered.length >= cleaned.length) return null;
    return rendered;
  } catch {
    return null;
  }
}

// `decision`, when passed, is mutated with the single action token that
// classifies what this call actually did (see HUSH_DEBUG below) — purely an
// observation side-channel: the return value is identical whether or not a
// decision object is supplied.
function compress(text, exitCode, isDump, enumerate, relevanceTokens, scale, sessionId, noSidecar, hostMayTruncate, decision) {
  const original = String(text);
  const cleaned = resolveCarriageReturns(stripAnsi(original));
  if (!enumerate && !noSidecar) {
    const side = maybeSidecar(cleaned, relevanceTokens, sessionId, hostMayTruncate);
    if (side !== null) {
      if (decision) decision.action = "sidecar";
      return side;
    }
    // Sidecar was skipped specifically by the shell-truncation guard (large
    // enough to qualify, but the host may have already cut the tail) — note
    // that even though the output falls through to the ordinary cap below.
    if (decision && hostMayTruncate && cleaned.length >= SIDECAR_MIN_CHARS && cleaned.length >= SIDECAR_SHELL_MAX) {
      decision.action = "shell-guard-skip";
    }
  }
  const s = typeof scale === "number" ? scale : 1;
  const cap = enumerate
    ? CAP_ENUMERATE
    : isDump || looksLikeFailure(cleaned, exitCode)
      ? Math.max(FLOOR_FAIL, Math.round(CAP_FAIL * s))
      : Math.max(FLOOR_PASS, Math.round(CAP_PASS * s));
  // Enumeration carve-out means "nothing is elided" — same reason it skips the
  // sidecar above; collapsing same-shape runs would remove the very items a
  // completeness request ("list every compiled module") asked to see.
  let lines = dedupeConsecutive(cleaned.split("\n"));
  const dedupedLen = lines.length;
  if (!enumerate) lines = collapseTemplates(lines);
  const beforeCapLen = lines.length;
  lines = capLines(lines, cap, relevanceTokens);
  const out = lines.join("\n");
  if (decision && !decision.action) {
    if (beforeCapLen > cap) decision.action = "cap"; // capLines' own no-op guard is `length <= cap`
    else if (beforeCapLen < dedupedLen) decision.action = "template-collapse";
    else if (enumerate) decision.action = "enumerate-passthrough";
    else if (out === original) decision.action = "passthrough";
    else decision.action = "scrub-only"; // ansi/CR/dupe/exit-marker cleanup only
  }
  return out;
}

// HUSH_DEBUG=1 manifest: one JSON line per handled tool output, appended to
// tmpdir/hush-debug-<session_id>.jsonl. "Ran but kept the original" (cap
// no-op, rejected MCP table, untouched Read) is otherwise invisible to any
// harness measuring hush — this makes every decision, including the
// do-nothing ones, observable without changing what any path produces.
// Same sessionId sanitization as narration-meter.js's statePath.
function debugManifestPath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(os.tmpdir(), `hush-debug-${safe}.jsonl`);
}

function logDecision(entry, sessionId) {
  if (process.env.HUSH_DEBUG !== "1") return;
  try {
    const file = debugManifestPath(sessionId);
    // Same residual defense as claimSessionNote: refuse a pre-planted symlink
    // at the manifest path before appending to it. The lstat check alone
    // still leaves a TOCTOU gap between the check and the write — an
    // O_NOFOLLOW open closes it atomically on the platforms that honor the
    // flag (see safe-write.js's header for why win32 can't and the lstat
    // check is the accepted residual there).
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== "ENOENT") return;
    }
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === "number" ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | O_NOFOLLOW, 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(entry) + "\n");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* fail-open: the debug manifest is best-effort observability, never a
       reason to alter or block the actual compression decision. */
  }
}

// One line per multi-field object response (stdout/stderr/output combined)
// rather than one per field — priority order picks the most significant
// thing that happened across the fields that were actually processed.
const ACTION_PRIORITY = [
  "sidecar", "shell-guard-skip", "cap", "template-collapse",
  "mcp-table", "rejected-not-smaller", "enumerate-passthrough", "scrub-only", "passthrough",
];
function combineActions(actions) {
  for (const a of ACTION_PRIORITY) if (actions.includes(a)) return a;
  return actions[0];
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
// once-only state across unrelated runs. Like the meter's state files, the
// sentinel is left for OS temp cleaning.
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
  if (process.env.HUSH_DISABLE === "1") return;
  const data = readInput();

  if (isMcpTableTool(data.tool_name)) {
    const decision = {};
    const result = compressMcpTable(data.tool_response, decision);
    logDecision(
      { tool: data.tool_name, bytesIn: decision.bytesIn || 0, bytesOut: decision.bytesOut ?? decision.bytesIn ?? 0, action: decision.action || "passthrough" },
      data.session_id
    );
    return emit(result, data.session_id);
  }

  if (isMcpExecTool(data.tool_name) && process.env.HUSH_MCP_EXEC !== "off") {
    const decision = {};
    const result = compressMcpExec(data.tool_response, decision);
    logDecision(
      { tool: data.tool_name, bytesIn: decision.bytesIn || 0, bytesOut: decision.bytesOut ?? decision.bytesIn ?? 0, action: decision.action || "passthrough" },
      data.session_id
    );
    return emit(result, data.session_id);
  }

  if (EDIT_TOOLS.has(data.tool_name)) {
    invalidateDeltaPath(data.tool_input && data.tool_input.file_path, data.session_id);
    return; // Edit/Write/MultiEdit output is never compressed — this is a state side effect only
  }

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
    const file = response && typeof response === "object" ? response.file : undefined;
    const filePath = (data.tool_input && data.tool_input.file_path) || (file && file.filePath);
    const sideRead = isSidecarPath(filePath);
    // Only a full read (no offset/limit) is a valid delta candidate — a
    // ranged read covers a different slice of the file than whatever was
    // hashed last time, so there is nothing sound to diff it against. Mirrors
    // exactly the scope the corpus probe measured.
    const isRangeRead = !!(data.tool_input && (data.tool_input.offset !== undefined || data.tool_input.limit !== undefined));
    // Host tool-results files: only a FULL read gets the capped view. An
    // explicit offset/limit means the model is navigating to a specific slice
    // (often after the capped view's own marker invited it) — that slice must
    // come back verbatim or the follow-up loop never resolves.
    const hostRead = !isRangeRead && isHostToolResultsPath(filePath);
    if (file && typeof file.content === "string") {
      if (isLogPath(filePath) || isGeneratedPath(filePath) || sideRead || hostRead) {
        const decision = {};
        let out;
        if (!sideRead && !hostRead && !isRangeRead && !enumerate) {
          const cleaned = resolveCarriageReturns(stripAnsi(file.content));
          const delta = maybeDelta(cleaned, filePath, data.session_id);
          if (delta !== null) {
            decision.action = "delta";
            out = delta;
          }
        }
        if (out === undefined) {
          out = compress(file.content, undefined, true, enumerate, relevance, scale, data.session_id, sideRead || hostRead, undefined, decision);
        }
        logDecision({ tool: "Read", bytesIn: file.content.length, bytesOut: out.length, action: decision.action || "passthrough" }, data.session_id);
        if (out !== file.content) {
          updated = {
            ...response,
            file: { ...file, content: out, numLines: out.split("\n").length },
          };
        }
      } else {
        // Watched (Read is in WATCHED_TOOLS) but not a shape hush ever
        // touches — still a handled output, so it still gets one line.
        logDecision({ tool: "Read", bytesIn: file.content.length, bytesOut: file.content.length, action: "passthrough" }, data.session_id);
      }
    }
    return emit(updated, data.session_id);
  }

  if (data.tool_name === "Grep") {
    // Only content-mode results carry match text; files_with_matches and
    // count modes are already terse and pass whole. Context-flagged (-A/-B/-C)
    // and multiline searches asked for surrounding code — collapsing match
    // lines away from their context would orphan it, so those pass whole too.
    const content = response && typeof response === "object" && typeof response.content === "string" ? response.content : null;
    if (content === null) return;
    const ti = data.tool_input || {};
    const contextual =
      ti["-A"] !== undefined || ti["-B"] !== undefined || ti["-C"] !== undefined || ti.context !== undefined || ti.multiline === true;
    let out = content;
    if (process.env.HUSH_GREP !== "off" && !enumerate && !contextual && content.length >= GREP_MIN_CHARS) {
      const label =
        (typeof ti.path === "string" && ti.path) ||
        (response.filenames && response.filenames[0]) ||
        undefined;
      out = compressGrep(content, relevance, label);
    }
    logDecision(
      { tool: "Grep", bytesIn: content.length, bytesOut: out.length, action: out === content ? "passthrough" : "grep-collapse" },
      data.session_id
    );
    if (out !== content) {
      updated = { ...response, content: out, numLines: out.split("\n").length };
    }
    return emit(updated, data.session_id);
  }

  const isDump = isFileDump(firstLine(data.tool_input && data.tool_input.command));

  if (typeof response === "string") {
    const wrapped = extractWrappedExit(response);
    // null exitCode = a marker was found but malformed (no native exe ran,
    // so $LASTEXITCODE was never set) — still strip it, but compress() gets
    // undefined so looksLikeFailure falls back to sniffing cleanText, and no
    // untrustworthy "[hush: exit N]" note gets appended.
    const exitCode = wrapped ? wrapped.exitCode : undefined;
    const decision = {};
    let out = compress(wrapped ? wrapped.cleanText : response, exitCode ?? undefined, isDump, enumerate, relevance, scale, data.session_id, undefined, true, decision);
    if (wrapped && exitCode !== null) out += `\n[hush: exit ${exitCode}]`;
    logDecision({ tool: data.tool_name, bytesIn: response.length, bytesOut: out.length, action: decision.action || "passthrough" }, data.session_id);
    if (out !== response) updated = out;
  } else if (response && typeof response === "object") {
    const wrapped =
      extractWrappedExit(response.stdout) || extractWrappedExit(response.stderr) || extractWrappedExit(response.output);
    const exitCode = wrapped ? wrapped.exitCode : extractExitCode(response);
    const next = { ...response };
    let changed = false;
    let bytesIn = 0;
    let bytesOut = 0;
    const actions = [];
    for (const field of ["stdout", "stderr", "output"]) {
      if (typeof next[field] === "string") {
        bytesIn += next[field].length;
        const fieldWrapped = extractWrappedExit(next[field]);
        const decision = {};
        let out = compress(fieldWrapped ? fieldWrapped.cleanText : next[field], exitCode ?? undefined, isDump, enumerate, relevance, scale, data.session_id, undefined, true, decision);
        if (fieldWrapped && exitCode !== null) out += `\n[hush: exit ${exitCode}]`;
        actions.push(decision.action || "passthrough");
        bytesOut += out.length;
        if (out !== next[field]) {
          next[field] = out;
          changed = true;
        }
      }
    }
    if (actions.length) {
      logDecision({ tool: data.tool_name, bytesIn, bytesOut, action: combineActions(actions) }, data.session_id);
    }
    if (changed) updated = next;
  }

  emit(updated, data.session_id);
}

function emit(updated, sessionId) {
  if (updated === undefined) return; // nothing shrank — stay silent

  const hookSpecificOutput = {
    hookEventName: "PostToolUse",
    updatedToolOutput: updated,
  };
  if (process.env.HUSH_NOTE !== "off" && hasHushNote(updated) && claimSessionNote(sessionId)) {
    hookSpecificOutput.additionalContext = NOTE_TEXT;
  }

  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
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
  looksLikeFailure,
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
  NOTE_TEXT,
  isMcpTableTool,
  mcpTableCandidate,
  renderMcpTable,
  extractMcpText,
  compressMcpTable,
  isMcpExecTool,
  compressMcpExec,
  compressGrep,
  isHostToolResultsPath,
  debugManifestPath,
  containsSecret,
  deltaStatePath,
  readDeltaState,
  writeDeltaState,
  invalidateDeltaPath,
  changedLineIndexes,
  renderDelta,
  maybeDelta,
};
