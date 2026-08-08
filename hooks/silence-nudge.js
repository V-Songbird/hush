#!/usr/bin/env node
"use strict";

// Re-states the silence rule from a hook channel, next to the text the model
// is about to write. The output style alone does not hold mid-turn silence on
// the larger models: style wording changes measured flat, while the same rule
// delivered here cut mid-turn narration by roughly 90%.
//
// Two placements, both needed:
//   UserPromptSubmit — once, at the top of the turn
//   PostToolUse      — on every tool result, which is where a diagnosis line
//                      gets written (its own assistant message, between the
//                      tool result and the edit that follows)
//
// The PostToolUse line is stated twice on purpose. Once left a residual leak;
// twice roughly halved it; three times measured worse than twice.
//
// Positive-forward wording only. Naming the unwanted behavior primes it — a
// clause that describes narrating produces narrating.

const { quietOff, OFF_TOKEN } = require("./lib/gate");

const OFF = OFF_TOKEN.test(process.env.HUSH_NUDGE || "");

// `HUSH_NUDGE=turn` keeps the turn reminder and drops the per-tool-result one.
// It exists because the step reminder has a hidden price on resumed sessions:
// a mid-turn additionalContext block (PostToolUse and PreToolUse alike) does
// not survive a session resume byte-stably, so every resume re-writes ~5-12k
// cached tokens at cache-write prices. Measured on six long engineering tasks
// (Sonnet, n=12 per arm, 2026-08-08): default cost +14-45% over no plugin with
// 9-10 of 12 runs fully silent; the dial lands within cost noise of no plugin
// at 9 of 12 with its own wording (TURN_DIAL below) — against 1-3 of 12 with
// no plugin at all. Folding the step rule into the turn reminder instead was
// measured worse on every axis, so the dial is the whole design:
// silence-first by default, `turn` when spend matters more.
const TURN_ONLY = /^turn$/i.test(String(process.env.HUSH_NUDGE || "").trim());

const TURN =
  "hush: this turn is silent until the work is done. Everything you learn goes in the final message.";
const STEP =
  "hush: your next output is a tool call. The final message is the only place you explain anything.";
const TOOL = `${STEP} ${STEP}`;

// The turn-only dial carries its own wording. TURN's "until the work is done"
// leaves a loophole the leaks walked through: the model finishes the edits,
// calls the work done, and announces the verification step out loud. Closing
// the boundary — silent until the final message — was measured against the
// dial's own wording on the six long fixtures (48 runs, Sonnet, 2026-08-08):
// leaks fell 13 to 8 and mid-turn transition announcements 6 to 2, at the
// same cost band. Two independent phrasings of the closed boundary measured
// identically, so the minimal edit of the proven line ships. Scoped to the
// dial: the default mode's TURN pairs with the step reminder and was not
// re-measured with this text.
const TURN_DIAL =
  "hush: this turn is silent until the final message. Everything you learn goes in the final message.";

function nudgeFor(event) {
  if (event === "UserPromptSubmit") return TURN_ONLY ? TURN_DIAL : TURN;
  return TOOL;
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
    if (event === "PostToolUse" && TURN_ONLY) return;
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: event,
          additionalContext: nudgeFor(event),
        },
      })
    );
  });
}

if (require.main === module) main();

module.exports = { nudgeFor, TURN, STEP, TOOL, TURN_DIAL };
