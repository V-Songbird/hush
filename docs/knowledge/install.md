---
type: knowledge
summary: "How to install Hush in Claude Code, check that it worked and update it to a new release; Hush has no Codex or Antigravity package."
related_files:
  - README.md
  - .claude-plugin/plugin.json
---

# Install and update Hush

This page says how to install Hush, how to tell it worked and how to move to a new release. The short form is in the README, under [Install](../../README.md#install).

Hush works in Claude Code only. It has no Codex package and no Antigravity package.

## Claude Code

You need Claude Code 2.1.323 or later, and Node.js 22 or later.

Inside Claude Code, run:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Then start a new session.

To check that it worked, run `claude plugin list` in a terminal. The list names `hush`. Then run `/hush:config`: the configurator opens, or its questions start in a terminal.

An older Claude Code may still install Hush, but it is not tested there.

## Update

In Claude Code, run these. Then start a new session:

```text
/plugin marketplace update foundry
/plugin update hush@foundry
```
