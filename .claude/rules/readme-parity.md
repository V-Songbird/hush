---
paths:
  - "**/README.md"
  - "**/docs/BENCHMARKS.md"
  - "**/assets/*.svg"
---

# Coordinated plugin READMEs

This contract applies to Claude/Codex editions. A plugin's main branch is a
four-file edition selector, checked by check-main-frontpage.js; it does not
carry these exception blocks or benchmark sections. Flint is outside that cleanup.

For each plugin, Claude and Codex share the same product purpose, narrative,
headings, section order, common outcomes and decorative branding. A platform
change does not authorize a different product pitch or scope. This rule governs
README parity and benchmark presentation when older template wording conflicts.

The only bounded `foundry:platform` exceptions are `identity`, `install`,
`commands`, `compatibility`, `benchmarks` and `links`. Use them only for native
platform differences, actual edition availability, measured evidence and valid
edition-specific destinations. Keep main headings outside the exceptions.
Changes to common text belong in both editions in the same coordinated change.

Keep benchmark questions, metrics and table columns identical between editions.
Model and setup rows, values, empirical charts and recorded examples may vary
with the evidence. Identify the actual host, model, source and date. Preserve
losses and measurement limits. Never turn Claude results into Codex results by
renaming a model, and never treat unit tests as a comparative performance run.
Show `Not measured` when equivalent evidence is absent; an unavailable package
must say so. Research and extensive methodology belong in Foundry's central
documentation; product usage and plugin decisions belong with the plugin.

Before considering a README change or release ready:

- Run `node scripts/git-hooks/check-readme-parity.js --check README.md` in the
  plugin checkout. Pass `--expect Claude` or `--expect Codex` in CI.
- In Foundry, run `--pair <Claude-README> <Codex-README>` against the two working
  copies, or `--git-pair <plugin-repo> <Claude-ref> <Codex-ref>` for committed
  revisions. Find existing checkouts with `git worktree list`; preserve their work.
- Check navigation with `check-readme-nav.js` and review sources for every claim.
  The parser verifies declarations, not the truth of the underlying measurements.

Keep skills, review criteria and checks aligned in both native locations.
The authoring skill is `coordinate-readmes`. Do not run paid benchmarks,
install plugins, publish or create commits merely to fill an evidence gap.
Common README changes in separate platform PRs use the reciprocal PR/SHA
protocol in `.github/README_COORDINATION.md`. A candidate-pair check does not
replace the final integrated-branch comparison before selectors or pins publish.
