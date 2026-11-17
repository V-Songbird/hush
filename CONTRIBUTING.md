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
commands/
└── config.md          # /hush:config
hooks/
├── hooks.json          # Hook event wiring (SessionStart, PreToolUse, PostToolUse, etc.)
├── *.js                # one script per hook
├── voice-app.md        # the voice's app-only sections, sent by style-settings.js outside a terminal and claude -p
└── lib/                # gate, harness, sidecar store and transforms
modules/                # one rule per moved message setting, <setting>-<value>.md
output-styles/
└── hush.md             # the shipped voice
scripts/                # git-hooks/: the commit gates
tests/                  # node:test suite, with contract/ and fixtures/
widgets/
└── config.html         # the /hush:config configurator and its preview
CONTRIBUTING.md
LICENSE                 # MIT
README.md               # the front page: what Hush does, install, limits and the lead results
SECURITY.md
assets/                 # the README and docs art, copied from the brand kit
docs/knowledge/         # how-it-works.md, settings.md and benchmarks.md
```

The README is the front page. `docs/knowledge/how-it-works.md` holds the whole mechanism, `settings.md` every setting and `benchmarks.md` every published measurement. A fact lives in one place: the README states the short form and links the page. Every published number belongs to the voice shipped when its batch ran, measured with `HUSH_WRAP=1`, and names its host, model and date. Hush has no Codex package and the README says so.

---

## What to keep in mind

**Hooks are scripts that run on every tool call or session event.** Keep them fast (no network, no blocking I/O) and test on both Unix and Windows.

---

## Tests

If this plugin has scripted behavior, run its tests before submitting:

```
node --test tests/*.test.js
```

The desktop mod's own tests, `hooks/*.test.ts(x)`, run with `claude plugin test .`, which needs a Claude Code CLI with mods switched on, so CI does not run them. `claude plugin validate .` checks the package shape.

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

## Release notes

Release notes live on the [releases page](https://github.com/V-Songbird/hush/releases), written in plain prose when a release is cut. The release commit bumps the version in `.claude-plugin/plugin.json`. The [Foundry](https://github.com/V-Songbird/foundry) catalog pins the released `main` commit and carries no version for hush.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
