'use strict';

// Shared transcript-tail helpers. Both hush hooks (narration-meter and
// compress-tool-output) need to read the current turn's real human prompt from
// the session JSONL; keep the tail-read and the turn-boundary schema in ONE
// place so the origin.kind/isMeta rules can't drift between the two.

const fs = require('fs');

// Deliberately simple: fixed 1MB tail window. Hooks run on every tool call in
// long sessions, so never read the whole transcript — only the tail. A single
// turn larger than the window undercounts, a documented ceiling.
const TAIL_BYTES = 1024 * 1024;

function readTailLines(file) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    let lines = buf.toString('utf-8').split('\n');
    if (start > 0) lines = lines.slice(1); // drop the leading partial line
    return lines.filter((l) => l.trim());
  } finally {
    fs.closeSync(fd);
  }
}

function isRealUserPrompt(entry) {
  if (entry.type !== 'user' || entry.isSidechain) return false;
  // Harness-injected continuations look like fresh user turns but aren't:
  // task-notification entries carry origin.kind === "task-notification", and
  // ScheduleWakeup firings carry isMeta === true with no origin at all. Only
  // origin.kind === "human" (or its absence, for older transcripts) is a turn
  // boundary a person actually typed.
  if (entry.isMeta) return false;
  if (entry.origin && entry.origin.kind !== 'human') return false;
  const content = entry.message?.content;
  if (typeof content === 'string') return true;
  if (Array.isArray(content)) {
    // Tool results come back as type:"user" lines; a real prompt has text
    // items and no tool_result items.
    return content.some((c) => c.type === 'text') && !content.some((c) => c.type === 'tool_result');
  }
  return false;
}

// The plain text of a real user-prompt entry (string content, or its text
// blocks joined). Empty string for anything else.
function userPromptText(entry) {
  const content = entry.message?.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .filter((c) => c.type === 'text' && typeof c.text === 'string')
      .map((c) => c.text)
      .join('\n');
  }
  return '';
}

// The most recent real human prompt in the transcript tail — the one governing
// the current turn. '' when the transcript is missing/unreadable or the tail
// holds no human prompt (older/edge sessions), so callers can treat "unknown"
// as "no carve-out" and fail safe.
function lastUserPromptText(transcriptPath) {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) return '';
  let lines;
  try {
    lines = readTailLines(transcriptPath);
  } catch {
    return '';
  }
  for (let i = lines.length - 1; i >= 0; i--) {
    let entry;
    try {
      entry = JSON.parse(lines[i]);
    } catch {
      continue;
    }
    if (isRealUserPrompt(entry)) return userPromptText(entry);
  }
  return '';
}

module.exports = { readTailLines, isRealUserPrompt, userPromptText, lastUserPromptText, TAIL_BYTES };
