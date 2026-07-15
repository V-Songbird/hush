#!/usr/bin/env node
"use strict";

// PreCompact hook: shapes the compaction summarizer's own instructions — the
// one recurring payload hush's PostToolUse compression can never touch,
// since a summary replaces prior messages and is re-sent on every later API
// call. Claude Code builds these instructions from this hook's RAW STDOUT
// (trimmed, space-joined across all PreCompact hooks), not from
// hookSpecificOutput JSON — so this prints plain text only, and always
// exits 0 even on failure (fail-open: a hush crash must never break a
// session, especially not at the one moment a summary is about to replace
// the conversation).
//
// Two blocks, both format-shaping only — never information-dropping:
// (a) a static directive: structured list, preserve every path/identifier/
//     decision/error verbatim, drop narration and tool-output restatement.
// (b) only when this session has hush-sidecar files on disk: their paths,
//     named as provably recallable (re-running the command regenerates
//     them), so the summary can drop their content without losing anything.

const fs = require("fs");
const os = require("os");
const path = require("path");

const SIDECAR_DIR = path.join(os.tmpdir(), "hush-sidecar");
const SIDECAR_CAP = 20;

const STATIC_BLOCK =
  "Summary format: a compact structured list, not prose. Preserve verbatim every file path, " +
  "identifier, command, version number, error message, decision, and open thread — losing one " +
  "forces re-exploration that costs more than the summary saves. Drop narration, pleasantries, " +
  "step-by-step retellings, and content restated from tool outputs. One fact per line.";

function readInput() {
  let raw;
  try {
    raw = fs.readFileSync(0, "utf-8");
  } catch {
    return {};
  }
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null; // malformed — caller stays silent
  }
}

// This session's sidecar files only (sess8 prefix match), forward-slashed,
// capped — or null when there's nothing to point at.
function buildSidecarBlock(sessionId) {
  if (typeof sessionId !== "string" || !sessionId) return null;
  const sess8 = sessionId.slice(0, 8);
  let files;
  try {
    files = fs.readdirSync(SIDECAR_DIR);
  } catch {
    return null;
  }
  const paths = files
    .filter((f) => f.startsWith(`${sess8}-`) && f.endsWith(".txt"))
    .slice(0, SIDECAR_CAP)
    .map((f) => path.join(SIDECAR_DIR, f).replace(/\\/g, "/"));
  if (!paths.length) return null;
  return (
    `Full tool outputs from this session are preserved on disk (shown in-conversation only as ` +
    `digests): ${paths.join(", ")}. Keep these paths in the summary; do not reproduce their ` +
    `content. If a file is missing later, re-running the producing command regenerates the data.`
  );
}

function main() {
  try {
    if (process.env.HUSH_DISABLE === "1") return;
    if (process.env.HUSH_COMPACT === "off") return;
    const data = readInput();
    if (data === null) return; // malformed stdin

    const blocks = [STATIC_BLOCK];
    const sidecarBlock = buildSidecarBlock(data.session_id);
    if (sidecarBlock) blocks.push(sidecarBlock);
    process.stdout.write(blocks.join("\n\n"));
  } catch {
    /* fail-open: never break a session over a summary hint */
  }
}

if (require.main === module) main();

module.exports = { STATIC_BLOCK, buildSidecarBlock, readInput, SIDECAR_DIR, SIDECAR_CAP };
