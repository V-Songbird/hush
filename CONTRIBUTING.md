# Contributing

This plugin is part of the [Foundry Collection](https://github.com/V-Songbird/foundry) and is maintained by a single author. Contributions are welcome in the form of bug reports, suggestions, and pull requests.

---

## Before opening a PR

- Check existing issues first — the problem may already be tracked or intentionally deferred.
- For substantial changes (a new hook, a new message setting, significant refactors), open an issue first to align on direction before writing code.

---

## Structure

`main` holds the plugin: one package for Claude Code, developed and released from this branch. Hush has no Codex package.

```
.claude-plugin/
└── plugin.json        # name, version, description, author, keywords
.github/workflows/      # test.yml: the suite on Linux and Windows
assets/                 # README images
commands/
└── config.md          # /hush:config
hooks/
├── hooks.json          # Hook event wiring (SessionStart, PreToolUse, PostToolUse, etc.)
├── *.js                # one script per hook
└── lib/                # gate, harness, sidecar store and transforms
modules/                # one rule per moved message setting, <setting>-<value>.md
output-styles/
└── hush.md             # the shipped voice
scripts/                # git-hooks/: the commit gates
tests/                  # node:test suite, with contract/ and fixtures/
widgets/
└── config.html         # the /hush:config configurator and its preview
docs/knowledge/         # how it works, settings, benchmark details and the
                        # changelog, with "Unreleased" first, then releases
AGENTS.md               # contributor rules; CLAUDE.md imports them
CODE_OF_CONDUCT.md
CONTRIBUTING.md
LICENSE                 # MIT
README.md               # plain-language intro first, technical depth after
SECURITY.md
```

The README puts plain-language sections first and technical depth behind links; [`AGENTS.md`](AGENTS.md) holds the rules for results and host labels.

---

## What to keep in mind

**Hooks are scripts that run on every tool call or session event.** Keep them fast (no network, no blocking I/O) and test on both Unix and Windows.

---

## Tests

If this plugin has scripted behavior, run its tests before submitting:

```
node --test tests/*.test.js
```

CI runs the suite on Linux and Windows with Node 22. PRs that change script behavior without updating tests will not be merged.

---

## Git hooks

Run this once after cloning:

```
git config core.hooksPath scripts/git-hooks
```

This enables a `pre-commit` hook that runs `node --test tests/*.test.js` and blocks the commit on failure. It no-ops if this plugin has no `tests/` directory. It also blocks a commit that stages a Markdown file while the root `README.md` lacks its navigation line, or while a link to a heading anchor in any tracked Markdown file no longer resolves.

hush, razor and foreman keep byte-identical copies of `pre-commit`. A change to one goes into all three.

---

## Changelog

Add user-visible changes to the `## Unreleased` section at the top of [`docs/knowledge/changelog.md`](docs/knowledge/changelog.md), in plain prose. The release commit renames that heading to `## <version> — <date>` and bumps the version in `.claude-plugin/plugin.json`. The [Foundry](https://github.com/V-Songbird/foundry) catalog pins the released `main` commit and carries no version for hush.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
