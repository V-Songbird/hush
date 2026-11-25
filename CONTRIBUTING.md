# Contributing

Hush is part of the [Foundry marketplace](https://github.com/V-Songbird/foundry) and has a single maintainer. Contributions are welcome as bug reports, suggestions and pull requests.

One package serves Claude Code. Hush has no Codex or Antigravity package.

---

## Before opening a PR

- Check existing issues first. The problem may already be tracked or deliberately deferred.
- For a substantial change, such as a new hook, a new message setting or a significant refactor, open an issue first to agree on direction.
- Branch from `main` and open the pull request against `main`.

---

## Structure

```text
.claude-plugin/
└── plugin.json        # name, version, description, author, keywords
.github/
└── workflows/
    └── test.yml       # CI: manifest check, nav check and suite; private-details scan of pull requests
commands/
└── config.md          # /hush:config
hooks/
├── hooks.json         # hook event wiring and the desktop mod
├── *.js               # one script per hook
├── register.tsx       # the desktop mod, with fold.ts, which decides what folds
├── voice-app.md       # the voice's app-only sections, sent by style-settings.js outside a terminal and claude -p
└── lib/               # gate, harness, sidecar store and transforms
modules/               # one rule per moved message setting, <setting>-<value>.md
output-styles/
└── hush.md            # the shipped voice
scripts/
└── git-hooks/         # the commit gates and the README nav check
tests/                 # node:test suite, with contract/ and fixtures/
types/
└── index.d.ts         # the mod's types
widgets/
└── config.html        # the /hush:config configurator and its preview
CONTRIBUTING.md        # this file
SECURITY.md            # how to report a vulnerability
LICENSE                # MIT
README.md              # the front page: what Hush does, install, limits and the lead results
assets/                # the README and docs art, copied from the brand kit
docs/
└── knowledge/         # how-it-works.md, settings.md and benchmarks.md
```

The README is the front page. The pages under `docs/knowledge/` hold the detail it links, and a fact lives in one place: the README states the short form and links the page.

---

## What to keep in mind

**Hooks are scripts that run on every tool call or session event.** Keep them fast, with no network and no blocking I/O. Test them on both Unix and Windows.

**Published figures follow one rule.** Each result names its host, model, date and sample size. Losses and limits stay, a host with no results shows `Not measured`, and a result from one host never stands for another.

**Every published number names its release and was measured with `HUSH_WRAP=1`.** Name the voice release it measured, its host, its model and its date. Hush has no Codex or Antigravity package, and the README says so.

---

## Tests

Run the tests before submitting:

```bash
node --test tests/*.test.js
node scripts/git-hooks/check-readme-nav.js
```

A pull request that changes behavior without updating its tests is not merged.

CI runs on every push and pull request to `main`. Its `Suite` job runs on Linux and Windows with Node 22. It parses `.claude-plugin/plugin.json` and `hooks/hooks.json`, fails if a `benchmarks/` folder is tracked, runs the nav check and runs the suite. Its `Private details` job scans each pull request for private details. The `test` job passes only when both succeed.

Validate the package for Claude Code when you can:

- `claude plugin validate .` checks the package shape.
- `claude plugin test .` runs the desktop mod's own tests, `hooks/*.test.ts(x)`. It needs a Claude Code CLI with mods switched on, so CI does not run them.

---

## Git hooks

Run this once after cloning:

```bash
git config core.hooksPath scripts/git-hooks
```

This enables a `pre-commit` hook that runs `node --test tests/*.test.js` and blocks the commit on failure. It also blocks a commit that stages a Markdown file while the root `README.md` lacks its navigation line, or while a link to a heading anchor in any tracked Markdown file no longer resolves.

Every Foundry plugin keeps byte-identical copies of the commit gates under `scripts/git-hooks/` and of the tests that cover them. A change to one goes into all of them.

Keep credentials and personal session data out of commits.

---

## Release notes

Release notes live on the [releases page](https://github.com/V-Songbird/hush/releases). Describe every user-visible change in your pull request, so it can go into the next release's notes.

The release commit bumps the version in `.claude-plugin/plugin.json`. The [Foundry](https://github.com/V-Songbird/foundry) catalog pins the released `main` commit and repeats that version.

A pull request never changes a contributor's installed plugins or personal configuration.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). To report behavior that goes against it, contact the maintainer privately through the address in [SECURITY.md](SECURITY.md).
