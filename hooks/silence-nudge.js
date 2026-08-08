#!/usr/bin/env node
"use strict";

// Re-states the silence rule from a hook channel, next to the text the model
// is about to write. The output style alone does not hold mid-turn silence on
// the larger models: style wording changes measured flat, while the same rule
// delivered here cut mid-turn narration by roughly 90%.
//
// Three levels, picked by HUSH_NUDGE — the default changed 2026-08-08, see
// why below:
//
//   (default)  One reminder, at the top of the turn, nothing mid-turn.
//   lean       The default's reminder, plus a second, shorter one on the
//              turn's first tool result only.
//   max        A reminder on every tool result (doubled), plus the one at
//              the top of the turn — what shipped as the only mode through
//              1.3.0.
//
// Why the default dropped the mid-turn reminder: a reminder injected mid-turn
// does not survive a session resume byte-stably — every resume re-writes
// several thousand cached tokens at cache-write prices, no matter which hook
// fires it or how short it is. Measured on six long engineering fixtures
// (Sonnet, 2026-08-08, n=12 per arm across several batches): `max` cost
// 14-45% over no plugin at all, driven almost entirely by that mid-turn
// channel; the no-mid-turn design lands anywhere from a little cheaper than
// no plugin to a modest premium, for most of the same quiet. `lean` sits
// between the two: a real, measured improvement in quiet over the default,
// at a real, not-free extra cost — never as cheap as the default, never as
// quiet as `max`. Every combination tried to beat that trade (folding the
// mid-turn reminder into the turn-opener, moving it to PreToolUse, riding it
// inside a tool-output rewrite instead of a separate block, repeating the
// turn-opener's own text) traded one axis for the other or landed flat — see
// the plugin's own research notes for the fuller account.
//
// Positive-forward wording only, at every level. Naming the unwanted
// behavior primes it — a clause that describes narrating produces narrating.

const fs = require("node:fs");
const path = require("node:path");
const { quietOff, OFF_TOKEN } = require("./lib/gate");
const { sessionDir } = require("./lib/sidecar-store");

const nudgeEnv = String(process.env.HUSH_NUDGE || "").trim();
const OFF = OFF_TOKEN.test(nudgeEnv);
const MAX_MODE = /^max$/i.test(nudgeEnv);
const LEAN_MODE = /^lean$/i.test(nudgeEnv);

// max's own wording. Paired with a step reminder present, "until the work is
// done" measured BETTER than the closed-boundary text below — the two texts
// are proven in their own configuration only, not interchangeable.
const TURN =
  "hush: this turn is silent until the work is done. Everything you learn goes in the final message.";
const STEP =
  "hush: your next output is a tool call. The final message is the only place you explain anything.";
const TOOL = `${STEP} ${STEP}`;

// The default's and lean's shared turn text. Closes a boundary TURN leaves
// open: "until the work is done" let the model call the work done and
// announce a verification step out loud, mid-turn, right before running it.
// Measured cutting leaks roughly in half against TURN in the one
// configuration this text is used in — no step reminder present.
const TURN_DIAL =
  "hush: this turn is silent until the final message. Everything you learn goes in the final message.";

// lean's own mid-turn text: the step rule's own first sentence, alone,
// stated once rather than never.
const TERSE = "hush: your next output is a tool call.";

// lean's per-turn cap: the counter lives beside the session's other scratch,
// so the existing sweep clears it. Fail-open in every direction — an
// unwritable counter just means the reminder fires every time.
function counterFile(sessionId) {
  return path.join(sessionDir(sessionId), "nudge-count");
}
function resetLeanCap(sessionId) {
  try {
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    fs.writeFileSync(counterFile(sessionId), "0");
  } catch { /* fail open */ }
}
function withinLeanCap(sessionId) {
  try {
    const f = counterFile(sessionId);
    let n = 0;
    try { n = Number(fs.readFileSync(f, "utf8")) || 0; } catch { n = 0; }
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(n + 1));
    return n < 1;
  } catch {
    return true;
  }
}

// Pure text selection for a given event under the current mode. Returns null
// for "nothing to say here" — the default's mid-turn case, and lean's once
// its per-turn cap is spent — which main() treats as silence, not a fallback.
function nudgeFor(event) {
  if (event === "UserPromptSubmit") return MAX_MODE ? TURN : TURN_DIAL;
  if (MAX_MODE) return TOOL;
  if (LEAN_MODE) return TERSE;
  return null;
}

function main() {
  if (quietOff()) return;
  if (OFF) return;
  let raw = "";
  process.stdin.on("data", (d) => {
    raw += d;
  });
  process.stdin.on("end", () => {
    let input = {};
    try {
      input = JSON.parse(raw || "{}");
    } catch {
      // A malformed payload is not a reason to drop the reminder; the event
      // name is the only field used and PostToolUse is the common case.
    }
    const event = input.hook_event_name === "UserPromptSubmit" ? "UserPromptSubmit" : "PostToolUse";
    if (event === "UserPromptSubmit" && LEAN_MODE) resetLeanCap(input.session_id);
    if (event === "PostToolUse" && LEAN_MODE && !withinLeanCap(input.session_id)) return;

    const text = nudgeFor(event);
    if (text === null) return;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: text,
        },
      })
    );
  });
}

if (require.main === module) main();

module.exports = { nudgeFor, TURN, STEP, TOOL, TURN_DIAL, TERSE };
