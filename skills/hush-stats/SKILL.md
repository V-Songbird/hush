---
name: hush-stats
description: Reports what hush's compression hook did this session — observed bytes in and out per transform, recovery-file storage, fallback and retrieval counts from the HUSH_DEBUG manifest, plus the transcript's own per-model token totals. Requires HUSH_DEBUG=1 to have been set during the work being measured; without it there is nothing to report.
when_to_use: Trigger when the user asks what hush did this session, wants hush's byte or token numbers, says "hush stats", "how much did hush save", "show hush's savings", or invokes /hush:stats.
argument-hint: "[session-id]"
allowed-tools: Bash, PowerShell
---

# hush:hush-stats

Surfaces what hush's compression hook already recorded but never showed anyone: the bytes that went into and came out of every decision it made this session, and — from the transcript itself — how many tokens each model used.

## 1. Run the script

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js"
```

If the user gave a session id as an argument, pass it through: `node "${CLAUDE_PLUGIN_ROOT}/scripts/stats.js" --session <id>`.

The script auto-finds the current directory's most recent transcript when no id is given. It never modifies anything — read-only over the manifest and the transcript.

## 2. If it reports no manifest found

This means `HUSH_DEBUG=1` wasn't set while the work being asked about happened — the manifest only exists when that flag was on (it's off by default; see the README's Settings table). Tell the user plainly: set `HUSH_DEBUG=1` before the session (or turn) they want measured, then ask again. Do not estimate or infer numbers from anything else — a guess dressed as a number is worse than admitting there's nothing to report.

## 3. Report

State the outcome in plain sentences, not a wall of labels: the observed bytes in and out across the outputs hush handled, the one or two actions that did most of the work (e.g. "cap" or "sidecar"), how much went into recovery files, and the per-model token counts if a transcript was found. Two rules hold whatever the user asked:

- Report only what the script printed. Anything it labelled unavailable stays unavailable — say so in one clause and move on, rather than padding around it or filling the hole with a plausible number.
- The numbers describe what hush did to tool output, not what the session would have cost without hush. That comparison needs a second, hush-free run of the same session, which doesn't exist. If the user asks how much hush saved them, give them the activity numbers and say plainly that the counterfactual isn't measurable from one run.
