'use strict';

// Where sidecar files live, who owns them, and when they go away. One module
// because four call sites need the same answer: compress-tool-output.js writes
// them, precompact-summary.js lists this session's, session-end-cleanup.js
// removes them, and isSidecarPath decides whether a Read of one is a read of
// machine-persisted tool output.
//
// Layout: tmpdir/hush-sidecar/<session>/<content-hash>.txt — the directory IS
// the registration. One non-.txt file shares the directory: saved.json, the
// session's running compression total (see addSaved below). A flat shared directory made ownership a filename prefix
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
const { safeWriteFileSync } = require('./safe-write');

const SIDECAR_ROOT = path.join(os.tmpdir(), 'hush-sidecar');

// Crash leftovers are only distinguishable from live files by age. A day is
// long enough that no plausible session loses a file it still points at.
const STALE_MS = 24 * 60 * 60 * 1000;

// The sessionId sanitization the sidecar tree uses — the id becomes a
// single path segment, so anything that isn't [A-Za-z0-9-] (path
// separators and traversal included) is flattened to an underscore.
// win32 folds the case: `ABCD1234` and `abcd1234` are one directory on NTFS,
// so distinct-case ids have to resolve to the same name here too — otherwise a
// cleanup for one id deletes the other's live files.
function sessionDir(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(SIDECAR_ROOT, process.platform === 'win32' ? safe.toLowerCase() : safe);
}

// True for any file under the sidecar root at any depth: a session directory
// today, a stale flat-scheme leftover from an older run just the same.
// win32 folds the case here for the same reason sessionDir does: the path
// arrives from the model, which may have retyped or lowercased what the digest
// printed, and NTFS calls that the same file. A case-only mismatch used to read
// as "not a sidecar", and a full Read of one then passed through uncompressed --
// the whole parked output straight back into context, which is the one thing
// this predicate exists to prevent.
function isSidecarPath(filePath) {
  if (typeof filePath !== 'string') return false;
  const fold = (p) => (process.platform === 'win32' ? p.toLowerCase() : p);
  const resolved = fold(path.resolve(filePath.trim()));
  const root = fold(path.resolve(SIDECAR_ROOT) + path.sep);
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
// mtime on the directory is the liveness signal, which a session that wrote
// no sidecar for a full day would fail.
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

// The session's running compression total, as a statusline can read it:
// tmpdir/hush-sidecar/<session>/saved.json holding {"in":N,"out":M} — characters
// that arrived from tools against characters actually delivered to the model.
// Claude Code has one statusline slot and hush does not take it; this file is
// how a user's own script shows the number instead.
//
// It lives in the session directory because it has exactly the sidecar
// lifetime: removeSession takes it with the parked copies, and the stale sweep
// catches it after a crash. Named .json so precompact-summary's .txt filter
// never offers it to the summarizer as a recovery file.
function savedPath(sessionId) {
  return path.join(sessionDir(sessionId), 'saved.json');
}

// Adds one tool call's before/after sizes to the total. Read-modify-write on
// every handled tool output, measured at ~0.45ms against the ~60ms node start
// each hook fire already pays, so it runs unconditionally rather than behind a
// flag of its own; HUSH_CORE=off stops it with the rest of the surface.
//
// Fail-open, and deliberately not locked: two hook fires racing on parallel
// tool calls can lose one update, which costs a slightly low statusline and
// nothing else. A session-less call is skipped — a shared 'unknown' file would
// mix unrelated runs and no session would ever clean it up.
function addSaved(sessionId, bytesIn, bytesOut) {
  if (typeof sessionId !== 'string' || !sessionId) return false;
  if (!(bytesIn > 0)) return false;
  const file = savedPath(sessionId);
  try {
    let total = {};
    try {
      total = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      /* absent, partial or hand-edited: the total restarts rather than throwing */
    }
    if (!total || typeof total !== 'object') total = {};
    safeWriteFileSync(file, JSON.stringify({
      in: (Number(total.in) || 0) + bytesIn,
      out: (Number(total.out) || 0) + (Number(bytesOut) || 0),
    }));
    return true;
  } catch {
    return false; // fail-open: a statusline number never breaks a session
  }
}

module.exports = { SIDECAR_ROOT, sessionDir, isSidecarPath, removeSession, sweepStale, savedPath, addSaved };
