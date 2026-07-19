---
name: craft-style
description: Builds a personal output style on hush's frame — the user's voice on the surface, hush's silence-and-structure mechanics copied verbatim underneath. Writes into the user's own output-styles directory, never into the plugin; a mechanical verifier confirms every invariant survived. Only the stock Hush style is benchmarked — crafted styles are unmeasured.
when_to_use: Trigger when the user wants a personal or custom output style built on hush, says "make me a hush style", "hush but robotic", "craft a style", "custom output style", or invokes /hush:craft-style.
argument-hint: "[voice description]"
allowed-tools: Read, Write, Bash, PowerShell
---

# hush:craft-style

Builds a new output style the user owns: their voice, hush's machinery. The mechanics that make hush cheap — silence between tool calls, one structured final message, the hard caps — are copied byte for byte. The voice around them is rewritten to the user's taste.

## 1. Gather three inputs

From the invocation arguments, or by asking:

- **Voice** — how the style should sound, in the user's words ("robotic", "pirate", "extremely dry British").
- **Name** — a short style name; derive one from the voice if the user doesn't care.
- **Destination** — `~/.claude/output-styles/` (every project) or `<project>/.claude/output-styles/` (this project only). Default to user-level.

The filename is the kebab-cased name plus `.md`. If that file already exists, show its path and ask before overwriting.

## 2. Read the frame

Read `${CLAUDE_PLUGIN_ROOT}/output-styles/hush.md`. Everything below refers to its sections.

## 3. Assemble the new style

Frontmatter:

```yaml
---
name: <Name>
description: <one line in the user's voice>. Unmeasured variant of Hush.
keep-coding-instructions: true
---
```

`force-for-plugin` stays out — that key belongs to the plugin's own copy only.

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

## 5. Report

Where the file landed, that `/output-style` activates it, and that the crafted style is unmeasured — the benchmark numbers belong to stock Hush only.
