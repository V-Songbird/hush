'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert');
const { runHook, hookOutput } = require('./helpers');
const { wrapPowerShell, wrapBash, alreadyWrapped, shouldSkip, MARKER_PREFIX } = require('../hooks/preserve-exit-code');

// shouldSkip / end-to-end payloads: wrapping only happens in sessions where
// the permission engine never evaluates the rewritten command (see the gate
// comment in the hook), so the "wrapping happens" cases all run as
// bypassPermissions.
const BYPASS = 'bypassPermissions';

describe('unit: wrapping', () => {
  test('wrapPowerShell runs the command inside a script block piped through Out-String', () => {
    const out = wrapPowerShell('node build.js');
    assert.match(out, /^& \{ node build\.js \} 2>&1 \| Out-String -Width \d+\n/);
    assert.match(out, /Write-Output '\[\[hush:exit='\n\$LASTEXITCODE\nWrite-Output '\]\]'/);
    assert.match(out, /\nexit 0$/);
  });

  // Real bug found via the sonnet-showcase-v3 benchmark loop, reproduced
  // live: a cmdlet pipeline ending in something like `Select-Object` with no
  // explicit Format-Table/Out-* defers rendering to PowerShell's implicit
  // end-of-pipeline formatter, and the wrapper's trailing `exit 0` killed the
  // process before that deferred formatter ever flushed — silently
  // swallowing ALL of the command's output, not just the marker. Out-String
  // forces synchronous, complete rendering before the next statement runs.
  test('wraps a Select-Object-terminated command (the exact shape that lost output) through Out-String', () => {
    const out = wrapPowerShell('Get-ChildItem -Force | Select-Object Name, LastWriteTime');
    assert.match(out, /^& \{ Get-ChildItem -Force \| Select-Object Name, LastWriteTime \} 2>&1 \| Out-String/);
  });

  // Out-String defaults to wrapping at the host's console width (often 80 in
  // a non-interactive host) — that would hard-wrap ordinary build/test
  // output into extra lines and corrupt hush's line-based compression.
  test('Out-String uses an explicit wide width, never the host default', () => {
    const out = wrapPowerShell('node build.js');
    const width = Number(/Out-String -Width (\d+)/.exec(out)[1]);
    assert.ok(width >= 1000, `width ${width} should be wide enough to never wrap real output`);
  });

  // Claude Code's own command-safety layer rejects BOTH a double-quoted
  // PowerShell string containing a variable expansion ("Command contains
  // expandable strings with embedded expressions") AND a parenthesized
  // expression referencing one ("Command contains subexpressions $()") —
  // confirmed live, both blocked the command before it ever ran. Only a bare
  // `$LASTEXITCODE` expression statement plus single-quoted literals (no
  // interpolation, no parens near the variable) gets through.
  test('wrapPowerShell never puts $LASTEXITCODE inside quotes or parens', () => {
    const out = wrapPowerShell('node build.js');
    const quotedSegments = out.match(/"[^"]*"/g) || [];
    for (const segment of quotedSegments) {
      assert.doesNotMatch(segment, /\$LASTEXITCODE/, `no $var inside a double-quoted segment: ${segment}`);
    }
    assert.doesNotMatch(out, /\(\s*[^)]*\$LASTEXITCODE[^)]*\)/, 'no $var inside parentheses');
  });

  test('wrapBash appends an always-succeed trailer that captures $?', () => {
    const out = wrapBash('npm test');
    assert.match(out, /^npm test\n/);
    assert.match(out, /__hush_exit=\$\?/);
    assert.match(out, /echo '\[\[hush:exit='\necho \$__hush_exit\necho '\]\]'/);
    assert.match(out, /\nexit 0$/);
  });

  test('alreadyWrapped detects the marker prefix', () => {
    assert.ok(alreadyWrapped(`echo hi\n${MARKER_PREFIX}0]]`));
    assert.strictEqual(alreadyWrapped('echo hi'), false);
    assert.strictEqual(alreadyWrapped(undefined), false);
  });
});

describe('unit: shouldSkip', () => {
  test('skips empty or missing commands', () => {
    assert.strictEqual(shouldSkip({ permission_mode: BYPASS }, undefined), true);
    assert.strictEqual(shouldSkip({ permission_mode: BYPASS }, '   '), true);
  });

  test('skips a command that is already wrapped (idempotency)', () => {
    const wrapped = wrapBash('npm test');
    assert.strictEqual(shouldSkip({ permission_mode: BYPASS }, wrapped), true);
  });

  test('skips a backgrounded launch', () => {
    const data = { permission_mode: BYPASS, tool_input: { command: 'npm run dev', run_in_background: true } };
    assert.strictEqual(shouldSkip(data, 'npm run dev'), true);
  });

  test('does not skip an ordinary foreground command under bypassPermissions', () => {
    const data = { permission_mode: BYPASS, tool_input: { command: 'node build.js' } };
    assert.strictEqual(shouldSkip(data, 'node build.js'), false);
  });

  // The permission engine statically analyzes the REWRITTEN command and
  // splits it into per-statement operations checked against allow rules.
  // The trailer can never pass that (`$LASTEXITCODE`/`exit 0` on
  // PowerShell, `$?` expansions on Bash — all verified live), so in any
  // mode where permissions are evaluated the command must go through
  // untouched.
  test('skips every permission mode except bypassPermissions', () => {
    for (const mode of ['default', 'acceptEdits', 'plan', undefined]) {
      const data = { permission_mode: mode, tool_input: { command: 'node build.js' } };
      assert.strictEqual(shouldSkip(data, 'node build.js'), true, `mode: ${mode}`);
    }
  });

  test('HUSH_WRAP=1 forces wrapping regardless of permission mode', () => {
    process.env.HUSH_WRAP = '1';
    try {
      const data = { permission_mode: 'acceptEdits', tool_input: { command: 'node build.js' } };
      assert.strictEqual(shouldSkip(data, 'node build.js'), false);
    } finally {
      delete process.env.HUSH_WRAP;
    }
  });
});

describe('hook: end to end', () => {
  test('unwatched tool stays silent', () => {
    const r = runHook('preserve-exit-code.js', {
      tool_name: 'Read',
      permission_mode: BYPASS,
      tool_input: { file_path: 'a.txt' },
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('Bash command gets wrapped via updatedInput on PreToolUse', () => {
    const r = runHook('preserve-exit-code.js', {
      tool_name: 'Bash',
      permission_mode: BYPASS,
      tool_input: { command: 'node build.js' },
    });
    const out = hookOutput(r);
    assert.strictEqual(out.hookSpecificOutput.hookEventName, 'PreToolUse');
    assert.match(out.hookSpecificOutput.updatedInput.command, /^node build\.js\n/);
    assert.match(out.hookSpecificOutput.updatedInput.command, /exit 0$/);
  });

  test('PowerShell command gets wrapped with the PowerShell-specific trailer', () => {
    const r = runHook('preserve-exit-code.js', {
      tool_name: 'PowerShell',
      permission_mode: BYPASS,
      tool_input: { command: 'node --test' },
    });
    const updatedCommand = hookOutput(r).hookSpecificOutput.updatedInput.command;
    assert.match(updatedCommand, /\$LASTEXITCODE/);
  });

  test('a session that evaluates permissions leaves the command untouched', () => {
    for (const mode of ['default', 'acceptEdits']) {
      const r = runHook('preserve-exit-code.js', {
        tool_name: 'PowerShell',
        permission_mode: mode,
        tool_input: { command: 'node --test' },
      });
      assert.strictEqual(hookOutput(r), null, `mode: ${mode}`);
    }
  });

  test('a payload with no permission_mode at all is left untouched', () => {
    const r = runHook('preserve-exit-code.js', {
      tool_name: 'Bash',
      tool_input: { command: 'node build.js' },
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('HUSH_WRAP=1 wraps even when permissions are evaluated', () => {
    const r = runHook(
      'preserve-exit-code.js',
      { tool_name: 'Bash', permission_mode: 'acceptEdits', tool_input: { command: 'node build.js' } },
      { HUSH_WRAP: '1' }
    );
    assert.match(hookOutput(r).hookSpecificOutput.updatedInput.command, /exit 0$/);
  });

  test('other tool_input fields survive the rewrite untouched', () => {
    const r = runHook('preserve-exit-code.js', {
      tool_name: 'Bash',
      permission_mode: BYPASS,
      tool_input: { command: 'node build.js', description: 'Run the build', timeout: 30000 },
    });
    const updatedInput = hookOutput(r).hookSpecificOutput.updatedInput;
    assert.strictEqual(updatedInput.description, 'Run the build');
    assert.strictEqual(updatedInput.timeout, 30000);
  });

  test('a backgrounded command is left alone', () => {
    const r = runHook('preserve-exit-code.js', {
      tool_name: 'Bash',
      permission_mode: BYPASS,
      tool_input: { command: 'npm run dev', run_in_background: true },
    });
    assert.strictEqual(hookOutput(r), null);
  });

  test('HUSH_DISABLE=1 bypasses wrapping, even with HUSH_WRAP=1', () => {
    const r = runHook(
      'preserve-exit-code.js',
      { tool_name: 'Bash', permission_mode: BYPASS, tool_input: { command: 'node build.js' } },
      { HUSH_DISABLE: '1', HUSH_WRAP: '1' }
    );
    assert.strictEqual(hookOutput(r), null);
  });

  test('malformed stdin exits cleanly', () => {
    const { spawnSync } = require('child_process');
    const path = require('path');
    const r = spawnSync('node', [path.join(__dirname, '..', 'hooks', 'preserve-exit-code.js')], {
      input: 'not json',
      encoding: 'utf-8',
    });
    assert.strictEqual(r.status, 0);
    assert.strictEqual(r.stdout.trim(), '');
  });
});
