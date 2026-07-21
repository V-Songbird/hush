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

**Write the whole file in the voice.** Every section, top to bottom: the silence rules, the caps, the thoroughness rules, the worked example, Register. When the voice needs an extra push — a distant register, a weak first draft — open the file with one line above the opening rule: `Core persona: <the voice in one sentence>.` Write that sentence as the speaking behavior itself, its register and signature markers named — "speaks every report in full, heavy pirate dialect, peppered with 'Arrr!'" — because a described behavior gets enacted where a role name alone sits inert. The reply comes out in the register the file is written in, so the sections that stay in stock's plain English are the ones that decide how the reply sounds. This single choice is the difference between a style that speaks in the voice and one that only names it.

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

1. **Put the redo line in Register.** Tell the model to read the finished message back and put it in the voice before sending, naming the two or three substitutions the voice turns on — `be` for is and are, `ye` for you, `-in'` for every -ing. A voice given as a step to carry out at write time reaches the reply; a voice merely described sits in the file. Anchor every substitution to something each reply contains: a function word anchors itself, and a particle or interjection anchors to a position — the first line and the last line each end in `nya~`. Write the position, not "where it falls natural" — a technical answer offers no natural place, and the particle drops out. When the style carries several mechanical caps — a word count, a line count, a banned block type — the redo grows into one numbered sequence with each cap as its own action, carried out in order. The sequence fires as a single pass; the same caps written as separate Register descriptions are skipped.
2. **Give the voice its own words for the recurring things.** A fix is a mend, a bug is a leak, a file is a hold. Kaomoji, an emoji, a short asterisk aside, an address for the reader — the same class; give each a position, and they cost almost nothing. A symbol that stands in for a whole word — an emote opening each line where the verb was — is the same class at full density: anchor it to its position, list each symbol's meaning in a small legend table, and name the structures it stays out of. A positioned marker breaks any markdown structure it lands inside — a table row or a fenced block takes no marker, and the style says so in one line. When the user wants chatty storytelling too, name its moves as quoted phrases with positions — a `guess what?` introducing the finding, a celebration line first — and write the worked example as the exact target reply; that lands the whole persona for ten or twenty words more.
3. **Write the worked example fully in the voice.** It is the only reply the file shows, and the model writes what it was shown. Set it in a domain the user's real tasks won't repeat — when an example shares the task's subject, its lines come back verbatim as the answer, in place of the analysis the reader needed.

**Build a fixed line only when the user asks for one.** A required opening form, a closing line, a named section — each lands in every single reply, more reliably than anything else in the file. That makes it the right tool when someone wants a heading on every report, and the wrong one otherwise: the voice is what they asked for, and a label nobody requested is not the voice. Ask before adding one. When one is wanted, write it unconditional — it closes every reply, with a miniature form for a one-fact answer. A slot that names the turns it applies to hands the model an exemption, and consultative replies take it.

Rules for the rewrite:

- State every rule as the action to take, in positive form.
- An exception says what it grants, and stops there.
- The never-compress list names artifact classes and nothing more. A condition added to one of its bullets — code *the user asked for* — reads as an offer to produce that artifact, and it starts appearing unasked.
- Keep a clause that identifiers, paths, and error text stay verbatim, whatever the voice does.
- The worked example must itself obey every cap.

Two things to say out loud when the requested voice is an old or ornate one — early-modern English, a heavily inflected register. It arrives about half the time, where a voice built on word substitution arrives every time. And a heavy one will sometimes reach for its own word in place of the technical term the reader came for. Build it, and tell the user which half they are getting.

One thing to say out loud when the style carries a required slot. It arrives on every reply from the larger models; from the smaller ones it arrives on report-shaped replies and only rarely on consultative planning replies, and neither wording nor hook delivery recovers that gap — measured. Tell the user which they are getting.

One thing to say out loud when the voice speaks in status tokens — a machine's `NOMINAL` and `FAULT`, a soldier's `mission complete`. Those words fire on tasks that end in a verdict and sit out explanations, and a register that terse reads much like stock Hush already. What makes such a voice land on every reply is a status line opening each one — that is a fixed line, so offer it and let the user decide.

Default to the smallest output the voice allows. When the requested voice inherently lengthens replies — a dialect's extra syllables, a persona's storytelling — tell the user the price while building, and give them the leaner cut of the same voice as the alternative.

**Maximum compression, only when the user asks for it.** The sections this skill guards carry stock's readability rules, and those rules are what keep a crafted style above telegram density. At the user's explicit request, build on the stripped frame instead: keep the opening rule, `Emit no text between tool calls`, errors `quoted exact`, identifiers `verbatim`, compression governing the report and `never the work`, the self-narration ban with its quoted openers, and the two verbatim Register paragraphs — then write the rest as pure telegram rules with a shape example. Verify with `--core` (step 4). Tell the user what they traded away: stock's readability guarantees, not its silence — the silence hooks are plugin-side and hold regardless.

The mid-turn silence itself does not depend on any of this. It is re-stated at run time by `hooks/silence-nudge.js`, which is part of the plugin, not the style — so a crafted voice cannot weaken it, and a crafted style stays as quiet as stock.

## 4. Verify mechanically

Run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/verify-style.js" "${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md" <new-style-file>
```

It lists every invariant that didn't survive. Fix the file and re-run until it exits 0.

For a maximum-compression style built on the stripped frame, append `--core` — it checks the core contract only and skips the readability anchors.

## 5. Activate — only with the user's consent

A style delivered through `force-for-plugin: true` binds; the same content merely selected in settings under-delivers on the mechanics it copied. So ask the user first, every time — and if they say yes, run:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/activate-style.js" "<the file you just wrote>"
```

This is the same mechanical swap `hush:pick-style` uses — one script, called from both skills, so the procedure never drifts between them.

If the user declines the takeover, the crafted file stays where it was written, inert until they activate it themselves.

## 6. Report

Where the file landed, what was or wasn't activated, when it takes effect, and that the crafted style is unmeasured — the benchmark numbers belong to stock Hush only.
