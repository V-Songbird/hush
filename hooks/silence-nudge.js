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

const OFF = /^(0|off|false)$/i.test(process.env.HUSH_NUDGE || "");

const TURN =
  "hush: this turn is silent until the work is done. Everything you learn goes in the final message.";
const STEP =
  "hush: your next output is a tool call. The final message is the only place you explain anything.";
const TOOL = `${STEP} ${STEP}`;

function nudgeFor(event) {
  return event === "UserPromptSubmit" ? TURN : TOOL;
}

function main() {
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

module.exports = { nudgeFor, TURN, STEP, TOOL };
