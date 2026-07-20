---
name: pick-style
description: Lists every output style available to this plugin — the presets hush ships, stock Hush, and anything craft-style has built — and switches the active one. Activation swaps the chosen style into the plugin's own slot so it binds like stock, and hands back to stock on request. This skill owns the swap procedure; craft-style calls into it. Only the stock Hush style is benchmarked — every preset is unmeasured.
when_to_use: Trigger when the user wants to browse, compare, switch, or turn off hush's output styles, says "hush styles", "list the styles", "switch style", "use the pirate style", "go back to stock hush", or invokes /hush:pick-style.
argument-hint: "[style name]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, AskUserQuestion
---

# hush:pick-style

Picks which output style hush delivers, and delivers it. Every style listed here carries hush's mechanics — the silence between tool calls, the one structured final message, the hard caps. They differ only in voice and in what the final message is built to do.

## 1. Read the shelf

Three sources, each identified mechanically by its own marker:

| Source | Where | Marker in the frontmatter description |
| --- | --- | --- |
| Shipped presets | `${CLAUDE_PLUGIN_ROOT}/styles/*.md` | `Unmeasured preset shipped with Hush.` |
| Stock Hush | `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` | neither marker |
| Crafted styles | `~/.claude/output-styles/*.md` and `<project>/.claude/output-styles/*.md` | `Unmeasured variant of Hush.` |

The two markers never overlap, so a shipped preset is never reported as the user's own work and a crafted style is never reported as shipped. Read each file's `name` and `description` — that pair is what the user picks from.

Presets live outside `output-styles/` on purpose: every `.md` under a plugin's `output-styles/` directory, at any depth, registers as a selectable style, and a style that is merely selected under-delivers on the mechanics it copied. The only path that binds is step 3's swap.

## 2. Read what's active

Read the frontmatter of `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` and route on its description:

- Carries `Unmeasured preset shipped with Hush.` → that preset is active; match it to the shelf by `name`.
- Carries `Unmeasured variant of Hush.` → a crafted style is active.
- Carries neither → stock Hush is active.

Also note whether `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md.stock` exists. A backup with stock content back in `hush.md` means a plugin update restored stock over a takeover — say so and offer to re-run step 3.

If the invocation already named a style, skip the rest of this step and confirm the swap instead.

Otherwise put the whole shelf on screen and ask in the same breath — one message, then the question:

1. Write one line per style: its `name`, then its description cut to a clause. Mark the active one. Every style goes on this list, however many there are, and this list is the one place the user sees them all.
2. Ask with `AskUserQuestion`. It takes at most four options, so the shelf does not fit inside it — offer the four likeliest picks instead: the styles that are not currently active, with `Hush (stock, benchmarked)` first whenever stock is not the one running. The user reaches anything else by naming it in the free-text answer, which is why the list above has to be complete.

## 3. Activate — the swap, and the only copy of it

A style delivered through `force-for-plugin: true` binds; the same content merely selected in settings under-delivers on the mechanics it copied. Activation therefore swaps the chosen style INTO the plugin's forced slot — ask the user first, every time.

To activate any style — a shipped preset, or a style `craft-style` built:

1. Back up the stock file: copy `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` to `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md.stock` (non-`.md`, so it never registers as a style). Skip if the backup already exists.
2. Overwrite `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` with the chosen file's content, plus `force-for-plugin: true` added to its frontmatter. The source file stays untouched at its own path — a shipped preset stays shippable, a crafted style stays the editable master.
3. Remove any `outputStyle` selection pointing at the chosen style; the forced slot makes it redundant.
4. It takes effect at the next session. Tell the user a plugin update restores stock hush, and that this skill notices and offers the swap again on its next run (step 2).

To go back to `Hush (stock)`: restore `hush.md` from `hush.md.stock`.

If the user declines, nothing moves — the style stays where it was, inert until they activate it.

## 4. Report

Which style is active, when it takes effect, and how to go back. Say plainly that presets and crafted styles are unmeasured — the benchmark numbers belong to stock Hush only.
