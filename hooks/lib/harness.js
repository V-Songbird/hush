'use strict';

// The Claude Code surface, in one file.
//
// hush's engine is plain Node — it takes text and gives back shorter text, and
// knows nothing about any agent CLI. Everything host-shaped lives here: how a
// payload arrives on stdin, the exact envelopes a decision has to be wrapped
// in on the way out, and the shapes a tool result comes in. A port to another
// harness rewrites this file and nothing else.
//
// The envelopes below are byte-for-byte what the hooks emitted before this
// module existed, and tests/contract/ pins them. Two of them are easy to get
// wrong and worth naming:
//
//   - The PostToolUse rewrite key is `updatedToolOutput`, NOT
//     `updatedToolResult`.
//   - PreCompact has no JSON envelope at all. Claude Code builds the
//     compaction instructions from this hook's RAW STDOUT, trimmed and
//     newline-joined across every PreCompact hook, so emitRaw writes plain
//     text and anything JSON-shaped there is silently wrong.
//
// Silence is a first-class emission: a hook that has nothing to say calls
// nothing at all, and its golden is an empty file.

const fs = require('fs');
const { readTailLines, isRealUserPrompt, lastUserPromptText } = require('./transcript');

// --- input ------------------------------------------------------------------

// The payload arrives as JSON on fd 0. Two readers, because the hooks
// deliberately disagree about what a malformed payload means:
//
//   readInput()      — anything unreadable is `{}`. For hooks whose gating
//                      reads named fields and falls through harmlessly when
//                      they are missing.
//   readInputOrNull() — `{}` for an empty payload, `null` for a malformed one,
//                      so a caller that must not act on a half-understood
//                      payload can tell the two apart and stay silent.
function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, 'utf-8') || '{}');
  } catch {
    return {};
  }
}

function readInputOrNull() {
  let raw;
  try {
    raw = fs.readFileSync(0, 'utf-8');
  } catch {
    return {};
  }
  if (!raw || !raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return null; // malformed — caller stays silent
  }
}

// Streaming variant, for a hook that must not block the event loop while it
// waits on stdin. Same lenient contract as readInput: a malformed payload
// becomes `{}` rather than an error, because for the caller the event name is
// the only field that matters and dropping the whole fire would be worse.
function readInputAsync(done) {
  let raw = '';
  process.stdin.on('data', (d) => {
    raw += d;
  });
  process.stdin.on('end', () => {
    let input = {};
    try {
      input = JSON.parse(raw || '{}');
    } catch {
      /* keep the empty object */
    }
    done(input);
  });
}

// --- output -----------------------------------------------------------------

// Key order is part of the wire here: JSON.stringify emits insertion order and
// the contract goldens compare bytes, so `extra` is merged AFTER the rewrite
// rather than spread around it.
function emitToolOutput(updated, extra) {
  const hookSpecificOutput = {
    hookEventName: 'PostToolUse',
    updatedToolOutput: updated,
  };
  if (extra) Object.assign(hookSpecificOutput, extra);
  process.stdout.write(JSON.stringify({ hookSpecificOutput }));
}

// The channel every advisory rides: UserPromptSubmit, PostToolUse and
// SubagentStart all take the same envelope and differ only in the event name.
function emitContext(event, text) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: event, additionalContext: text },
    })
  );
}

// PreToolUse's rewrite channel. The whole tool input is replaced, not patched,
// so callers hand over a complete object.
function emitUpdatedInput(toolInput) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', updatedInput: toolInput },
    })
  );
}

// PreCompact only. No envelope, no trailing newline — see the header.
function emitRaw(text) {
  process.stdout.write(text);
}

// --- tool results -----------------------------------------------------------

// The shapes a tool result arrives in, named once. hush watches four tools and
// they cover three shapes between them:
//
//   'text'    a shell result that is just a string
//   'fields'  a shell result as an object — stdout / stderr / output
//   'file'    a Read — { file: { content, filePath, numLines } }
//   'content' a Grep in content mode — { content, mode, numLines }
//
// `other` is a watched tool whose result is a shape hush does not rewrite: a
// files_with_matches Grep, an empty response. It is still a handled output, so
// callers record it rather than dropping it.
const SHELL_FIELDS = ['stdout', 'stderr', 'output'];

function decodeResponse(response) {
  if (typeof response === 'string') return { kind: 'text', text: response };
  if (!response || typeof response !== 'object') return { kind: 'other' };
  if (response.file && typeof response.file === 'object') {
    return { kind: 'file', file: response.file, text: response.file.content };
  }
  if (SHELL_FIELDS.some((f) => typeof response[f] === 'string')) {
    return { kind: 'fields', fields: SHELL_FIELDS.filter((f) => typeof response[f] === 'string') };
  }
  if (typeof response.content === 'string') return { kind: 'content', text: response.content };
  return { kind: 'other' };
}

module.exports = {
  readInput,
  readInputOrNull,
  readInputAsync,
  emitToolOutput,
  emitContext,
  emitUpdatedInput,
  emitRaw,
  decodeResponse,
  SHELL_FIELDS,
  // Transcript reading is a host surface too — the file format is Claude
  // Code's, and officially unstable. lib/transcript.js stays the parser; hooks
  // reach it through here so a port swaps one call site.
  readTailLines,
  isRealUserPrompt,
  lastUserPromptText,
};
