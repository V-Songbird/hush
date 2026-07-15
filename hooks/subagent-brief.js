#!/usr/bin/env node
"use strict";

// SubagentStart hook: extend hush's report discipline to subagents.
//
// The output style never reaches a subagent — styles ride the main loop's
// system prompt — so Task/Agent-spawned workers run hush-unaware and pad
// their final messages with preamble and restated instructions. That padding
// is pure context tax on the PARENT: a subagent's final message lands in the
// main conversation and is re-sent with every later API call in the session.
// One short injected line per spawn buys that back for the whole session.
//
// Injected into EVERY subagent, no agent-type gating: razor skips read-only
// agents because its code ladder is dead weight there, but a report is
// exactly what a read-only agent produces — the discipline applies most.

const fs = require("fs");

const BRIEF =
  "Your final message is consumed by the calling agent as a tool result, not read as chat: " +
  "return the findings themselves — data, paths, identifiers, verbatim errors — in complete " +
  "clauses, with no preamble, no restating of your instructions, and no offers of further help. " +
  "Emit no text between tool calls either: nobody reads it, so a progress update has no audience. " +
  "Chain the calls and put everything in that one final message.";

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf-8") || "{}");
  } catch {
    return {};
  }
}

function main() {
  if (process.env.HUSH_DISABLE === "1") return;
  if (process.env.HUSH_SUBAGENT === "off") return;
  readInput(); // consume stdin per hook contract; no per-agent gating needed
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "SubagentStart",
        additionalContext: BRIEF,
      },
    })
  );
}

if (require.main === module) main();

module.exports = { BRIEF };
