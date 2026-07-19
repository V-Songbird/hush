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
// Honesty adjustment: never claim credit for overhead hush itself created. A
// manifest line's bytesOut is measured AFTER any hush marker text is
// written into it, so per-decision savings are already net of everything
// that decision itself added. The one overhead NOT captured by any single
// decision is the session-wide NOTE_TEXT note (additionalContext, injected
// at most once per session, outside any tool result body) — its own
// sentinel file (claimSessionNote in compress-tool-output.js) says whether
// it actually fired, so that's read directly rather than guessed at.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { debugManifestPath, NOTE_TEXT } = require("../hooks/compress-tool-output");

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
    .map((r) => ({ ...r, bytesSaved: r.bytesIn - r.bytesOut }))
    .sort((a, b) => b.bytesSaved - a.bytesSaved);
}

function summarizeSession(sessionId) {
  const entries = readManifest(sessionId);
  if (entries === null) return { sessionId, manifestFound: false };

  const byAction = rollupByAction(entries);
  const rawBytesIn = byAction.reduce((n, r) => n + r.bytesIn, 0);
  const rawBytesOut = byAction.reduce((n, r) => n + r.bytesOut, 0);
  const rawSaved = rawBytesIn - rawBytesOut;
  const noteOverhead = noteOverheadFor(sessionId);
  const netSaved = Math.max(0, rawSaved - noteOverhead);

  return {
    sessionId,
    manifestFound: true,
    decisions: entries.length,
    byAction,
    rawBytesIn,
    rawBytesOut,
    rawSaved,
    noteOverhead,
    netSaved,
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
    out.push(`Decisions logged: ${s.decisions}`);
    for (const row of s.byAction) {
      out.push(`  ${row.action}: ${row.count}x, ${formatBytes(row.bytesIn)} -> ${formatBytes(row.bytesOut)} (saved ${formatBytes(row.bytesSaved)})`);
    }
    out.push(`Raw savings: ${formatBytes(s.rawSaved)} (${formatBytes(s.rawBytesIn)} -> ${formatBytes(s.rawBytesOut)})`);
    if (s.noteOverhead > 0) {
      out.push(`Session note overhead (hush's own one-time injected note): -${formatBytes(s.noteOverhead)}`);
    }
    out.push(`Net savings: ${formatBytes(s.netSaved)}`);
  }
  if (report.usageByModel === null) {
    out.push("No transcript found — per-model token breakdown unavailable.");
  } else if (report.usageByModel.length === 0) {
    out.push("Transcript found but no usable usage records yet.");
  } else {
    out.push("Per-model token usage (deduped by message id):");
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
};
