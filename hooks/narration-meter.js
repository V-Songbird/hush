#!/usr/bin/env node
"use strict";

// Dual-mode narration meter.
// - PostToolUse: measures narration accumulated so far in the current turn
//   (every text block so far precedes a tool call, so all of it is narration)
//   and injects one corrective line the moment the budget is crossed — at
//   most once per turn, so the correction lands inside the offending turn.
// - Stop: turn-end measurement, final block exempt (it's the deliverable).
// Either mode fires at most once per turn — any fire marks the turn corrected.
// Costs zero tokens while the agent behaves.

const fs = require("fs");
const os = require("os");
const path = require("path");
const { readTailLines, isRealUserPrompt } = require("./lib/transcript");

const BUDGET = (() => {
  const n = parseInt(process.env.HUSH_NARRATION_BUDGET || "", 10);
  return Number.isFinite(n) && n >= 0 ? n : 120;
})();

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf-8") || "{}");
  } catch {
    return {};
  }
}

function assistantTextBlocks(entry) {
  if (entry.type !== "assistant" || entry.isSidechain) return [];
  const content = entry.message?.content;
  if (!Array.isArray(content)) return [];
  return content.filter((c) => c.type === "text" && typeof c.text === "string").map((c) => c.text);
}

function wordCount(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

// All assistant text blocks since the last real user prompt, plus a stable
// key identifying that turn (for the once-per-turn state dedup).
function currentTurn(lines) {
  const entries = [];
  for (const line of lines) {
    try {
      entries.push(JSON.parse(line));
    } catch {
      /* skip malformed */
    }
  }
  const texts = [];
  let turnKey = "window-start";
  for (let i = entries.length - 1; i >= 0; i--) {
    if (isRealUserPrompt(entries[i])) {
      turnKey = entries[i].uuid || entries[i].timestamp || "unknown-turn";
      break;
    }
    texts.unshift(...assistantTextBlocks(entries[i]));
  }
  return { texts, turnKey };
}

function tally(texts) {
  return {
    narration: texts.reduce((sum, t) => sum + wordCount(t), 0),
    blocks: texts.length,
  };
}

// Mid-turn: everything so far is narration (a tool call followed each block).
function measureCurrentTurn(lines) {
  const { texts, turnKey } = currentTurn(lines);
  return { ...tally(texts), turnKey };
}

// Turn end: the final block is the deliverable, not narration.
function measureLastTurn(lines) {
  const { texts, turnKey } = currentTurn(lines);
  if (texts.length <= 1) return { narration: 0, blocks: 0, turnKey };
  return { ...tally(texts.slice(0, -1)), turnKey };
}

function statePath(sessionId) {
  const safe = String(sessionId || "unknown").replace(/[^a-zA-Z0-9-]/g, "_");
  return path.join(os.tmpdir(), `hush-meter-${safe}.json`);
}

function readState(sessionId) {
  try {
    return JSON.parse(fs.readFileSync(statePath(sessionId), "utf-8"));
  } catch {
    return {};
  }
}

function writeState(sessionId, state) {
  try {
    fs.writeFileSync(statePath(sessionId), JSON.stringify(state));
  } catch {
    /* best effort — losing state means one extra reminder, not breakage */
  }
}

function main() {
  if (process.env.HUSH_DISABLE === "1") return;
  if (process.env.HUSH_NARRATION === "off") return;
  const data = readInput();
  if (!data.transcript_path || !fs.existsSync(data.transcript_path)) return;

  const lines = readTailLines(data.transcript_path);
  const midTurn = data.hook_event_name === "PostToolUse";
  const { narration, blocks, turnKey } = midTurn ? measureCurrentTurn(lines) : measureLastTurn(lines);
  if (narration <= BUDGET) return;
  if (readState(data.session_id).turnKey === turnKey) return; // already corrected this turn
  // Any fire marks the turn — Stop included, else a notification/wakeup chain
  // (several Stop events, same turnKey) re-fires on every stop and each
  // correction forces a reply whose words re-count into the same turn.
  writeState(data.session_id, { turnKey });

  const message = midTurn
    ? `hush: ${narration} words of narration across ${blocks} blocks so far this turn (budget ${BUDGET}). Stop narrating — keep working silently and put everything in one final message.`
    : `hush: ${narration} words of mid-turn narration across ${blocks} blocks this turn (budget ${BUDGET}). Work silently; put everything in the final message.`;

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: midTurn ? "PostToolUse" : "Stop",
        additionalContext: message,
      },
    })
  );
}

if (require.main === module) main();

module.exports = { measureLastTurn, measureCurrentTurn, isRealUserPrompt, wordCount };
