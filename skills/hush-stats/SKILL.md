---
name: hush-stats
description: Reports how much hush's compression hook actually saved this session — a per-decision byte rollup from the HUSH_DEBUG manifest plus a per-model token breakdown from the transcript. Requires HUSH_DEBUG=1 to have been set during the work being measured; without it there is nothing to report.
when_to_use: Trigger when the user asks how much hush saved, wants savings numbers for the current session, says "hush stats", "how much did hush save", "show hush's savings", or invokes /hush:stats.
argument-hint: "[session-id]"
allowed-tools: Bash, PowerShell
---

# hush:hush-stats

Surfaces the value hush's compression hook already recorded but never showed anyone: a byte rollup of every decision it made this session, and — from the transcript itself — how many tokens each model actually used.

## 1. Run the script

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js"
```

If the user gave a session id as an argument, pass it through: `node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js" --session <id>`.

The script auto-finds the current directory's most recent transcript when no id is given. It never modifies anything — read-only over the manifest and the transcript.

## 2. If it reports no manifest found

This means `HUSH_DEBUG=1` wasn't set while the work being asked about happened — the manifest only exists when that flag was on (it's off by default; see the README's Settings table). Tell the user plainly: set `HUSH_DEBUG=1` before the session (or turn) they want measured, then ask again. Do not estimate or infer savings from anything else — a guess dressed as a number is worse than admitting there's nothing to report.

## 3. Report

State the outcome in plain sentences, not a wall of labels: total bytes saved (raw and net of hush's own one-time session note, if it fired), the one or two actions that did most of the work (e.g. "cap" or "sidecar"), and the per-model token counts if a transcript was found. Skip any section the script reported as unavailable rather than padding around it.
