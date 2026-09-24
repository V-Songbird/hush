# hush

hush is a Claude Code plugin that quiets narration, trims tool output and shapes the final answer
around the result. Its hooks and scripts are dependency-free Node.js and run with Node.js 22 or
later; there is no install or build step. This repository is Foundry's hush submodule, ships from
`main`, and has no Codex package.

## Start here

- Before changing a hook or the shipped voice, read [how hush works](docs/knowledge/how-it-works.md).
- Before changing a switch or the style slot, read [settings](docs/knowledge/settings.md).
- Before touching a README number, read [the benchmark details](docs/knowledge/benchmarks.md); every published number belongs to the shipped voice with `HUSH_WRAP=1`.
- Before a release, read [the changelog](docs/knowledge/changelog.md) and [CONTRIBUTING.md](CONTRIBUTING.md).

## Rules that outrank everything

- One package on `main` for Claude Code. Do not add a `.codex-plugin/` manifest, a Codex hook registration or Codex installation steps unless a Codex port is decided and validated; the README keeps Codex marked as not available.
- The version lives in `.claude-plugin/plugin.json`; bump it in the release commit. Foundry's Claude catalog pins the `main` commit and carries no version for hush.
- README results name their host, model, source and date. They come from Claude Code sessions; never present them as Codex results.

## Commands

| Command | Purpose | Cost |
| --- | --- | --- |
| `node --test tests/*.test.js` | The suite | Local temporary fixtures |
| `node scripts/git-hooks/check-readme-nav.js` | The root README has its nav, and every heading anchor linked from a tracked Markdown file resolves | Local |
| `claude plugin validate .` | Claude Code package shape | Local |
| `git config core.hooksPath scripts/git-hooks` | One-time: the pre-commit hook runs the suite and the nav check | Local |

## Where things live

| Path | Content |
| --- | --- |
| `hooks/` | The session hooks: `compress-tool-output`, `silence-nudge`, `precompact-summary`, `postcompact-rearm`, `preserve-exit-code`, `session-end-cleanup`, `subagent-brief`; `lib/` holds the gate, the harness, the sidecar store and the transforms |
| `output-styles/hush.md` | The shipped voice; `/hush:pick-style` writes `hush.md.stock` and `hush.md.active.json` beside it at run time, both ignored |
| `scripts/` | `activate-style.js`, `list-styles.js` and `verify-style.js` behind the two skills; `git-hooks/` holds the commit gates |
| `skills/` | `craft-style` and `pick-style` |
| `tests/` | The `node:test` suite, with `contract/` and `fixtures/` |
| `docs/knowledge/` | How it works, settings, benchmark details and the changelog |

## Conventions

Benchmark runners, datasets and experiments are not part of the package; `tests/` holds
functional tests only. `CLAUDE.md` imports this file; keep shared contributor facts here.

## Pitfalls

- **Claude Code guards the output of a failing command.** hush trims it only when the session no longer asks for per-step approval or `HUSH_WRAP=1` is set, which is the setup every published number used.
- **Updating the plugin puts the shipped voice back in the slot.** A picked voice needs picking again.
- **A passing nav check verifies anchors, not measurements.** Review the source of every README claim before calling a change ready.
