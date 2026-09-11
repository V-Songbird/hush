#!/usr/bin/env node
"use strict";

// PostCompact hook: re-arms the once-per-session marker-provenance note after
// compaction. compress-tool-output.js's note fires once per session, guarded
// by a sentinel file (hush-note in the session's sidecar directory) — but compaction
// summarizes the note away while the sentinel still says "delivered", so
// markers appearing after compaction arrive unexplained and risk being read
// as prompt injection. Deleting the sentinel re-arms delivery on the next
// marker, and is harmless if the file never existed.
//
// Emits nothing: re-injecting the note unconditionally on every compaction
// would spend tokens on sessions that never emit another marker. Silence is
// the design — the existing marker-triggered path re-delivers the note only
// when a marker is actually about to be shown.

const { readInputOrNull: readInput } = require("./lib/harness");
const fs = require("fs");
const { notePath } = require("./lib/sidecar-store");
const { coreOff } = require("./lib/gate");

// Re-arming is deletion, and deletion is total: the note sentinel is dropped
// so the next compaction can claim it again, never carried forward as still
// live. Nothing here re-arms per entry, and nothing here trusts state content.
//
// session_id arrives from stdin raw; sidecar-store's sessionDir flattens it to
// one path segment, so the sentinel path cannot leave the sidecar root — a
// traversal-shaped id names a directory hush owns, never someone else's file.
function unlinkSentinels(sessionId) {
  try {
    fs.unlinkSync(notePath(sessionId));
  } catch {
    /* ENOENT fine; anything else is not worth breaking a session over */
  }
}

function main() {
  try {
    if (coreOff()) return;
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
