<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Shuts Claude up so your session stops costing money to read.</strong></p>
</div>

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](./LICENSE) [![Claude Code](https://img.shields.io/badge/Claude_Code-E5582B)](https://docs.anthropic.com/en/docs/claude-code)

---

## What is this?

You've seen it: "Let me start by looking at the codebase." "Now I'll check the config." Four hundred lines of build output you didn't ask for, followed — eventually — by the one sentence you actually needed. Every word of that is billed. All of it.

hush doesn't ask Claude to "be more concise" and hope for the best. It trims the actual bulk — logs, command output, narration — at the source, as it happens, before any of it hits your bill.

It's built for real engineering sessions — the kind that read logs, run builds, and dig through output — because that's where the noise actually lives.

## Why you'd want it

- **Cheaper sessions.** It shrinks the two biggest sources of bulk — noisy output and narration — so long sessions cost less.
- **Easier to read.** The answer sits at the top of one final message, not buried in a play-by-play.
- **Nothing important is lost.** Failing command output, code, diffs, and security warnings are kept whole.
- **Zero setup.** Install it and it's on. Tune it later only if you feel like it.

## How it works

Four small habits, picked up the moment it's installed:

| Moment | What happens |
| --- | --- |
| Progress narration | Swapped for one clean summary at the end, not a running commentary |
| Command output & log files | Trimmed as it comes in — a short tail from a clean run, the whole thing from a failing one |
| Mid-turn rambling | Caught by a running word count and cut off the moment it starts |
| Really large output (a huge log, a giant lockfile) | Moved to a local file behind a short summary, so it's not re-sent in full every turn |

That's the whole list. No workflow to learn, no dial to find first — it's just how Claude behaves now.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Takes effect at your next session. There's nothing to invoke — hush just works in the background.

## Benchmarks

We put hush up against plain Claude Code and a plugin that just tells Claude to talk less, on real engineering work — full agent sessions that explore, edit, and run code, not a single canned reply. Same jobs, phrased the way a developer actually types them, real cost read straight from the API.

<p align="center"><img src="assets/bench-hero.svg" alt="Average session cost across the suite: no plugin $0.226, a 'be brief' plugin $0.214, hush $0.169 — hush is about 25% cheaper, roughly 5x what 'just be brief' manages" width="700"></p>

**Being brief isn't enough.** Across the suite, hush cut the average session about **25%**, while a plugin that just tells Claude to talk less managed ~5%. Turns out asking politely and actually doing the work are two different things.

<p align="center"><img src="assets/bench-anatomy.svg" alt="Where a real session's money goes: almost the whole bill is what Claude reads — files, logs, command output — and under 5% is the reply. A 'be brief' plugin can only trim that sliver; hush works on the other 95% too" width="700"></p>

**Almost the whole bill is what Claude *reads*,** not what it writes back — about 21x more, in our sessions. Shortening the reply polishes a sliver. hush trims the noisy output and bulky logs before they hit your bill.

<p align="center"><img src="assets/bench-sidecar.svg" alt="A multi-turn debugging session — triage an outage, look up a version in a huge lockfile, write a handoff: no plugin $0.47, a 'be brief' plugin $0.42, hush $0.29 — about 39% cheaper" width="700"></p>

**It shows most in longer sessions.** Drag a huge file into a multi-turn conversation and that bulk gets re-sent every turn. hush keeps a tidy summary in the chat and the full copy one click away — a real multi-turn incident session came in about **39% cheaper**, where being brief barely moved it.

<p align="center"><img src="assets/bench-chatter.svg" alt="Words of play-by-play before the answer, fixing a real bug: no plugin 39 words, a 'be brief' plugin 23, hush 15 — hush is about 2.6x quieter, and the answer lands in one message at the end" width="700"></p>

**And it's quieter.** The answer lands in one clean message at the end instead of a running commentary — a brief check-in only when Claude settles a diagnosis or starts a long build.

### The full picture

Every job, every setup — the wins **and** the ties and losses. Cheapest per row in **bold**.

| What Claude did | no plugin | "be brief" | hush |
| --- | --- | --- | --- |
| Triage a production outage log | $0.29 | $0.29 | **$0.15** |
| Multi-turn incident + write the handoff | $0.47 | $0.42 | **$0.29** |
| Track a pool leak through two logs | $0.25 | $0.23 | **$0.19** |
| Fix a failing test suite | $0.20 | **$0.13** | $0.15 |
| Summarize a repo | **$0.12** | **$0.12** | $0.13 |
| Find the error in a noisy build | **$0.18** | $0.23 | $0.20 |
| Answer a code question (no tools) | **$0.07** | $0.07 | $0.08 |
| **Average** | $0.23 | $0.21 | **$0.17** |

Every job passed its correctness check in every setup — compression never bought a cheaper-but-wrong answer.

> [!NOTE]
> hush wins where there's noise to cut — logs, long sessions, debugging — and roughly ties on short or low-output jobs, where a session's fixed overhead dwarfs anything a plugin can trim. On a couple it costs a hair more; that's the honest shape, and it's why the average is what to read.

*How we tested: the same jobs, three setups, several runs each in fresh throwaway workspaces, on Sonnet — a full multi-turn agent session every time, never a single generated reply — costs from the API, not estimates. Numbers move a few percent between runs. Reproduce it yourself — see [benchmarks/](benchmarks/).*

## Compress a memory file

`/hush:hush-compress <path>` shrinks a `CLAUDE.md` or notes file into a tighter form, so every future session that loads it costs a little less.

> [!IMPORTANT]
> It never touches your original — it writes a copy alongside it (`CLAUDE.md` → `CLAUDE.hush.md`) for you to review and swap in yourself.

## Under the hood

Every check above runs locally as Claude works — read the plugin's files if you want the exact mechanics. Pairs naturally with [razor](https://github.com/V-Songbird/razor): razor cuts the code and the cost, hush cuts the noise. Run both and neither notices the other — measured together, they add no overhead of their own.

## Settings

Most people never touch these, but a few environment variables tune the caps or turn parts off:

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Turns the hooks off |
| `HUSH_CAP_PASS=60` | Lines kept from successful command output |
| `HUSH_CAP_FAIL=250` | Lines kept from failing output |
| `HUSH_NARRATION_BUDGET=120` | Words of narration before a gentle nudge |
| `HUSH_WRAP=1` | Captures real exit codes from shell commands in permission-checked sessions — needs blanket `Bash`/`PowerShell` permission rules (no command pattern); sessions that bypass permissions get this automatically |
| `HUSH_NOTE=off` | Skips the one-time per-session note that tells the model hush's compression markers are trusted tooling |
| `HUSH_SUBAGENT=off` | Stops extending the terse-report style to spawned subagents |
| `HUSH_ADAPTIVE=off` | Keeps compression caps fixed instead of tightening them in very long sessions |
| `HUSH_SIDECAR=off` | Keeps very large outputs inline instead of moving them to a local file behind a digest |
| `HUSH_SIDECAR_MIN=15000` | Size (characters) at which an output moves to a sidecar file |
| `HUSH_SIDECAR_SHELL_MAX=28000` | Above this size, a command's output stays inline (past here the terminal already keeps its own copy) |
| `HUSH_COMPACT=off` | Stops shaping the compaction summarizer's format instructions |
| `HUSH_TEMPLATE=off` | Stops collapsing runs of same-shaped log lines (e.g. repeated worker/job entries) into one example line + a count |
| `HUSH_DEBUG=1` | Appends a per-decision JSON line to a temp-dir manifest file for every tool output hush looks at — for debugging and benchmark tooling, not everyday use |

## License

MIT — see [LICENSE](./LICENSE).
