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

The description must end with the exact sentence `Unmeasured variant of Hush.` — step 1 depends on it, and it is what keeps a crafted style distinct from the presets hush ships. `force-for-plugin` stays out — activation adds it.

**Write the whole file in the voice.** Every section, top to bottom: the silence rules, the caps, the thoroughness rules, the worked example, Register. The reply comes out in the register the file is written in, so the sections that stay in stock's plain English are the ones that decide how the reply sounds. This single choice is the difference between a style that speaks in the voice and one that only names it.

What has to come through the rewrite intact, everywhere in the file:

- every number, at its exact value
- every `inline code` span and every `**bold**` span, character for character
- every listed exception and every shape-table row, one for one
- one paragraph for each paragraph — reword a rule, never drop it
- the first line above the first heading, and every `## ` heading text
- the quoted openers inside the self-narration ban
- verbatim: the paragraph about bracketed `[hush ...]` notes, and the paragraph about hook-injected reminders

Step 4 checks all of it mechanically.

Then three things, in this order:

1. **Put the redo line in Register.** Tell the model to read the finished message back and put it in the voice before sending, naming the two or three substitutions the voice turns on — `be` for is and are, `ye` for you, `-in'` for every -ing. A voice given as a step to carry out at write time reaches the reply; a voice merely described sits in the file.
2. **Give the voice its own words for the recurring things.** A fix is a mend, a bug is a leak, a file is a hold.
3. **Write the worked example fully in the voice.** It is the only reply the file shows, and the model writes what it was shown.

**Build a fixed line only when the user asks for one.** A required opening form, a closing line, a named section — each lands in every single reply, more reliably than anything else in the file. That makes it the right tool when someone wants a heading on every report, and the wrong one otherwise: the voice is what they asked for, and a label nobody requested is not the voice. Ask before adding one.

Rules for the rewrite:

- State every rule as the action to take, in positive form.
- An exception says what it grants, and stops there.
- Keep a clause that identifiers, paths, and error text stay verbatim, whatever the voice does.
- The worked example must itself obey every cap.

Two things to say out loud when the requested voice is an old or ornate one — early-modern English, a heavily inflected register. It arrives about half the time, where a voice built on word substitution arrives every time. And a heavy one will sometimes reach for its own word in place of the technical term the reader came for. Build it, and tell the user which half they are getting.

The mid-turn silence itself does not depend on any of this. It is re-stated at run time by `hooks/silence-nudge.js`, which is part of the plugin, not the style — so a crafted voice cannot weaken it, and a crafted style stays as quiet as stock.

## 4. Verify mechanically

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-style.js" "${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md" <new-style-file>
```

It lists every invariant that didn't survive. Fix the file and re-run until it exits 0.

## 5. Activate — only with the user's consent

A style delivered through `force-for-plugin: true` binds; the same content merely selected in settings under-delivers on the mechanics it copied. So ask the user first, every time — and if they say yes, run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/activate-style.js" "<the file you just wrote>"
```

This is the same mechanical swap `hush:pick-style` uses — one script, called from both skills, so the procedure never drifts between them.

If the user declines the takeover, the crafted file stays where it was written, inert until they activate it themselves.

## 6. Report

Where the file landed, what was or wasn't activated, when it takes effect, and that the crafted style is unmeasured — the benchmark numbers belong to stock Hush only.
