---
status: closed — the hush Codex port is not being built (2026-08-18)
---

# Compress shell output before Codex history

> **Closed 2026-08-18.** This ADR proposed the routing design for a
> `hush-codex` sibling that is not being built. It described the right
> architecture for the port; the port itself was cut. See
> [the dossier README](https://github.com/V-Songbird/foundry/blob/main/docs/hush/research/codex-port-dossier.md) for the reasoning. Reopening the port is a
> fresh decision, not a resumed one — the design below is a 2026-07-20 snapshot
> of a hush that has changed underneath it.

The Codex sibling will route noisy shell commands through a source-capture runner instead of waiting for `PostToolUse` result replacement. Current Codex replacement forms are either unsupported, retain the original, or convert the result into hook-error feedback, while the runner prototype reduced history input and preserved full failure evidence. First-call routing is the normal path; pre-tool denial/retry is the safety fallback, and automatic approval-bearing rewrites are excluded by default.
