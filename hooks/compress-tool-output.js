#!/usr/bin/env node
"use strict";

// PostToolUse hook: mechanically shrinks Bash/PowerShell output — and Read
// results for log-shaped files — before they enter context. Deterministic
// text transforms only — no heuristic ever touches failure detail: failing
// runs get a much larger cap and everything kept is verbatim.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { lastUserPromptText } = require("./lib/transcript");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell", "Read"]);

// Caps are in lines. Passing output is mostly noise (install trees, progress
// logs); failing output is evidence, so it keeps ~4x more.
const CAP_PASS = intEnv("HUSH_CAP_PASS", 60);
const CAP_FAIL = intEnv("HUSH_CAP_FAIL", 250);
// Enumeration carve-out cap (see requestsEnumeration). Large enough that a
// normal noisy build/log passes whole — no omission markers at all — so a model
// asked to report EVERY item has nothing elided to distrust. Still bounded, so
// a pathological megaline dump can't blow context.
const CAP_ENUMERATE = intEnv("HUSH_CAP_ENUMERATE", 2000);

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

// Lines that look like they carry the task's actual signal (warnings, errors,
// deprecations) survive the cap regardless of position — only surrounding
// noise (progress logs, install trees) gets cut. A blind head+tail slice was
// caught clipping build warnings out of a passing run, which then made the
// agent re-run the command hunting for what it couldn't see — the cap
// destroying signal cost more tool calls than the cap ever saved. Deliberately
// broad regex: over-matching just keeps a few extra lines, never worse.
const SIGNAL_RE = /\b(WARN(?:ING)?|ERR(?:OR)?|FAIL(?:URE|ED)?|DEPRECATED|CRITICAL)\b/i;

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
const SIDECAR_DIR = path.join(os.tmpdir(), "hush-sidecar");
const DIGEST_HEAD = 20;
const DIGEST_TAIL = 15;
const DIGEST_SIGNAL_SAMPLE = 10; // first N + last N signal lines

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
  const keep = new Set();
  for (let i = 0; i < Math.min(DIGEST_HEAD, total); i++) keep.add(i);
  for (let i = Math.max(0, total - DIGEST_TAIL); i < total; i++) keep.add(i);
  const signalIdx = [];
  lines.forEach((l, i) => {
    if (SIGNAL_RE.test(l)) signalIdx.push(i);
  });
  for (const i of signalIdx.slice(0, DIGEST_SIGNAL_SAMPLE)) keep.add(i);
  for (const i of signalIdx.slice(-DIGEST_SIGNAL_SAMPLE)) keep.add(i);
  if (relevanceTokens && relevanceTokens.length) {
    const lower = lines.map((l) => l.toLowerCase());
    for (const tok of relevanceTokens) {
      const hits = [];
      for (let i = 0; i < lower.length; i++) if (lower[i].includes(tok)) hits.push(i);
      if (hits.length > 0 && hits.length <= RELEVANCE_COMMON) for (const i of hits) keep.add(i);
    }
  }
  const sorted = [...keep].sort((a, b) => a - b);
  const out = [];
  let last = -1;
  for (const i of sorted) {
    if (i - last > 1) out.push(`  ... ${i - last - 1} lines in the file only ...`);
    out.push(`L${i + 1}: ${lines[i]}`);
    last = i;
  }
  return { body: out.join("\n"), total, signalCount: signalIdx.length };
}

function maybeSidecar(cleaned, relevanceTokens, sessionId) {
  if (process.env.HUSH_SIDECAR === "off") return null;
  if (typeof cleaned !== "string" || cleaned.length < SIDECAR_MIN_CHARS) return null;
  try {
    fs.mkdirSync(SIDECAR_DIR, { recursive: true });
    const name = (sessionId ? `${String(sessionId).slice(0, 8)}-` : "") + `${cheapHash(cleaned)}.txt`;
    const file = path.join(SIDECAR_DIR, name);
    if (!fs.existsSync(file)) fs.writeFileSync(file, cleaned);
    const d = buildSidecarDigest(cleaned, relevanceTokens);
    const header =
      `[hush hook: this output is ${d.total} lines (${d.signalCount} with warnings/errors/failures) ` +
      `and was saved in full to ${file.replace(/\\/g, "/")}; the digest below keeps the head, tail, ` +
      `every prompt-named line, and a sample of the signal lines, each with its L<n> line number. ` +
      `For anything else, Read that file with offset/limit around the L<n> numbers you need.]`;
    return `${header}\n${d.body}`;
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

function compress(text, exitCode, isDump, enumerate, relevanceTokens, scale, sessionId, noSidecar) {
  const cleaned = resolveCarriageReturns(stripAnsi(String(text)));
  if (!enumerate && !noSidecar) {
    const side = maybeSidecar(cleaned, relevanceTokens, sessionId);
    if (side !== null) return side;
  }
  const s = typeof scale === "number" ? scale : 1;
  const cap = enumerate
    ? CAP_ENUMERATE
    : isDump || looksLikeFailure(cleaned, exitCode)
      ? Math.max(FLOOR_FAIL, Math.round(CAP_FAIL * s))
      : Math.max(FLOOR_PASS, Math.round(CAP_PASS * s));
  const lines = capLines(dedupeConsecutive(cleaned.split("\n")), cap, relevanceTokens);
  return lines.join("\n");
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
    fs.writeFileSync(path.join(tmpDir || os.tmpdir(), `hush-note-${sessionId}`), "", { flag: "wx" });
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
    if (file && typeof file.content === "string" && (isLogPath(filePath) || isGeneratedPath(filePath) || sideRead)) {
      const out = compress(file.content, undefined, true, enumerate, relevance, scale, data.session_id, sideRead);
      if (out !== file.content) {
        updated = {
          ...response,
          file: { ...file, content: out, numLines: out.split("\n").length },
        };
      }
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
    let out = compress(wrapped ? wrapped.cleanText : response, exitCode ?? undefined, isDump, enumerate, relevance, scale, data.session_id);
    if (wrapped && exitCode !== null) out += `\n[hush: exit ${exitCode}]`;
    if (out !== response) updated = out;
  } else if (response && typeof response === "object") {
    const wrapped =
      extractWrappedExit(response.stdout) || extractWrappedExit(response.stderr) || extractWrappedExit(response.output);
    const exitCode = wrapped ? wrapped.exitCode : extractExitCode(response);
    const next = { ...response };
    let changed = false;
    for (const field of ["stdout", "stderr", "output"]) {
      if (typeof next[field] === "string") {
        const fieldWrapped = extractWrappedExit(next[field]);
        let out = compress(fieldWrapped ? fieldWrapped.cleanText : next[field], exitCode ?? undefined, isDump, enumerate, relevance, scale, data.session_id);
        if (fieldWrapped && exitCode !== null) out += `\n[hush: exit ${exitCode}]`;
        if (out !== next[field]) {
          next[field] = out;
          changed = true;
        }
      }
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
  resolveCarriageReturns,
  dedupeConsecutive,
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
};
