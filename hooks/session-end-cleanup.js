#!/usr/bin/env node
"use strict";

// SessionEnd hook: sidecar files are session-scoped, so this is where they go.
// The session's own directory is deleted outright; anything a crashed session
// left behind is caught by the age-graced sweep, which never touches a
// directory a live session has written to recently.
//
// Deletion happens only at session end, never at compaction: the PreCompact
// summary hands the model those exact paths, and a within-session compaction
// must leave every one of them readable.
//
// Emits nothing — cleanup is a side effect, and SessionEnd output has nowhere
// to land. Always exits 0: a session that is already over must not be handed
// an error, and a sidecar left on disk costs nothing but temp space.

const { removeSession, sweepStale } = require("./lib/sidecar-store");
const { coreOff } = require("./lib/gate");

function readInput() {
  let raw;
  try {
    raw = require("fs").readFileSync(0, "utf-8");
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

function main() {
  try {
    if (coreOff()) return;
    const data = readInput();
    if (data === null) return; // malformed stdin
    if (typeof data.session_id === "string" && data.session_id) removeSession(data.session_id);
    sweepStale();
  } catch {
    /* fail-open: never break a session over cleanup */
  }
}

if (require.main === module) main();

module.exports = { readInput };
