---
name: craft-style
description: Builds a personal output style on hush's frame — the user's voice on the surface, hush's silence-and-structure mechanics copied verbatim underneath. Manages its own creations: lists them alongside stock Hush, edits them, and — with the user's consent — steps the plugin's forced style aside so a crafted one can run. A mechanical verifier confirms every invariant survived. Only the stock Hush style is benchmarked — crafted styles are unmeasured.
when_to_use: Trigger when the user wants a personal or custom output style built on hush, wants to edit or switch a crafted style, says "make me a hush style", "hush but robotic", "craft a style", "custom output style", or invokes /hush:craft-style.
argument-hint: "[voice description]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, AskUserQuestion
---

# hush:craft-style

Builds and manages output styles the user owns: their voice, hush's machinery. The mechanics that make hush cheap — silence between tool calls, one structured final message, the hard caps — are copied byte for byte. The voice around them is rewritten to the user's taste.

## 1. Take stock

Crafted styles carry the sentence `Unmeasured variant of Hush.` in their frontmatter description — that is how this skill recognizes its own work. Scan `~/.claude/output-styles/*.md` and `<project>/.claude/output-styles/*.md` for it.

Also read the frontmatter of `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` and note whether the `force-for-plugin: true` line is present.

Then route:

- **No crafted styles found** → go to step 2 and create one.
- **Crafted styles found** → ask the user (AskUserQuestion) what to do, listing every crafted style by name and destination alongside `Hush (stock, benchmarked)`: create a new style, edit one of the listed, or switch which style is active (step 5 handles the switch).
- **A crafted style is selected in settings but the plugin copy carries the flag again** → a plugin update restored it. Say so and offer to re-run step 5's takeover before anything else.

## 2. Gather three inputs

From the invocation arguments, or by asking:

- **Voice** — how the style should sound, in the user's words ("robotic", "pirate", "extremely dry British"). When editing, gather what should change instead.
- **Name** — a short style name; derive one from the voice if the user doesn't care.
- **Destination** — `~/.claude/output-styles/` (every project) or `<project>/.claude/output-styles/` (this project only). Default to user-level.

The filename is the kebab-cased name plus `.md`. If that file already exists and wasn't picked for editing in step 1, show its path and ask before overwriting.

## 3. Assemble the style

Read `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` — everything below refers to its sections.

Frontmatter:

```yaml
---
name: <Name>
description: <one line in the user's voice>. Unmeasured variant of Hush.
keep-coding-instructions: true
---
```

The description must end with the exact sentence `Unmeasured variant of Hush.` — step 1 depends on it. `force-for-plugin` stays out — that key belongs to the plugin's own copy only.

Copy these VERBATIM, byte for byte:

- the entire **Mid-turn silence**, **Thoroughness**, and **Never compress** sections
- every `## ` heading, with its exact text
- in **Final message**: the shape table and every bolded cap bullet
- in **Register**: the paragraph about bracketed `[hush ...]` notes and the paragraph about hook-injected reminders

Rewrite the rest in the requested voice — the opening line, the prose around the table and caps in **Final message**, the worked example, the **Word economy** body, the rest of **Register**.

Rules for the rewrite:

- State every rule as the action to take, in positive form.
- An exception says what it grants, and stops there.
- Every number keeps its value.
- Keep a clause that identifiers, paths, and error text stay verbatim, whatever the voice does.
- The worked example must itself obey every cap.

## 4. Verify mechanically

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-style.js" "${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md" <new-style-file>
```

It lists every invariant that didn't survive. Fix the file and re-run until it exits 0.

## 5. Activate — only with the user's consent

While `force-for-plugin: true` is present in the plugin's own style file, that style wins every session and a crafted style never runs. Activation therefore edits one line inside the installed plugin copy — ask the user first, every time, and touch nothing else in that file.

To activate a crafted style:

1. Delete the `force-for-plugin: true` line from `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md`. Tell the user a plugin update restores the line, and that this skill notices and offers the fix on its next run (step 1).
2. Select the style, preserving every other key in the settings file: project-level style → set `"outputStyle": "<name>"` in `<project>/.claude/settings.local.json`; user-level style → set it in `~/.claude/settings.json`, or the user picks it under `/config` → Output style.
3. It takes effect at the next session.

To switch back to `Hush (stock)`: restore the `force-for-plugin: true` line in the plugin copy and remove the `outputStyle` selection.

If the user declines the takeover, the crafted file stays where it was written, inert until they activate it themselves.

## 6. Report

Where the file landed, what was or wasn't activated, when it takes effect, and that the crafted style is unmeasured — the benchmark numbers belong to stock Hush only.
