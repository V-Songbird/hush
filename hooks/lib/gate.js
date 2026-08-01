"use strict";

// The one place a hook asks whether it is allowed to run.
//
// Three switches, evaluated in this order:
//   HUSH_DISABLE=1   product-wide runtime off; beats everything
//   HUSH_CORE=off    Core surface off — tool-output compression, exit-code
//                    preservation, the compaction note and its re-arm, and
//                    session-end cleanup
//   HUSH_QUIET=off   Quiet surface off — the turn nudge and the subagent brief
//
// A surface switch beats every per-hook flag inside that surface, so
// HUSH_NUDGE=1 cannot resurrect a Quiet that is off. Per-hook flags still
// decide their own hook while the surface is on.
//
// Both surfaces default on: an unset variable is on, and only the off tokens
// below turn one off, matching the per-hook flags' convention.

const OFF_TOKEN = /^(0|off|false)$/i;

function surfaceOff(surface) {
  if (process.env.HUSH_DISABLE === "1") return true;
  return OFF_TOKEN.test(process.env[`HUSH_${surface}`] || "");
}

/** True when the Core surface must do nothing at all this run. */
const coreOff = () => surfaceOff("CORE");

/** True when the Quiet surface must do nothing at all this run. */
const quietOff = () => surfaceOff("QUIET");

module.exports = { coreOff, quietOff, OFF_TOKEN };
