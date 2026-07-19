<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Shuts Claude up so your session stops costing money to read.</strong></p>

  <img src="assets/bench-narration.svg" alt="Every session in the benchmark suite drawn as a waveform, one spike per run, amplitude is words of play-by-play before the answer. The no-plugin lane spikes across half the suite and peaks at 76 words, silent in 17 of 32 sessions. The hush lane is close to a flat line — silent in 26 of 32, with most of the remaining spikes on the bug-hunting tasks" width="700" />

  <p><em>This is what a session sounds like.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/hush/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/hush?style=social" alt="GitHub stars"/></a>
    <a href="https://https://github.com/V-Songbird/hush/blob/main/LICENSE"><img src="https://img.shields.io/github/license/github/spec-kit" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="License"/></a>
</p>

> **TL;DR** — Claude bills you for every word it reads and writes, and most of those words are logs, build output, and play-by-play. hush trims them at the source, automatically. Install it, change nothing, pay less: $0.174 an average session against $0.211 without it.

---

## What is this?

You've seen it: "Let me start by looking at the codebase." "Now I'll check the config." Four hundred lines of build output you didn't ask for, and — eventually — the one sentence you actually needed. Every word of that is billed.

hush doesn't ask Claude to "be more concise" and hope for the best. It trims the actual bulk — logs, command output, narration — at the source, before any of it hits your bill. It earns its keep in real engineering sessions, the kind that read logs and run builds, because that's where the noise lives.

## Why you'd want it

- **Cheaper sessions.** The two biggest sources of bulk — noisy output and narration — get shrunk, so long sessions cost less.
- **Easier to read.** The answer sits at the top of one final message, not buried in a play-by-play.
- **Nothing important is lost.** Failing command output, code, diffs, and security warnings are kept whole.
- **Zero setup.** Install it and it's on. Tune it later only if you feel like it.

## How it works

Five small habits, picked up the moment it's installed:

| Moment | What happens |
| --- | --- |
| Progress narration | Swapped for one clean summary at the end |
| Command output & log files | Trimmed as they come in — a short tail from a clean run, the whole thing from a failing one |
| Mid-turn rambling | Caught by a running word count and cut off the moment it starts |
| Really large output (a huge log, a giant lockfile) | Parked in a local file behind a short summary, so it isn't re-sent in full every turn |
| Re-reading a file that changed on its own | Shown as just the changed lines, not the whole file again |

That's the whole list. No workflow to learn, no dial to find first — it's just how Claude behaves now.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Takes effect at your next session — nothing to configure. hush works in the background.

Running [razor](https://github.com/V-Songbird/razor) too? Good instinct — the pair is measured in [Better together](#better-together) below.

## What you can do

hush runs itself; these commands are extras:

| You want to… | Command |
| --- | --- |
| Shrink a `CLAUDE.md` or notes file so every session that loads it costs less | `/hush:hush-compress <path>` |
| See exactly what hush trimmed this session | `/hush:stats` |
| Build an output style in your own voice on hush's silent frame | `/hush:craft-style` |

> [!IMPORTANT]
> `hush-compress` never touches your original — it writes a copy alongside it (`CLAUDE.md` → `CLAUDE.hush.md`) for you to review and swap in yourself.

`/hush:stats` needs `HUSH_DEBUG=1` set before the work you want measured. Without it there's nothing to report — and it says so.

`/hush:craft-style` makes the style yours — robotic, piratical, whatever you'd actually enjoy reading — while keeping everything that makes hush work. It asks before letting your style take over from the built-in one, keeps track of every style it has made, and hands back to stock just as easily. One honest caveat: the benchmark numbers on this page belong to the stock style, and nobody has measured your pirate voice.

Switch styles yourself any time: `/config` → **Output style**, or set `"outputStyle"` in `.claude/settings.local.json`. Either way it applies from the next session.

```json
{
  "outputStyle": "my-crafted-style"
}
```

## Benchmarks

We put hush up against plain Claude Code and two rivals — caveman, which tells Claude to talk less, and an all-round "efficiency mode" plugin — on real engineering work: full agent sessions that explore, edit, and run code. Same jobs, phrased the way a developer actually types them, real cost read straight from the API.

<p align="center"><img src="assets/bench-hero.svg" alt="Average bill across the benchmark suite: no plugin $0.211, a 'be brief' plugin $0.205, an 'efficiency mode' plugin $0.191, hush $0.174. hush takes $0.037 off the bill; asking Claude to be brief takes off $0.006" width="700"></p>

**Being brief isn't enough.** Asking Claude to talk less saves about half a cent. An efficiency mode saves two. hush saves close to four. Asking politely and actually doing the work are two different things.

<p align="center"><img src="assets/bench-anatomy.svg" alt="One average session itemised: what Claude read — files, logs, command output — $0.186; what Claude wrote back, the reply, $0.026; the session $0.211. A plugin that only shortens the reply is working on the $0.026" width="700"></p>

**Almost the whole bill is what Claude *reads*,** not what it writes back. A plugin that only shortens the reply is working on three cents of a twenty-one-cent session. hush trims the logs and output before they hit your bill.

<p align="center"><img src="assets/bench-sidecar.svg" alt="A multi-turn debugging session — triage an outage, dig a version out of a huge lockfile, write the handoff: no plugin $0.42, a 'be brief' plugin $0.40, an 'efficiency mode' plugin $0.39, hush $0.28. hush takes $0.14 off the bill" width="700"></p>

**It shows most in longer sessions.** Drag a huge file into a multi-turn conversation and that bulk gets re-sent every turn. hush keeps a tidy summary in the chat and the full copy one click away — that outage session came in at $0.28 against $0.42. Neither rival moved it more than three cents.

<p align="center"><img src="assets/bench-chatter.svg" alt="The same three-turn job — fix a currency bug, ask why the conversion order matters, write it up — with every reply drawn at actual size. A typical run with no plugin fills 434 words; a typical hush run fills 257, a visibly shorter column. Both fixed the bug and passed the same check" width="700"></p>

**And you read about half as much.** Across the suite the replies come to 130 words against 254 — one message at the end, outcome first, instead of pieces arriving while Claude works.

**And it mostly says nothing until it's done.** That's the waveform at the top of this page — every session in the suite, one spike per run. hush is silent in 26 sessions out of 32. It isn't a gag order: Claude still speaks up to flag something you'd want to stop, or when it's blocked and needs you.

### The full picture

Every job, every setup — the wins **and** the ties and losses. Cheapest per row in **bold**.

| What Claude did | no plugin | caveman | "efficiency mode" | hush |
| --- | --- | --- | --- | --- |
| Triage a production outage log | $0.302 | $0.289 | $0.274 | **$0.143** |
| Multi-turn incident + write the handoff | $0.416 | $0.397 | $0.388 | **$0.277** |
| Hunt a cross-file currency bug | $0.180 | $0.198 | **$0.161** | $0.186 |
| Fix a bug, explain it, write it up (3 turns) | $0.248 | $0.267 | **$0.202** | $0.289 |
| Summarize a repo | $0.127 | **$0.118** | $0.142 | $0.130 |
| Find the error in a noisy build | $0.151 | $0.172 | $0.158 | **$0.149** |
| Fix a failing test suite | **$0.115** | $0.132 | $0.132 | $0.141 |
| Answer a code question (no tools) | $0.153 | **$0.069** | $0.075 | $0.078 |
| **Average** | $0.211 | $0.205 | $0.191 | **$0.174** |

Every job passed its correctness check in every setup — not one cheaper-but-wrong answer.

> [!NOTE]
> hush wins where there's noise to cut — logs, long sessions, multi-turn debugging — and roughly ties on short or low-output jobs, where a session's fixed overhead dwarfs anything a plugin can trim. On a few it costs a hair more. That's the honest shape, and it's why the average is the number to read.

*How we tested: same jobs, four setups, several runs each in fresh throwaway workspaces, on Sonnet — a full multi-turn agent session every time, never a single generated reply — costs read from the API, not estimated. Numbers move a few percent between runs. Reproduce it yourself — see [benchmarks/](benchmarks/).*

### Better together

We ran the pair too — hush alongside [razor](https://github.com/V-Songbird/razor) — against the rival pair, caveman with ponytail. Ours came out cheapest on both models and was the only setup that never turned in a wrong answer; the rival pair managed to cost more than running no plugin at all. The difference is enforcement: caveman and ponytail *ask* — talk less, build lean — and asking works right up until the model forgets. hush and razor fire on every session, whether Claude is in the mood or not.

## Under the hood

Every trim above happens locally as Claude works — read the plugin's files if you want the exact mechanics. `craft-style` copies those measured mechanics verbatim into a new style file in your own `output-styles` folder, checked by a mechanical verifier. With your say-so it swaps your style into hush's own slot so it binds like stock, and swaps stock back on request. A plugin that takes plugins, more or less. Pairs naturally with [razor](https://github.com/V-Songbird/razor): razor cuts the code, hush cuts the noise. Run both and neither notices the other — measured as a pair, they're the setup we'd pick ourselves (see [Better together](#better-together)).

## Settings

Most people never touch these. A few environment variables tune the caps or turn parts off:

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Turns hush off |
| `HUSH_NARRATION_BUDGET=120` | Words of narration allowed before hush steps in |
| `HUSH_SIDECAR=off` | Keeps big output inline instead of moving it to a file |
| `HUSH_DELTA=off` | Shows the whole file again on a re-read instead of just what changed |
| `HUSH_DEBUG=1` | Turns on the record `/hush:stats` reads from |

## License

MIT — see [LICENSE](./LICENSE).
