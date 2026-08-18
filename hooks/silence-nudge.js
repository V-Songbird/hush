#!/usr/bin/env node
"use strict";

// Re-states the silence rule from a hook channel, next to the text the model
// is about to write. The output style alone does not hold mid-turn silence on
// the larger models: style wording changes measured flat, while the same rule
// delivered here cut mid-turn narration by roughly 90%.
//
// Two levels, picked by HUSH_NUDGE — the default changed 2026-08-11:
//
//   (default)  One reminder at the top of the turn, plus a corrective one
//              fired ONLY when the transcript shows a new mid-turn assistant
//              text block this turn. A turn that stays silent gets nothing
//              mid-turn at all.
//   max        A reminder on every tool result (doubled), plus the one at
//              the top of the turn — what shipped as the only mode through
//              1.3.0.
//
// Why the default reminds reactively instead of on every tool result: a
// reminder injected mid-turn does not survive a session resume byte-stably —
// every resume re-writes several thousand cached tokens at cache-write
// prices, no matter which hook fires it or how short it is. Reminding on
// every tool result (`max`) cost 14-45% over no plugin on six long
// engineering fixtures (Sonnet, 2026-08-08, n=12 per arm across several
// batches). The reactive default pays that tax only in the sessions that
// actually slip: measured across three independent batches (2026-08-11), it
// came in cheaper than even the no-mid-turn design every time, with equal or
// fewer mid-turn leaks — the corrective lands with maximum recency, right
// where a turn-top reminder has decayed. Older values `turn`, `lean`, and
// `react` are accepted as synonyms for the default, so nothing anyone set
// ever breaks.
//
// Positive-forward wording only, at every level. Naming the unwanted
// behavior primes it — a clause that describes narrating produces narrating.

const fs = require("node:fs");
const path = require("node:path");
const { quietOff, OFF_TOKEN } = require("./lib/gate");
const { sessionDir } = require("./lib/sidecar-store");
const { readTailLines, isRealUserPrompt } = require("./lib/transcript");

const nudgeEnv = String(process.env.HUSH_NUDGE || "").trim();
const OFF = OFF_TOKEN.test(nudgeEnv);
const MAX_MODE = /^max$/i.test(nudgeEnv);

// max's own wording. Paired with a step reminder present, "until the work is
// done" measured BETTER than the closed-boundary text below — the two texts
// are proven in their own configuration only, not interchangeable.
const TURN =
  "hush: this turn is silent until the work is done. Everything you learn goes in the final message.";
const STEP =
  "hush: your next output is a tool call. The final message is the only place you explain anything.";
const TOOL = `${STEP} ${STEP}`;

// The default's turn text. Closes a boundary TURN leaves open: "until the
// work is done" let the model call the work done and announce a verification
// step out loud, mid-turn, right before running it. Measured cutting leaks
// roughly in half against TURN in the configuration this text is used in —
// no standing step reminder present.
const TURN_DIAL =
  "hush: this turn is silent until the final message. Everything you learn goes in the final message.";

// The default's corrective state: how many mid-turn text blocks have already
// been answered with a reminder this turn. Lives beside the session's other
// scratch, so Core's session-end cleanup clears it; with Core off nothing
// reaps it and it is left for OS temp cleaning. Fail-open in the cheap
// direction — an unreadable transcript or counter means no injection.
function reactFile(sessionId) {
  return path.join(sessionDir(sessionId), "react-count");
}
function resetReact(sessionId) {
  try {
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    fs.writeFileSync(reactFile(sessionId), "0");
  } catch { /* fail open */ }
}
// Count assistant text blocks since the last real human prompt — mid-turn
// text, because the turn's own final message cannot exist yet while a
// PostToolUse hook is firing. Fail-SILENT on any trouble: no count means no
// injection, which is the cheap direction.
function countMidTurnText(transcriptPath) {
  let lines;
  try {
    lines = readTailLines(transcriptPath);
  } catch {
    return 0;
  }
  let count = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (isRealUserPrompt(e)) break;
    if (e.type !== "assistant" || e.isSidechain) continue;
    const c = e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) count++;
    }
  }
  return count;
}
// Fires at most once per NEW text block: the reminder lands right after the
// block that earned it, then stays quiet until another appears.
function reactShouldFire(sessionId, transcriptPath) {
  try {
    const n = countMidTurnText(transcriptPath);
    if (n === 0) return false;
    const f = reactFile(sessionId);
    let seen = 0;
    try {
      seen = Number(fs.readFileSync(f, "utf8")) || 0;
    } catch {
      seen = 0;
    }
    if (n <= seen) return false;
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, String(n));
    return true;
  } catch {
    return false;
  }
}

// Pure text selection for a given event under the current mode. Returns null
// for "nothing to say here" — the default's clean-turn case, which main()
// treats as silence, not a fallback. The default's PostToolUse answer is a
// MAYBE: main() still gates it on reactShouldFire, which needs the session.
function nudgeFor(event) {
  if (event === "UserPromptSubmit") return MAX_MODE ? TURN : TURN_DIAL;
  if (MAX_MODE) return TOOL;
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
    if (event === "UserPromptSubmit" && !MAX_MODE) resetReact(input.session_id);
    if (event === "PostToolUse" && !MAX_MODE) {
      if (!reactShouldFire(input.session_id, input.transcript_path)) return;
      process.stdout.write(
        JSON.stringify({
          hookSpecificOutput: { hookEventName: event, additionalContext: STEP },
        })
      );
      return;
    }

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

module.exports = { nudgeFor, TURN, STEP, TOOL, TURN_DIAL, countMidTurnText };
