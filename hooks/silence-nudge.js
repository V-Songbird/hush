#!/usr/bin/env node
"use strict";

// Re-states the silence rule from a hook channel, next to the text the model
// is about to write. The output style alone does not hold mid-turn silence on
// the larger models; the same rule delivered here, where the model is about to
// write, does.
//
// Two levels, picked by HUSH_NUDGE:
//
//   (default)  One reminder at the top of the turn, plus a corrective one
//              fired ONLY when the transcript shows a mid-turn assistant
//              text block this turn, at most once per turn. A turn that
//              stays silent gets nothing mid-turn at all.
//   max        A reminder on every tool result (doubled), plus the one at
//              the top of the turn.
//
// Why the default reminds reactively instead of on every tool result: every
// reminder is context the session carries and pays for, and `max` adds two on
// every tool result whether or not anything slipped. The default adds one
// only after a mid-turn text block shows up, so a session that stays quiet
// pays nothing extra, and the corrective lands right where the turn-top
// reminder has faded. Older values `turn`, `lean`, and `react` are accepted
// as synonyms for the default, so nothing anyone set ever breaks.
//
// Positive-forward wording only, at every level. Naming the unwanted
// behavior primes it — a clause that describes narrating produces narrating.

const fs = require("node:fs");
const path = require("node:path");
const { quietOff, OFF_TOKEN } = require("./lib/gate");
const { sessionDir } = require("./lib/sidecar-store");
const { readInputAsync, emitContext, readTailLines, isRealUserPrompt } = require("./lib/harness");

const nudgeEnv = String(process.env.HUSH_NUDGE || "").trim();
const OFF = OFF_TOKEN.test(nudgeEnv);
const MAX_MODE = /^max$/i.test(nudgeEnv);

// max's own wording. With a step reminder beside it, "until the work is done"
// holds better than the closed-boundary text below. Each text belongs to its
// own configuration; the two are not interchangeable.
const TURN =
  "hush: this turn is silent until the work is done. Everything you learn goes in the final message.";
const STEP =
  "hush: your next output is a tool call. The final message is the only place you explain anything.";
const TOOL = `${STEP} ${STEP}`;

// The default's turn text. Closes a boundary TURN leaves open: "until the
// work is done" let the model call the work done and announce a verification
// step out loud, mid-turn, right before running it. It is the text for the
// configuration with no standing step reminder. Its opening-line rule is the
// shipped voice's own words (output-styles/hush.md), so the two agree.
const TURN_DIAL =
  "hush: this turn opens with a tool call. If a line does come first, it answers three things in one breath: what you will do, what you do not know yet, and how you will find out. Then the turn is silent until the final message. Everything you learn goes in the final message.";

// The reminders re-state the quiet rule of whichever style holds hush's own
// slot. Stock and every variant that passes scripts/verify-style.js carry this
// phrase. A style activated there without it shares progress between tool
// calls, and a reminder would only contradict it. An unreadable slot keeps the
// reminders on.
const QUIET_PHRASE = "Not one word between tool calls";
function styleKeepsQuiet(pluginRoot = path.join(__dirname, "..")) {
  try {
    return fs.readFileSync(path.join(pluginRoot, "output-styles", "hush.md"), "utf8").includes(QUIET_PHRASE);
  } catch {
    return true;
  }
}

// The default's corrective state: nonzero once this turn's corrective has
// fired. Lives beside the session's other scratch, so Core's session-end
// cleanup clears it; with Core off nothing reaps it and it is left for OS
// temp cleaning. Fail-open in the cheap direction — an unreadable transcript
// or counter means no injection.
function reactFile(sessionId) {
  return path.join(sessionDir(sessionId), "react-count");
}
function resetReact(sessionId) {
  try {
    fs.mkdirSync(sessionDir(sessionId), { recursive: true });
    fs.writeFileSync(reactFile(sessionId), "0");
  } catch { /* fail open */ }
}
// Claude Code's own request for a status line ("The user hasn't heard from
// you in a while…"), recorded in the transcript as an attachment entry.
const HOST_STATUS = "silent_turn_reminder";

// Count assistant text blocks since the last real human prompt — mid-turn
// text, because the turn's own final message cannot exist yet while a
// PostToolUse hook is firing. The first text block after a host status
// request, before any tool call, is the line the host asked for and does not
// count. Fail-SILENT on any trouble: no count means no injection, which is
// the cheap direction.
function countMidTurnText(transcriptPath) {
  let lines;
  try {
    lines = readTailLines(transcriptPath);
  } catch {
    return 0;
  }
  const turn = [];
  for (let i = lines.length - 1; i >= 0; i--) {
    let e;
    try {
      e = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (isRealUserPrompt(e)) break;
    turn.push(e);
  }
  let count = 0;
  let hostAsked = false;
  for (let i = turn.length - 1; i >= 0; i--) {
    const e = turn[i];
    if (e.isSidechain) continue;
    if (e.type === "attachment" && e.attachment && e.attachment.type === HOST_STATUS) hostAsked = true;
    if (e.type !== "assistant") continue;
    const c = e.message && e.message.content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type === "tool_use") hostAsked = false;
      if (b.type !== "text" || typeof b.text !== "string" || !b.text.trim()) continue;
      if (hostAsked) hostAsked = false;
      else count++;
    }
  }
  return count;
}
// Fires at most once per turn: the reminder lands right after the first
// block that earned it, then stays quiet until the next prompt resets it.
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
    if (seen > 0) return false;
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
  if (!styleKeepsQuiet()) return;
  // A malformed payload is not a reason to drop the reminder: the event name
  // is the only field used, and PostToolUse is the common case.
  readInputAsync((input) => {
    const event = input.hook_event_name === "UserPromptSubmit" ? "UserPromptSubmit" : "PostToolUse";
    if (event === "UserPromptSubmit" && !MAX_MODE) resetReact(input.session_id);
    if (event === "PostToolUse" && !MAX_MODE) {
      if (!reactShouldFire(input.session_id, input.transcript_path)) return;
      emitContext(event, STEP);
      return;
    }

    const text = nudgeFor(event);
    if (text === null) return;

    emitContext(event, text);
  });
}

if (require.main === module) main();

module.exports = { nudgeFor, TURN, STEP, TOOL, TURN_DIAL, countMidTurnText, styleKeepsQuiet, QUIET_PHRASE };
