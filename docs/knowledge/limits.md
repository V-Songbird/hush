---
type: knowledge
summary: "Every current limit of Hush and what it means for a user: short answers, cost, a requested shape, the output style slot, temporary saved output and the optional desktop mod."
related_files:
  - README.md
  - output-styles/hush.md
---

# Hush limits

This page lists every current limit of Hush and what it means for you. The README names the four that matter most, under [Good to know](../../README.md#good-to-know).

| Limit | What it means for you |
| --- | --- |
| A short answer can leave out a detail | Correctness comes before brevity. Ask for depth when you need it, and check the result before you act on it. |
| Hush is not a token saver | The voice rides in every request, and Hush cost more than no plugin on Claude Opus 5.5 and Claude Sonnet 5.5. The current release is not measured; [Hush benchmarks](benchmarks.md#where-hush-loses) gives each batch's model, date and size. |
| The shape is asked for, not enforced | The assistant follows the voice most of the time, not always. [Hush benchmarks](benchmarks.md) says how often. |
| Progress notes still appear | The measured 1.13.0 voice asked for silence between steps. The current voice does not, so expect progress notes. In the Claude desktop app, the fold hides them. |
| The voice takes the one output style slot | To use another output style in Claude Code, disable or uninstall Hush. |
| Saved output is temporary | Hush deletes it when the session ends. On Windows, treat the saved files as readable by anything that runs as you. |
| The desktop mod is optional | It draws only in the Claude desktop app. No rendered check of it is published. |
