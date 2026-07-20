---
name: craft-style
description: Builds a personal output style on hush's frame — the user's voice on the surface, hush's silence-and-structure mechanics copied verbatim underneath. Manages its own creations: lists them alongside stock Hush and edits them. A mechanical verifier confirms every invariant survived. Activation is hush:pick-style's job — it owns the swap that makes a style bind. Only the stock Hush style is benchmarked — crafted styles are unmeasured.
when_to_use: Trigger when the user wants a personal or custom output style built on hush, wants to edit or switch a crafted style, says "make me a hush style", "hush but robotic", "craft a style", "custom output style", or invokes /hush:craft-style.
argument-hint: "[voice description]"
allowed-tools: Read, Write, Edit, Glob, Grep, Bash, PowerShell, AskUserQuestion
---

# hush:craft-style

Builds and manages output styles the user owns: their voice, hush's machinery. The mechanics that make hush cheap — silence between tool calls, one structured final message, the hard caps — are copied byte for byte. The voice around them is rewritten to the user's taste.

## 1. Take stock

Crafted styles carry the sentence `Unmeasured variant of Hush.` in their frontmatter description — that is how this skill recognizes its own work. Scan `~/.claude/output-styles/*.md` and `<project>/.claude/output-styles/*.md` for it.

The presets hush ships say `Unmeasured preset shipped with Hush.` instead and live under `${CLAUDE_PLUGIN_ROOT}/styles/`. They are never this skill's work; `hush:pick-style` lists them.

Also read the frontmatter of `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md` and note whether the `force-for-plugin: true` line is present.

Then route:

- **No crafted styles found** → go to step 2 and create one.
- **Crafted styles found** → ask the user (AskUserQuestion) what to do, listing every crafted style by name and destination alongside `Hush (stock, benchmarked)`: create a new style, edit one of the listed, or switch which style is active (step 5 handles the switch).
- **A `hush.md.stock` backup exists but the plugin's `hush.md` carries no `Unmeasured` sentence at all** → a plugin update restored stock over a takeover. Say so and offer step 5 before anything else. If `hush.md` carries the shipped-preset sentence instead, a preset holds the slot — that is `hush:pick-style`'s business, not a lost takeover.

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

The description must end with the exact sentence `Unmeasured variant of Hush.` — step 1 depends on it, and it is what keeps a crafted style distinct from the presets hush ships. `force-for-plugin` stays out — that key belongs to the plugin's own copy only.

Copy these VERBATIM, byte for byte:

- the first line above the first heading — the one-message-per-turn rule
- the entire **Mid-turn silence**, **Thoroughness**, and **Never compress** sections
- every `## ` heading, with its exact text
- in **Final message**: the shape table and every bolded cap bullet
- in **Register**: the paragraph about bracketed `[hush ...]` notes and the paragraph about hook-injected reminders

Rewrite the rest in the requested voice — the opening voice line under that rule, the prose around the table and caps in **Final message**, the worked example, the **Word economy** body, the rest of **Register**.

Rules for the rewrite:

- **Name the voice outright, in a sentence of its own in Register.** Writing the rules *in* the voice changes how the rules read, not how the reply sounds — a style whose prose was rewritten but whose voice was never stated produced replies indistinguishable from stock. Say what every final message should sound like.
- State every rule as the action to take, in positive form.
- An exception says what it grants, and stops there.
- Every number keeps its value.
- Keep a clause that identifiers, paths, and error text stay verbatim, whatever the voice does.
- The worked example must itself obey every cap, and must be written in the voice.

The mid-turn silence itself does not depend on any of this. It is re-stated at run time by `hooks/silence-nudge.js`, which is part of the plugin, not the style — so a crafted voice cannot weaken it, and a crafted style stays as quiet as stock.

## 4. Verify mechanically

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-style.js" "${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md" <new-style-file>
```

It lists every invariant that didn't survive. Fix the file and re-run until it exits 0.

## 5. Activate — only with the user's consent

A style delivered through `force-for-plugin: true` binds; the same content merely selected in settings under-delivers on the mechanics it copied. So ask the user first, every time — and if they say yes, swap.

`hush:pick-style` holds the one copy of that swap. Read `${CLAUDE_PLUGIN_ROOT}/skills/pick-style/SKILL.md` and follow its step 3 with the file you just wrote as the chosen style, or hand the user off to `/hush:pick-style`. Never restate the procedure here — one description of it, in one place.

If the user declines the takeover, the crafted file stays where it was written, inert until they activate it themselves.

## 6. Report

Where the file landed, what was or wasn't activated, when it takes effect, and that the crafted style is unmeasured — the benchmark numbers belong to stock Hush only.
