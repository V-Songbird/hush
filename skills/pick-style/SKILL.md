---
name: pick-style
description: Lists every output style available to this plugin — stock Hush and anything craft-style has built — and switches the active one. Activation swaps the chosen style into the plugin's own slot so it binds like stock, and hands back to stock on request. This skill owns the swap procedure; craft-style calls into it. A crafted style is unmeasured — the benchmark numbers belong to the stock voice hush shipped when each batch ran.
when_to_use: Trigger when the user wants to browse, compare, switch, or turn off hush's output styles, says "hush styles", "list the styles", "switch style", "use my own style", "go back to stock hush", or invokes /hush:pick-style.
argument-hint: "[style name]"
allowed-tools: Bash, PowerShell
---

# hush:pick-style

Picks which output style hush delivers, and delivers it. Every style listed here carries hush's mechanics — the silence between tool calls, the one structured final message, the hard caps. They differ only in voice and in what the final message is built to do.

Everything below is mechanical: two scripts do the reading, matching, and file-writing. Run their output verbatim — no re-parsing frontmatter by hand, no free-form judgment about which entry the user means.

## 1. List the shelf and ask for a number

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/list-styles.js"
```

It prints one JSON object: `styles` (each with `index`, `name`, `description`, `source`, `path`, `active`), plus `activeName`, `activeOnShelf`, `stockBackupExists`, and `restoredOverTakeover`.

Render it as exactly this table, one row per entry in `styles`, in index order:

```
| # | Name | Description | Source | Active |
| --- | --- | --- | --- | --- |
| 1 | <name> | <description> | <source> | ✓ (only on the active row) |
```

`source` is `stock` for the voice hush ships and `crafted` for the user's own variants. Print it as it comes — it is what tells two same-named entries apart.

If `restoredOverTakeover` is `true`, add one line above the table: "A plugin update restored stock Hush over a prior takeover." Otherwise add nothing.

If `activeOnShelf` is `false`, add one line above the table instead: "`<activeName>` is active but its file is no longer on disk — no row below is checked." This means no row in the table will show ✓.

If the invocation already named a style, match it case-insensitively against `styles[].name`. Exactly one match → skip straight to step 2 with that entry's `path`, no table shown. No match, or more than one → show the table as above and ask the user to reply with a row number.

End the message with the table (or the skipped-straight-through report) — nothing after it. Wait for the reply.

## 2. Activate

Take the number from the user's reply and look it up in the `styles` array from step 1 — a plain index lookup, not a re-read of any file. An out-of-range or non-numeric reply gets the table shown again, unchanged, with no other action taken.

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/activate-style.js" "<that entry's path>"
```

The script checks the chosen style against hush's mechanics first, backs up `output-styles/hush.md` to `output-styles/hush.md.stock` on first use, writes the chosen file into the forced slot with `force-for-plugin: true` added, and removes an `outputStyle` setting that selects the chosen style by its bare name, such as `"Pirate"`, from `~/.claude/settings.json`, `.claude/settings.json` and `.claude/settings.local.json`. A namespaced value such as `"hush:Hush"` or `"hush:Pirate"` always stays, because it is what turns on Claude Code's per-turn style reminder. The swap is all-or-nothing: a style that dropped hush's mechanics, answers to stock's own name or has a colon in its name is refused, and any failure mid-swap puts the previously active style back. The backup is kept, so `stock` restores as often as it is asked for.

It prints `{ ok, target, name, backedUp, styleUpdated, settingsUpdated, warnings }`, or `{ ok: false, error }` on failure — relay an error verbatim rather than retrying. `settingsUpdated` lists the settings files the setting was removed from; report only those as changed. A non-empty `warnings` comes with a completed swap: the style is active, and each warning names a settings file whose redundant `outputStyle` is still there for the user to remove by hand. Relay those verbatim too, under the report.

A refusal that also carries `telemetryUpdate` has one gap only: the style keeps the paragraph about `[hush ...]` lines from an older hush, and activation needs the current one. Relay the error, quote `telemetryUpdate.old` as the paragraph that goes and `telemetryUpdate.new` as the one that replaces it, say that no other line of `telemetryUpdate.path` changes, and ask whether to make that swap and activate. End the message with the question and wait. On a yes, run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/activate-style.js" --update-telemetry "<that entry's path>"
```

It swaps that one paragraph in the style file, checks the style again and activates it; `styleUpdated` names the file it changed. Any other reply changes nothing: the style file stays as it is, and so does the active style.

This is the only place in the plugin that touches `output-styles/hush.md`; `craft-style` calls this same script rather than repeating the swap.

## 3. Report

From the script's JSON: which style (`name`) is now active, which file had its paragraph swapped when `styleUpdated` is set, that it takes effect next session, and that `stock` is always the way back. Say plainly that a crafted style is unmeasured — the benchmark numbers belong to the stock voice hush shipped when each batch ran.
