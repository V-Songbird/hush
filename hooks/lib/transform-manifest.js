'use strict';

// One record shape for every Core transform, and the trust boundary that goes
// with it: a view that shows less than it was given must name where the rest
// is recoverable from.
//
// Every transform in compress-tool-output.js reports through buildRecord, so
// the accounting is written once instead of per call site: identity (tool +
// action), input and output size, preserved and omitted line counts, recovery
// location, session ownership, retention state, and the reason a transform
// declined. Records are METADATA ONLY — counts, paths, tokens. No line of the
// output, no file content, ever lands in a record; the same rule the sidecar's
// secret screen and the delta's hash-only state already follow.
//
// The record is built and checked on EVERY handled tool output, gate or no
// gate: recoveryGap is a correctness check on what gets emitted, so it cannot
// depend on an env var. Only the on-disk manifest append stays behind
// HUSH_DEBUG=1 — no measured I/O cost check has been run on always-on manifest
// writing (see scripts/stats.js's header), so persisting stays opt-in.

const fs = require('fs');
const os = require('os');
const path = require('path');

// The action taxonomy. `lossy` means the view this action produces can leave
// input lines out of itself, which is exactly the set recoveryGap polices;
// `fallback` is the standing reason for the actions that exist because a
// transform declined.
//
// scrub-only and enumerate-passthrough are in the lossy set on purpose: both
// still collapse runs of identical lines behind a "repeated Nx" marker, and a
// line stated as a count is a line not in the view.
const ACTIONS = {
  sidecar: { lossy: true },
  cap: { lossy: true },
  'template-collapse': { lossy: true },
  delta: { lossy: true },
  'grep-collapse': { lossy: true },
  'mcp-exec': { lossy: true },
  'scrub-only': { lossy: true },
  'enumerate-passthrough': { lossy: true },
  // The two that keep every input line by construction: mcp-table renders
  // every record as a row, and passthrough returns the input unchanged.
  'mcp-table': { lossy: false },
  passthrough: { lossy: false },
  'shell-guard-skip': { lossy: false, fallback: 'shell output may already be truncated by the host' },
  'rejected-not-smaller': { lossy: false, fallback: 'rewrite was not smaller than the input' },
  'rejected-no-recovery': { lossy: false, fallback: 'transform removed detail without a recovery location' },
};

// One line per multi-field object response (stdout/stderr/output combined)
// rather than one per field — priority order picks the most significant thing
// that happened across the fields that were actually processed. Only the
// actions a shell field can produce appear here; combineActions falls back to
// the first reported action for anything else.
const ACTION_PRIORITY = [
  'sidecar', 'shell-guard-skip', 'cap', 'template-collapse',
  'mcp-table', 'rejected-not-smaller', 'enumerate-passthrough', 'scrub-only', 'passthrough',
];

function combineActions(actions) {
  for (const a of ACTION_PRIORITY) if (actions.includes(a)) return a;
  return actions[0];
}

// Normalizes what a transform reported into the one shape every consumer can
// rely on. `preserved` is derived rather than reported: a transform knows how
// many input lines it dropped, and the rest were kept verbatim.
function buildRecord(d) {
  const action = d.action || 'passthrough';
  const spec = ACTIONS[action] || {};
  const bytesIn = d.bytesIn || 0;
  const linesIn = d.linesIn || 0;
  const omitted = Math.max(0, Math.min(d.omitted || 0, linesIn));
  return {
    tool: d.tool || null,
    action,
    session: d.session || null,
    bytesIn,
    bytesOut: typeof d.bytesOut === 'number' ? d.bytesOut : bytesIn,
    linesIn,
    preserved: linesIn - omitted,
    omitted,
    recovery: d.recovery || null,
    recoveryPath: d.recoveryPath || null,
    // "session": the file lives in a directory the naming session owns and is
    // deleted when that session ends (see hooks/lib/sidecar-store.js).
    // "none": nothing was persisted, so nothing has to be cleaned up.
    retention: d.retention || 'none',
    fallback: d.fallback || spec.fallback || null,
    // True when this tool call read back output hush had already parked — the
    // one number that says whether a recovery location was ever used. Always
    // present, so a consumer can tell a record that measured it from an older
    // one that never did.
    retrieval: d.retrieval === true,
  };
}

// The trust boundary: transformed output is never emitted without matching
// recovery metadata when detail was removed. Returns the reason a record fails
// that, or null when it holds. A lossy action that happened to drop nothing
// this time (a cap under its own limit) has nothing to recover and passes.
function recoveryGap(record) {
  const spec = ACTIONS[record.action];
  if (!spec || !spec.lossy || record.omitted <= 0) return null;
  if (!record.recovery) return `${record.action} omitted ${record.omitted} lines with no recovery location`;
  if ((record.recovery === 'sidecar' || record.recovery === 'source-file') && !record.recoveryPath) {
    return `${record.action} names ${record.recovery} recovery with no path`;
  }
  return null;
}

// Same sessionId sanitization as narration-meter.js's statePath.
function debugManifestPath(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9-]/g, '_');
  return path.join(os.tmpdir(), `hush-debug-${safe}.jsonl`);
}

// HUSH_DEBUG=1: append the record as one JSON line to
// tmpdir/hush-debug-<session_id>.jsonl. "Ran but kept the original" (cap
// no-op, rejected MCP table, untouched Read) is otherwise invisible to any
// harness measuring hush — this makes every decision, including the do-nothing
// ones, observable without changing what any path produces.
function appendRecord(record) {
  if (process.env.HUSH_DEBUG !== '1') return;
  try {
    const file = debugManifestPath(record.session);
    // Same residual defense as claimSessionNote: refuse a pre-planted symlink
    // at the manifest path before appending to it. The lstat check alone still
    // leaves a TOCTOU gap between the check and the write — an O_NOFOLLOW open
    // closes it atomically on the platforms that honor the flag (see
    // safe-write.js's header for why win32 can't and the lstat check is the
    // accepted residual there).
    try {
      if (fs.lstatSync(file).isSymbolicLink()) return;
    } catch (e) {
      if (e.code !== 'ENOENT') return;
    }
    const O_NOFOLLOW = typeof fs.constants.O_NOFOLLOW === 'number' ? fs.constants.O_NOFOLLOW : 0;
    const fd = fs.openSync(file, fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_APPEND | O_NOFOLLOW, 0o600);
    try {
      fs.writeSync(fd, JSON.stringify(record) + '\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    /* fail-open: the manifest file is best-effort observability, never a
       reason to alter or block the actual compression decision. */
  }
}

module.exports = { ACTIONS, ACTION_PRIORITY, combineActions, buildRecord, recoveryGap, debugManifestPath, appendRecord };
