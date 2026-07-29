#!/usr/bin/env node
"use strict";

// Backs the /hush:stats skill. Reads two things hush already writes and
// never previously surfaced to the user:
//   - the HUSH_DEBUG=1 per-decision manifest (hush-debug-<session>.jsonl,
//     see compress-tool-output.js) — one line per tool output hush looked
//     at, including do-nothing decisions.
//   - the session transcript's own `message.usage` records, for a per-model
//     token picture alongside the byte savings.
//
// HUSH_DEBUG defaults OFF (see README's Settings table) and this script
// never turns it on — it only reads whatever manifest already exists. No
// measured I/O cost check has been run on always-on manifest writing, so
// that stays opt-in; a session with the flag never set has nothing to
// report, and this script says so plainly instead of printing all-zero
// numbers that would read as "hush saved nothing."
//
// This is an activity report, not a savings claim. Every number it prints is
// something the runtime observed: bytes in and out of each transform, how many
// outputs got smaller, how many transforms declined, how much was parked into
// recovery files, how often parked output was read back. What hush's absence
// would have cost is not observable — there is no second, hush-free run of the
// session — so no such figure is printed, estimated, or implied. Anything the
// records cannot answer is labelled unavailable instead of filled in with a
// zero, and records written before a field existed are treated the same way.
//
// Overhead is reported, never netted away. A manifest line's bytesOut is
// measured AFTER any hush marker text is written into it, so the byte deltas
// already carry what each decision added. The one addition NOT captured by any
// decision is the session-wide NOTE_TEXT note (additionalContext, injected at
// most once per session, outside any tool result body) — its own sentinel file
// (claimSessionNote in compress-tool-output.js) says whether it actually
// fired, so that's read directly rather than guessed at, and it is stated on
// its own line rather than subtracted from anything.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { debugManifestPath } = require("../hooks/lib/transform-manifest");
const { NOTE_TEXT } = require("../hooks/compress-tool-output");

const DEFAULT_PROJECTS_DIR = path.join(os.homedir(), ".claude", "projects");

// --- manifest -------------------------------------------------------------

function readManifest(sessionId) {
  let lines;
  try {
    lines = fs.readFileSync(debugManifestPath(sessionId), "utf-8").trim().split("\n").filter(Boolean);
  } catch {
    return null; // no manifest file at all — distinct from "manifest with zero lines"
  }
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip a malformed line (partial write) rather than fail the whole report */
    }
  }
  return entries;
}

function noteOverheadFor(sessionId) {
  const sentinel = path.join(os.tmpdir(), `hush-note-${sessionId}`);
  return fs.existsSync(sentinel) ? NOTE_TEXT.length : 0;
}

function rollupByAction(entries) {
  const byAction = new Map();
  for (const e of entries) {
    const action = e.action || "unknown";
    if (!byAction.has(action)) byAction.set(action, { action, count: 0, bytesIn: 0, bytesOut: 0 });
    const row = byAction.get(action);
    row.count++;
    row.bytesIn += e.bytesIn || 0;
    row.bytesOut += e.bytesOut || 0;
  }
  return [...byAction.values()]
    .map((r) => ({ ...r, bytesDelta: r.bytesOut - r.bytesIn }))
    .sort((a, b) => a.bytesDelta - b.bytesDelta);
}

function summarizeSession(sessionId) {
  const entries = readManifest(sessionId);
  if (entries === null) return { sessionId, manifestFound: false };

  const byAction = rollupByAction(entries);
  const bytesIn = byAction.reduce((n, r) => n + r.bytesIn, 0);
  const bytesOut = byAction.reduce((n, r) => n + r.bytesOut, 0);

  let smaller = 0;
  let unchanged = 0;
  let larger = 0;
  let fallbacks = 0;
  let recoveryWrites = 0;
  let recoveryBytes = 0;
  // null, not 0: a manifest whose records predate retrieval tracking cannot
  // answer this, and "0 retrievals" would be an answer.
  let retrievals = null;
  // How many records could answer it at all — below `decisions` means the
  // count covers part of the session, which the report has to say.
  let retrievalMeasured = 0;
  for (const e of entries) {
    const bi = e.bytesIn || 0;
    const bo = typeof e.bytesOut === "number" ? e.bytesOut : bi;
    if (bo < bi) smaller++;
    else if (bo > bi) larger++;
    else unchanged++;
    if (e.fallback) fallbacks++;
    if (e.retention === "session") {
      recoveryWrites++;
      recoveryBytes += bi;
    }
    if ("retrieval" in e) {
      if (retrievals === null) retrievals = 0;
      retrievalMeasured++;
      if (e.retrieval) retrievals++;
    }
  }

  return {
    sessionId,
    manifestFound: true,
    decisions: entries.length,
    byAction,
    bytesIn,
    bytesOut,
    bytesDelta: bytesOut - bytesIn,
    smaller,
    unchanged,
    larger,
    fallbacks,
    recoveryWrites,
    // Upper bound, not a measurement: a parked copy is the cleaned input, which
    // is never larger than the input the record counted.
    recoveryBytesAtMost: recoveryBytes,
    retrievals,
    retrievalMeasured,
    noteBytes: noteOverheadFor(sessionId),
  };
}

// --- transcript usage -------------------------------------------------------

// Claude Code emits the SAME usage totals on every streamed content block of
// one assistant message (confirmed against real transcripts: a message with
// 4 content-block lines carries 4 IDENTICAL usage records) — summing raw
// records overcounts tokens by up to ~4x. Dedup by message.id before adding
// anything to a total.
function extractUsageByModel(transcriptPath) {
  let lines;
  try {
    lines = fs.readFileSync(transcriptPath, "utf-8").split("\n");
  } catch {
    return null;
  }
  const seenIds = new Set();
  const byModel = new Map();
  for (const line of lines) {
    if (!line.trim()) continue;
    let rec;
    try {
      rec = JSON.parse(line);
    } catch {
      continue;
    }
    if (rec.type !== "assistant" || !rec.message || !rec.message.usage) continue;
    const id = rec.message.id;
    if (id) {
      if (seenIds.has(id)) continue;
      seenIds.add(id);
    }
    const u = rec.message.usage;
    const model = rec.message.model || "unknown";
    if (!byModel.has(model)) {
      byModel.set(model, { model, apiCalls: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheCreationTokens: 0 });
    }
    const row = byModel.get(model);
    row.apiCalls++;
    row.inputTokens += u.input_tokens || 0;
    row.outputTokens += u.output_tokens || 0;
    row.cacheReadTokens += u.cache_read_input_tokens || 0;
    row.cacheCreationTokens += u.cache_creation_input_tokens || 0;
  }
  return [...byModel.values()];
}

// --- session/transcript discovery ------------------------------------------

// Bounded head-read: only the fallback scan below needs a transcript's first
// line, and transcripts run to tens of MB — never read one whole just to
// check its cwd.
function firstLineOf(file) {
  const fd = fs.openSync(file, "r");
  try {
    const buf = Buffer.alloc(4096);
    const bytes = fs.readSync(fd, buf, 0, buf.length, 0);
    const text = buf.toString("utf-8", 0, bytes);
    const nl = text.indexOf("\n");
    return nl === -1 ? text : text.slice(0, nl);
  } finally {
    fs.closeSync(fd);
  }
}

function slugifyCwd(cwd) {
  return cwd.replace(/[^a-zA-Z0-9-]/g, "-");
}

// Claude Code's own cwd->directory slug isn't a rule hush owns, so the guess
// above is verified against disk, not trusted blind: if it doesn't exist,
// fall back to scanning every project dir's first transcript line for a
// literal cwd match (the same ground truth the ROADMAP 063 corpus probe
// used) instead of silently reporting nothing.
function findProjectDir(cwd, projectsDir) {
  const guess = path.join(projectsDir, slugifyCwd(cwd));
  if (fs.existsSync(guess)) return guess;
  let dirs;
  try {
    dirs = fs.readdirSync(projectsDir);
  } catch {
    return null;
  }
  for (const d of dirs) {
    const full = path.join(projectsDir, d);
    let files;
    try {
      files = fs.readdirSync(full).filter((f) => f.endsWith(".jsonl"));
    } catch {
      continue;
    }
    for (const f of files) {
      let rec;
      try {
        rec = JSON.parse(firstLineOf(path.join(full, f)));
      } catch {
        continue;
      }
      if (rec.cwd === cwd) return full;
    }
  }
  return null;
}

function latestTranscript(projectDir) {
  let files;
  try {
    files = fs.readdirSync(projectDir).filter((f) => f.endsWith(".jsonl"));
  } catch {
    return null;
  }
  let best = null;
  for (const f of files) {
    const full = path.join(projectDir, f);
    let stat;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    if (!best || stat.mtimeMs > best.mtimeMs) best = { full, mtimeMs: stat.mtimeMs };
  }
  return best ? best.full : null;
}

function sessionIdFromTranscriptPath(transcriptPath) {
  // win32 basename splits on both / and \, so Windows transcript paths parse anywhere
  return path.win32.basename(transcriptPath, ".jsonl");
}

// Resolves {sessionId, transcriptPath} from explicit flags, or by finding
// the most-recently-modified transcript for the given cwd. transcriptPath
// may be null (no transcript found) even when sessionId is known.
function resolveTarget({ session, transcript, cwd, projectsDir }) {
  projectsDir = projectsDir || DEFAULT_PROJECTS_DIR;
  if (transcript) {
    return { sessionId: session || sessionIdFromTranscriptPath(transcript), transcriptPath: transcript };
  }
  if (session) {
    // Cheap filename probe across project dirs — no file content read.
    let dirs;
    try {
      dirs = fs.readdirSync(projectsDir);
    } catch {
      dirs = [];
    }
    for (const d of dirs) {
      const candidate = path.join(projectsDir, d, `${session}.jsonl`);
      if (fs.existsSync(candidate)) return { sessionId: session, transcriptPath: candidate };
    }
    return { sessionId: session, transcriptPath: null };
  }
  const targetCwd = cwd || process.cwd();
  const projectDir = findProjectDir(targetCwd, projectsDir);
  if (!projectDir) return { sessionId: null, transcriptPath: null };
  const transcriptPath = latestTranscript(projectDir);
  if (!transcriptPath) return { sessionId: null, transcriptPath: null };
  return { sessionId: sessionIdFromTranscriptPath(transcriptPath), transcriptPath };
}

// --- report -----------------------------------------------------------------

function formatBytes(n) {
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)}KB`;
  return `${(n / (1024 * 1024)).toFixed(1)}MB`;
}

// Signed, because a transform that made an output bigger has to read as bigger.
function formatDelta(n) {
  if (n === 0) return "0B";
  return `${n < 0 ? "-" : "+"}${formatBytes(Math.abs(n))}`;
}

function buildReport(target) {
  const { sessionId, transcriptPath } = target;
  if (!sessionId) {
    return { ok: false, reason: "no-session", message: "Could not find a session transcript for this directory. Pass --session <id> or --transcript <path>." };
  }
  const session = summarizeSession(sessionId);
  const usageByModel = transcriptPath ? extractUsageByModel(transcriptPath) : null;
  return { ok: true, sessionId, transcriptPath, session, usageByModel };
}

function renderText(report) {
  if (!report.ok) return report.message;
  const out = [];
  out.push(`Session: ${report.sessionId}`);
  if (!report.session.manifestFound) {
    out.push(
      "No HUSH_DEBUG manifest found for this session — set HUSH_DEBUG=1 before the work you want measured, then run this again. Nothing below is a savings claim without it."
    );
  } else if (report.session.decisions === 0) {
    out.push("Manifest found but empty — hush hasn't handled a tool output yet this session.");
  } else {
    const s = report.session;
    out.push(`Tool outputs handled: ${s.decisions}`);
    for (const row of s.byAction) {
      out.push(`  ${row.action}: ${row.count}x, ${formatBytes(row.bytesIn)} -> ${formatBytes(row.bytesOut)} (${formatDelta(row.bytesDelta)})`);
    }
    out.push(`Observed bytes: ${formatBytes(s.bytesIn)} in -> ${formatBytes(s.bytesOut)} out (${formatDelta(s.bytesDelta)})`);
    out.push(`Outputs made smaller: ${s.smaller}; returned unchanged: ${s.unchanged}; made larger: ${s.larger}`);
    // Not "left the output alone": a declined step can sit beside another that
    // did shrink the same output (the shell guard standing down while the
    // inline cap still ran), so this says only that a step declined.
    out.push(`Transform steps that declined: ${s.fallbacks}`);
    if (s.recoveryWrites > 0) {
      out.push(
        `Parked into recovery files: ${s.recoveryWrites} output(s), at most ${formatBytes(s.recoveryBytesAtMost)} on disk (the parked copy is never larger than the input)`
      );
    } else {
      out.push("Parked into recovery files: none this session");
    }
    if (s.retrievals === null) {
      out.push("Parked output read back: unavailable — these records predate retrieval tracking");
    } else if (s.retrievalMeasured < s.decisions) {
      // Mixed manifest: older records can't answer, so a bare count would read
      // as covering the whole session.
      out.push(`Parked output read back: ${s.retrievals} time(s), counted over the ${s.retrievalMeasured} outputs that measured it`);
    } else {
      out.push(`Parked output read back: ${s.retrievals} time(s)`);
    }
    if (s.noteBytes > 0) {
      out.push(`Text hush added outside tool output: ${formatBytes(s.noteBytes)} (its one-time session note)`);
    }
    out.push("Not measurable: what this session would have cost without hush — there is no hush-free run of it to compare against.");
  }
  if (report.usageByModel === null) {
    out.push("No transcript found — per-model token breakdown unavailable.");
  } else if (report.usageByModel.length === 0) {
    out.push("Transcript found but no usable usage records yet.");
  } else {
    out.push("Per-model token usage for the whole session, deduped by message id (what the models used, not what hush changed):");
    for (const m of report.usageByModel) {
      out.push(
        `  ${m.model}: ${m.apiCalls} calls, in ${m.inputTokens}, out ${m.outputTokens}, cache-read ${m.cacheReadTokens}, cache-write ${m.cacheCreationTokens}`
      );
    }
  }
  return out.join("\n");
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--session") out.session = argv[++i];
    else if (a === "--transcript") out.transcript = argv[++i];
    else if (a === "--cwd") out.cwd = argv[++i];
    else if (a === "--json") out.json = true;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const target = resolveTarget(args);
  const report = buildReport(target);
  if (args.json) {
    process.stdout.write(JSON.stringify(report, null, 2) + "\n");
  } else {
    console.log(renderText(report));
  }
  process.exit(report.ok ? 0 : 1);
}

if (require.main === module) main();

module.exports = {
  readManifest,
  noteOverheadFor,
  rollupByAction,
  summarizeSession,
  extractUsageByModel,
  slugifyCwd,
  findProjectDir,
  latestTranscript,
  sessionIdFromTranscriptPath,
  resolveTarget,
  buildReport,
  renderText,
  formatBytes,
  formatDelta,
};
