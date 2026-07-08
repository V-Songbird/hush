# Contributing

This plugin is part of the [Songbird Collection](https://github.com/V-Songbird/claude-plugins) and is maintained by a single author. Contributions are welcome in the form of bug reports, suggestions, and pull requests.

---

## Before opening a PR

- Check existing issues first — the problem may already be tracked or intentionally deferred.
- For substantial changes (new skills, significant refactors), open an issue first to align on direction before writing code.

---

## Structure

```
.claude-plugin/
└── plugin.json        # name, description, author, keywords — NO version
                        # field (the version is owned by claude-plugins'
                        # .claude-plugin/marketplace.json)
CHANGELOG.md            # Keep a Changelog format
LICENSE                 # MIT
README.md               # plain-language intro first, technical depth after
skills/                 # if the plugin has skills
├── skill-name/
│   ├── SKILL.md        # Claude Code skill definition
│   └── references/     # Reference files loaded by the skill
hooks/
└── hooks.json          # Hook event wiring (PreToolUse, PostToolUse, etc.)
scripts/                # if the plugin has helper CLIs
└── tests/              # required when the plugin has scripted behavior
```

Every README shares one skeleton, tone, and style, defined in claude-plugins' [`.github/PLUGIN_README_TEMPLATE.md`](https://github.com/V-Songbird/claude-plugins/blob/main/.github/PLUGIN_README_TEMPLATE.md).

---

## What to keep in mind

**Skills are Claude-facing instruction files.** Changes to `SKILL.md` affect how Claude interprets a skill — be precise, and test manually by invoking the affected skill in a real session before submitting.

**Hooks are scripts that run on every tool call or session event.** Keep them fast (no network, no blocking I/O) and test on both Unix and Windows.

---

## Tests

If this plugin has scripted behavior, run its tests before submitting:

```
node --test tests/*.test.js
```

PRs that change script behavior without updating tests will not be merged.

---

## Git hooks

Run this once after cloning:

```
git config core.hooksPath scripts/git-hooks
```

This enables a `pre-commit` hook that runs `node --test tests/*.test.js` and blocks the commit on failure. It no-ops if this plugin has no `tests/` directory.

---

## Changelog

Add an entry to `CHANGELOG.md` under `[Unreleased]` for every user-visible change. Follow the [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. Version bumps and marketplace listing changes happen in [claude-plugins](https://github.com/V-Songbird/claude-plugins), not here.

---

## Code of conduct

This project follows the [Contributor Covenant 2.1](./CODE_OF_CONDUCT.md).
