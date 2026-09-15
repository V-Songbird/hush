#!/usr/bin/env node
"use strict";

// PostCompact hook: re-arms the once-per-session marker-provenance note after
// compaction. compress-tool-output.js's note fires once per session, guarded
// by a sentinel file (hush-note-<session_id> in tmpdir) — but compaction
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
const os = require("os");
const path = require("path");
const { coreOff } = require("./lib/gate");

// Re-arming is deletion, and deletion is total: the note sentinel is dropped
// so the next compaction can claim it again, never carried forward as still
// live. Nothing here re-arms per entry, and nothing here trusts state content.
//
// The one thing worth verifying is the target: session_id arrives from stdin
// and the note sentinel embeds it raw (claimSessionNote does the same), so a
// traversal-shaped id would resolve outside the temp directory. Anything that
// does not resolve inside tmpdir is not a file hush wrote, and hush does not
// delete it.
function insideTmp(p) {
  const root = path.resolve(os.tmpdir()) + path.sep;
  return path.resolve(p).startsWith(root);
}

function unlinkSentinels(sessionId) {
  const notePath = path.join(os.tmpdir(), `hush-note-${sessionId}`);
  if (!insideTmp(notePath)) return;
  try {
    fs.unlinkSync(notePath);
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

module.exports = { readInput, unlinkSentinels, insideTmp };
