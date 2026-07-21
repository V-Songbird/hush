---
name: pick-style
description: Lists every output style available to this plugin — the presets hush ships, stock Hush, and anything craft-style has built — and switches the active one. Activation swaps the chosen style into the plugin's own slot so it binds like stock, and hands back to stock on request. This skill owns the swap procedure; craft-style calls into it. Only the stock Hush style is benchmarked — every preset is unmeasured.
when_to_use: Trigger when the user wants to browse, compare, switch, or turn off hush's output styles, says "hush styles", "list the styles", "switch style", "use the pirate style", "go back to stock hush", or invokes /hush:pick-style.
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
| # | Name | Description | Active |
| --- | --- | --- | --- |
| 1 | <name> | <description> | ✓ (only on the active row) |
```

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

The script backs up `output-styles/hush.md` to `output-styles/hush.md.stock` on first use, writes the chosen file into the forced slot with `force-for-plugin: true` added, and strips any `outputStyle` setting that pointed at the same name. It prints `{ ok, target, name, backedUp, settingsUpdated }`, or `{ ok: false, error }` on failure — relay an error verbatim rather than retrying.

This is the only place in the plugin that touches `output-styles/hush.md`; `craft-style` calls this same script rather than repeating the swap.

## 3. Report

From the script's JSON: which style (`name`) is now active, that it takes effect next session, and that `stock` is always the way back. Say plainly that presets and crafted styles are unmeasured — the benchmark numbers belong to stock Hush only.
