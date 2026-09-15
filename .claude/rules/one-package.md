# One package on main

`main` is hush's package branch: the Claude Code plugin, developed and released
from here. Make changes on a topic branch and merge them into `main` through a
pull request. The separate editions ended with the Claude edition's 1.11.8
release, and their `Claude` and `Codex` branches were deleted on 2026-09-15.

Hush has no Codex package. Do not add a `.codex-plugin/` manifest, a Codex hook
registration or Codex installation steps unless a Codex port is decided and
validated. Until then the README keeps Codex marked as not available.

The version lives in `.claude-plugin/plugin.json`. Bump it in the release
commit. Foundry's Claude catalog pins that `main` commit and carries no version
for hush.

README results name their host, model, source and date. The recorded results
come from Claude Code sessions; never present them as Codex results.
