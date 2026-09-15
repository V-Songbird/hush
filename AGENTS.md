## One package on main

`main` is hush's Claude Code plugin. Develop on a topic branch and merge into
`main` through a pull request; the `Claude` and `Codex` branches are history.
Hush has no Codex package: do not add Codex manifests, hook registrations or
installation steps unless a Codex port is decided and validated. The version
lives in `.claude-plugin/plugin.json`. README results come from Claude Code
sessions and are never presented as Codex results.

## Benchmark ownership

Benchmark runners, datasets, measurement tests and experiments for this collection
live in the Foundry benchmarks/<plugin>/ directory. Keep functional product tests
here; do not recreate a benchmarks/ or .benchmarks/ tree in the plugin. Local
maintenance output and backups belong in the Foundry .scratch/ directory.
