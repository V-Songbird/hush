#!/usr/bin/env node
"use strict";

// PreToolUse hook: wraps Bash/PowerShell commands so a non-zero exit never
// reaches Claude Code as a TOOL failure. A command that "fails" in the shell
// sense (build broke, tests red) still ran successfully as far as the Bash/
// PowerShell tool itself is concerned — but Claude Code routes a non-zero
// exit through PostToolUseFailure, an event with no mechanism to shrink
// content (no `updatedToolOutput`, unlike PostToolUse). That silently
// defeats compress-tool-output.js's CAP_FAIL path on exactly the noisy-
// failure case hush's compression exists for: hush's PostToolUse hook is
// never invoked for a command that exits non-zero, so a huge failing build
// or test dump reaches context uncompressed and stays that way for the rest
// of the session.
//
// Wrapping forces the tool call itself to always report success (so
// PostToolUse fires, where compression works), while the real exit code
// survives as a trailer marker compress-tool-output.js reads authoritatively
// (see EXIT_MARKER_RE there) instead of guessing from response shape/regex.

const fs = require("fs");

const WATCHED_TOOLS = new Set(["Bash", "PowerShell"]);
const MARKER_PREFIX = "[[hush:exit=";
const MARKER_SUFFIX = "]]";

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf-8") || "{}");
  } catch {
    return {};
  }
}

function alreadyWrapped(command) {
  return typeof command === "string" && command.includes(MARKER_PREFIX);
}

// Deliberately three separate statements with no `$var` ever inside a quoted
// string, and no parentheses around a variable — confirmed live against a
// real session that BOTH of the more natural forms get rejected outright by
// Claude Code's own command-safety layer before the command ever runs:
// `Write-Output "...$LASTEXITCODE..."` -> "Command contains expandable
// strings with embedded expressions"; `Write-Output ("..." + $LASTEXITCODE +
// "...")` -> "Command contains subexpressions $()" (parens near a variable
// read the same as a subexpression to that checker, even though this isn't
// one). Single-quoted literals plus a bare `$LASTEXITCODE` expression
// statement (PowerShell auto-prints an unconsumed expression's value) is the
// most primitive construct that still gets through, and it does — verified
// live, exit code correctly reported on its own line, tool succeeds.
//
// The command runs inside `& { ... } | Out-String` rather than bare — found
// live via the sonnet-showcase-v3 benchmark loop: a cmdlet pipeline ending
// in something like `Select-Object` (no explicit `Format-Table`/`Out-*`)
// defers rendering to PowerShell's implicit end-of-pipeline auto-formatter,
// which buffers objects to compute column widths before emitting anything.
// Appending our trailer statements — and then a hard `exit 0` — moves
// execution past that pipeline before the deferred formatter flushes,
// silently swallowing ALL of the command's output, not just ours.
// Reproduced directly: bare `Get-ChildItem` through the old wrapper worked;
// `Get-ChildItem | Select-Object Name` produced nothing; adding
// `Format-Table -AutoSize` back made it work again. `Out-String` forces
// full, synchronous rendering of whatever the block produces — object
// output or plain text alike — before the next statement runs, so nothing
// is left buffered when `exit 0` fires. `-Width` is set explicitly wide:
// Out-String's default wraps to the host's console width (often 80 in a
// non-interactive host), which would otherwise hard-wrap ordinary build/test
// output into extra lines and corrupt hush's line-based compression.
function wrapPowerShell(command) {
  return (
    `& { ${command} } 2>&1 | Out-String -Width 4096\n` +
    `Write-Output '${MARKER_PREFIX}'\n$LASTEXITCODE\nWrite-Output '${MARKER_SUFFIX}'\nexit 0`
  );
}

// Same shape for consistency, and to avoid relying on bash's own
// "$var"-in-quotes interpolation in case an analogous check applies there:
// single-quoted literals around a bare (unquoted, safe for a plain integer)
// variable reference.
function wrapBash(command) {
  return `${command}\n__hush_exit=$?\necho '${MARKER_PREFIX}'\necho $__hush_exit\necho '${MARKER_SUFFIX}'\nexit 0`;
}

// Wrapping is gated on the session's permission mode. Claude Code applies
// PreToolUse updatedInput BEFORE permission evaluation, and its permission
// engine both statically analyzes the rewritten command and splits it into
// per-statement operations that must each match an allow rule. The trailer
// cannot survive that under scoped allow rules on either shell — all
// verified live against cli 2.1.207 with `Bash(node*)`/`PowerShell(node*)`
// rules:
//   - PowerShell: a `& {` opening makes the first AST element a script
//     block ("Command name is a dynamic expression"), and even with it
//     removed the trailer's `$LASTEXITCODE` and `exit 0` statements are
//     unapproved operations. No variable-free way to emit an exit code
//     exists, so no trailer form can pass.
//   - Bash: the trailer's `$?` / `$__hush_exit` expansions are rejected
//     outright ("Contains simple_expansion") — and that check runs before
//     rule matching, so it denied EVERY wrapped command, even ones an
//     allow rule covered.
// Under `bypassPermissions` none of that machinery runs (verified live:
// the full PowerShell wrapper executes and the marker comes back), so
// wrapping is safe exactly there. `HUSH_WRAP=1` opts back in for sessions
// whose rules are blanket per-tool grants (plain `Bash` / `PowerShell`,
// no command pattern) — those match the wrapped command as a whole; the
// bundled benchmark harness runs that way.
function permissionsAllowWrapping(data) {
  if (process.env.HUSH_WRAP === "1") return true;
  return data.permission_mode === "bypassPermissions";
}

function shouldSkip(data, command) {
  if (typeof command !== "string" || !command.trim()) return true;
  if (alreadyWrapped(command)) return true;
  // A backgrounded launch (dev server, watch mode) never reaches its own
  // exit during this tool call — wrapping would just delay the trailer
  // forever behind a process that's still running. Best-effort: a
  // false-negative here just means no wrapping (today's behavior), never
  // breakage.
  if (data.tool_input && data.tool_input.run_in_background) return true;
  if (!permissionsAllowWrapping(data)) return true;
  return false;
}

function main() {
  if (process.env.HUSH_DISABLE === "1") return;
  const data = readInput();
  if (!WATCHED_TOOLS.has(data.tool_name)) return;

  const command = data.tool_input && data.tool_input.command;
  if (shouldSkip(data, command)) return;

  const wrapped = data.tool_name === "PowerShell" ? wrapPowerShell(command) : wrapBash(command);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        updatedInput: { ...data.tool_input, command: wrapped },
      },
    })
  );
}

if (require.main === module) main();

module.exports = { wrapPowerShell, wrapBash, alreadyWrapped, shouldSkip, MARKER_PREFIX, MARKER_SUFFIX };
