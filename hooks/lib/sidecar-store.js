'use strict';

// Where sidecar files live, who owns them, and when they go away. One module
// because four call sites need the same answer: compress-tool-output.js writes
// them, precompact-summary.js lists this session's, session-end-cleanup.js
// removes them, and isSidecarPath decides whether a Read of one is a read of
// machine-persisted tool output.
//
// Layout: tmpdir/hush-sidecar/<session>/<content-hash>.txt — the directory IS
// the registration. A flat shared directory made ownership a filename prefix
// and, since files are content-addressed and an existing file is never
// rewritten, let two sessions silently share one file: whoever's cleanup ran
// first pulled the recovery location out from under the other. Per-session
// directories cost duplicated bytes when two sessions produce identical output
// and buy back a namespace that can be deleted whole.
//
// Retention is session-scoped: SessionEnd deletes this session's directory.
// Anything left behind by a crash is caught by the age-graced sweep, which
// only ever touches entries untouched for STALE_MS — a live concurrent
// session's directory has a fresh mtime (creating a file inside updates it),
// so a sweep from another session's end can't take it.
//
// Every function here is fail-open: a missing directory is a no-op, and no
// failure is worth raising into a hook.

const fs = require('fs');
const os = require('os');
const path = require('path');

const SIDECAR_ROOT = path.join(os.tmpdir(), 'hush-sidecar');

// Crash leftovers are only distinguishable from live files by age. A day is
// long enough that no plausible session loses a file it still points at.
const STALE_MS = 24 * 60 * 60 * 1000;

// Same sessionId sanitization as narration-meter.js's statePath — the id
// becomes a single path segment, so anything that isn't [A-Za-z0-9-] (path
// separators and traversal included) is flattened to an underscore.
function sessionDir(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(SIDECAR_ROOT, safe);
}

// True for any file under the sidecar root at any depth: a session directory
// today, a stale flat-scheme leftover from an older run just the same.
function isSidecarPath(filePath) {
  if (typeof filePath !== 'string') return false;
  const resolved = path.resolve(filePath.trim());
  const root = path.resolve(SIDECAR_ROOT) + path.sep;
  return resolved.startsWith(root);
}

// SessionEnd trigger: the session's whole namespace goes, partial `.tmp`
// writes from an interrupted safe-write included. Returns true when there was
// something there.
function removeSession(sessionId) {
  const dir = sessionDir(sessionId);
  try {
    if (!fs.existsSync(dir)) return false;
    fs.rmSync(dir, { recursive: true, force: true });
    return true;
  } catch {
    return false; // fail-open: cleanup never breaks a session
  }
}

// Crash trigger: a session that never reached SessionEnd leaves its directory
// behind. Sweeps every root entry — directory or loose file — whose mtime is
// older than the grace, and returns how many it removed.
//
// razor: mtime on the directory is the liveness signal, which a session that
// wrote no sidecar for a full day would fail. Upgrade path if that ever
// matters: a heartbeat file the compress hook touches per write.
function sweepStale(maxAgeMs, now) {
  const cutoff = (typeof now === 'number' ? now : Date.now()) - (typeof maxAgeMs === 'number' ? maxAgeMs : STALE_MS);
  let entries;
  try {
    entries = fs.readdirSync(SIDECAR_ROOT);
  } catch {
    return 0; // no root yet (or unreadable) — nothing to sweep
  }
  let removed = 0;
  for (const name of entries) {
    const full = path.join(SIDECAR_ROOT, name);
    try {
      if (fs.statSync(full).mtimeMs >= cutoff) continue;
      fs.rmSync(full, { recursive: true, force: true });
      removed++;
    } catch {
      /* vanished under us, or not ours to remove — either way, skip it */
    }
  }
  return removed;
}

module.exports = { SIDECAR_ROOT, STALE_MS, sessionDir, isSidecarPath, removeSession, sweepStale };
