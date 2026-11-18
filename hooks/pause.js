#!/usr/bin/env node
"use strict";

// The session's pause switch. A prompt that is exactly "hush off" parks the
// voice until "hush on": an output style cannot be switched off mid-session,
// so while the pause holds, every turn carries PAUSED. A turn outside a pause
// gets nothing from this hook. The trims belong to Core and keep running;
// HUSH_DISABLE and HUSH_CORE are the switches for those. The flag sits with
// the session's other scratch, so it survives a compaction and session-end
// cleanup clears it.
//
// HUSH_QUIET=off stops this hook with the rest of the Quiet surface, so
// `hush off` then does nothing.
//
// This file once also re-stated a silence rule on every turn and after
// mid-turn text. A 144-session batch on claude-sonnet-5-5 (2026-11-17) found
// no measured effect of that request, and it was removed with its
// HUSH_NUDGE switch. No batch measured the removal on a larger model.

const fs = require("node:fs");
const path = require("node:path");
const { quietOff } = require("./lib/gate");
const { sessionDir } = require("./lib/sidecar-store");
const { readInputAsync, emitContext } = require("./lib/harness");

const PAUSE_OFF = /^\s*\/?(?:hush\s+off|stop\s+hush)\s*[.!]?\s*$/i;
const PAUSE_ON = /^\s*\/?hush\s+on\s*[.!]?\s*$/i;
const PAUSED =
  "hush: the user paused Hush for this session with `hush off`. Until they send `hush on`, write the way you would with no output style: its rules on length and layout do not apply. A blocker, a failed check, an unverified claim and a pending approval still get said.";
const PAUSE_ACK = " This prompt is the switch itself: confirm in one line that Hush is paused and that `hush on` brings it back.";
const RESUMED =
  "hush: the user just sent `hush on`, so the Hush output style applies again from this turn. Confirm in one line that Hush is back.";

function pauseFile(sessionId) {
  return path.join(sessionDir(sessionId), "paused");
}
function isPaused(sessionId) {
  try {
    return fs.existsSync(pauseFile(sessionId));
  } catch {
    return false;
  }
}
// Returns "off", "on" or null for a prompt, and moves the flag to match.
// Fail-open: when the flag cannot be written the pause does not take.
function applyPause(sessionId, prompt) {
  if (typeof prompt !== "string") return null;
  try {
    if (PAUSE_OFF.test(prompt)) {
      fs.mkdirSync(sessionDir(sessionId), { recursive: true });
      fs.writeFileSync(pauseFile(sessionId), "1");
      return "off";
    }
    if (PAUSE_ON.test(prompt)) {
      const was = isPaused(sessionId);
      fs.rmSync(pauseFile(sessionId), { force: true });
      return was ? "on" : null;
    }
  } catch { /* fail open */ }
  return null;
}

function main() {
  if (quietOff()) return;
  readInputAsync((input) => {
    if (input.hook_event_name !== "UserPromptSubmit") return;
    const moved = applyPause(input.session_id, input.prompt);
    if (isPaused(input.session_id)) emitContext("UserPromptSubmit", moved === "off" ? PAUSED + PAUSE_ACK : PAUSED);
    else if (moved === "on") emitContext("UserPromptSubmit", RESUMED);
  });
}

if (require.main === module) main();

module.exports = { PAUSED, RESUMED, isPaused };
