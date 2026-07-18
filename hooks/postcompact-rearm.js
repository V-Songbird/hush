#!/usr/bin/env node
"use strict";

// PostCompact hook: re-arms the once-per-session marker-provenance note after
// compaction. compress-tool-output.js's note fires once per session, guarded
// by a sentinel file (hush-note-<session_id> in tmpdir) — but compaction
// summarizes the note away while the sentinel still says "delivered", so
// markers appearing after compaction arrive unexplained and risk being read
// as prompt injection. Deleting the sentinel here re-arms delivery on the
// next marker; deleting the meter's state file too is just cleanup (its
// turn-boundary anchors are stale post-compaction) — deletion re-arms both
// cleanly and is harmless if either file never existed. The re-read delta's
// state file is deleted for the same reason as the meter's: compaction
// destroys the referent — a line-hash baseline recorded against a summarized
// transcript no longer corresponds to what the model actually remembers
// reading, so the next read of any tracked path should go out full again.
//
// Emits nothing: re-injecting the note unconditionally on every compaction
// would spend tokens on sessions that never emit another marker. Silence is
// the design — the existing marker-triggered path re-delivers the note only
// when a marker is actually about to be shown.

const fs = require("fs");
const os = require("os");
const path = require("path");

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
    return null; // malformed — no-op
  }
}

// Matches narration-meter.js's statePath (and compress-tool-output.js's
// deltaStatePath) sanitization exactly, so this unlinks the same files those
// modules read/write.
function unlinkSentinels(sessionId) {
  const notePath = path.join(os.tmpdir(), `hush-note-${sessionId}`);
  const safe = String(sessionId).replace(/[^a-zA-Z0-9-]/g, "_");
  const meterPath = path.join(os.tmpdir(), `hush-meter-${safe}.json`);
  const deltaPath = path.join(os.tmpdir(), `hush-delta-${safe}.json`);
  for (const p of [notePath, meterPath, deltaPath]) {
    try {
      fs.unlinkSync(p);
    } catch {
      /* ENOENT fine; anything else is not worth breaking a session over */
    }
  }
}

function main() {
  try {
    if (process.env.HUSH_DISABLE === "1") return;
    const data = readInput();
    if (data === null) return; // malformed stdin
    if (typeof data.session_id !== "string" || !data.session_id) return;
    unlinkSentinels(data.session_id);
  } catch {
    /* fail-open: never break a session over re-arming a note */
  }
}

if (require.main === module) main();

module.exports = { readInput, unlinkSentinels };
