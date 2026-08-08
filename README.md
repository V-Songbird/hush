<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Claude talks a lot while it works, and you pay for every word. hush turns down the chatter.</strong></p>

  <img src="assets/hero.svg" alt="A poster of the whole benchmark suite as one waveform, one spike per run — words of play-by-play before the answer. Left of the hush-installed divider, the 85 sessions without the plugin spike to 320 words. Right of it, the same 85 sessions with hush run flat: silent in 81 of 85, nothing over 24 words. It reads: Quiet." width="700" />

  <p><em>This is what a session sounds like.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/hush/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/hush?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/hush/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/hush" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

> **TL;DR** — Claude bills you for every log line, build dump, and word of play-by-play. hush trims that bulk before it reaches your bill. The noisy-build rows of our suite come in 18% cheaper, and the suite average drops from $0.185 to $0.179. Short, quiet jobs have nothing to cut and can cost a little more.

---

## What is this?

Claude talks a lot while it works. "Let me look at the codebase." "Now I'll check the config." Then four hundred lines of build output you never asked for. And at the very end, the one sentence you actually needed.

hush trims that bulk — logs, command output, narration — at the source, before any of it hits your bill. It earns its keep in sessions that read logs, run builds, and keep going turn after turn. A short question with no tools has nothing to trim. There you pay a little more for the quieter reply.

And the one message you do get is built to be read on an empty tank. Answer first. Everyday words. Hard caps: 12 lines, 15 words a sentence. Made for ADHD readers, and for anyone fried at the end of a long day.

## Why you'd want it

- **Noisy sessions cost less.** The two biggest sources of bulk — machine output and narration — get shrunk at the source.
- **Easier to read.** The answer sits at the top of one final message, not buried in a play-by-play.
- **Your files are never touched, and big output is saved before it's shortened.** The summary points at the saved file. Smaller trims keep the error and warning lines and drop the repetitive middle.
- **Zero setup.** Install it and it's on. Nothing to configure, nothing to learn.

## How it works

| Moment | What happens |
| --- | --- |
| Progress narration | Swapped for one clean summary at the end |
| Command output & log files | Trimmed as they come in — a short tail from a clean run, up to 250 lines from a failing one, with the error and warning lines pulled through |
| Really large output (a huge log, a giant lockfile) | Parked in a local file behind a short summary, so it isn't re-sent in full every turn |

That's the whole list. No workflow to learn, no dial to find first.

> [!IMPORTANT]
> **A command that fails is not trimmed on a default install.** Claude Code gives hush no way to replace failing output unless the session runs in `bypassPermissions` mode, or you set `HUSH_WRAP=1`. The benchmark figures below were measured with `HUSH_WRAP=1`.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

It kicks in at your next session — nothing to configure.

Running [razor](https://github.com/V-Songbird/razor) too? Good instinct — the pair plays clean, see [Better together](#better-together) below.

## What you can do

hush runs itself. Two commands sit off to the side, for when you want the final message in a different voice:

| You want to… | Command |
| --- | --- |
| Try one of the output styles hush ships, or hand back to stock | `/hush:pick-style` |
| Build an output style in your own voice on hush's silent frame | `/hush:craft-style` |

Every style runs the same silent machinery. They differ only in the voice of that one last message:

| Style | What the final message does |
| --- | --- |
| **Glyph** | Emoji-telegram reports — an emote replaces each obvious word |
| **Rock** | Stone Age dialect — noun chains, no articles, `=` for cause |
| **Pirate** | Every report in full pirate dialect, outcome first |
| **Sensei** | Teaches the change at newcomer depth — the why and how, closed by a `Lesson:` and a `Check:`. No length cap |

`/hush:craft-style` writes a new style in a voice you describe, and a verifier checks every number, cap, and rule survived the rewrite. Both commands ask before they swap, and take effect at your next session. Updating the plugin hands the slot back to stock, so re-pick after an update. Only stock is benchmarked — the numbers on this page belong to it.

**See them side by side.** Same bug, same fix, five sign-offs — [`styles/README.md`](styles/README.md).

## Benchmarks

We put hush up against plain Claude Code on 17 fixed jobs: full agent sessions that explore, edit, and run code, with real numbers read from the API.

<p align="center"><img src="assets/bench-cuts.svg" alt="What hush cuts, averaged per session over the same 17 jobs on Sonnet. Tool output: no plugin 16.7k characters, hush 6.8k, 59% less. Chatter before the answer: 41 words against 0.8 words, 98% less. Tokens the model wrote: 1,659 against 1,373, 17% less. Cost per session: $0.185 against $0.179, 3% less, which sits inside run-to-run noise" width="700"></p>

**hush cuts what you read, not what you pay.** Tool output drops by more than half, and the running commentary all but disappears. Cost lands within a few percent — close enough to call it a wash. It saves real money on sessions full of loud builds and big logs. It costs a little on short questions with nothing to cut. [The full picture](#the-full-picture) below has every row, the wins and the losses.

**And you read it in silence.** The typical final reply is 69 words against 102. That's the waveform at the top of this page: silent in 81 sessions of 85, never more than 24 words before the answer. Claude still speaks up to flag something you'd want to stop, or when it's blocked and needs you.

### The full picture

Every kind of work, the wins **and** the losses. Typical (median) cost per session, on Sonnet.

| Kind of work | no plugin | hush | change | worst single job for hush |
| --- | --- | --- | --- | --- |
| Noisy builds and logs (4 jobs) | $0.221 | **$0.181** | −18% | the noisy build, a wash |
| Debugging (6 jobs) | **$0.155** | $0.172 | +11% | a small pagination fix, +27% |
| Ordinary coding (4 jobs) | **$0.068** | $0.082 | +21% | a no-tools explanation, +36% |
| Doc editing (1 job) | **$0.245** | $0.268 | +9% | the runbook edit, +9% |
| Search-heavy (2 jobs) | **$0.129** | $0.149 | +15% | summarize a repo, +18% |
| **Whole suite (mean)** | $0.185 | **$0.179** | **−3%** | |

Both setups passed the same share of correctness checks, so none of the savings came from cheaper-but-wrong answers. Read the rows, not just the last one — your bill will follow whichever rows look like your work. On Haiku, the cross-check model, the mean drops about 10% but hush failed slightly more correctness checks. Treat it as a silence tool first there.

### Reading it is the other half

We also scored the one final message each setup shipped, on measures none of us invented — Flesch Reading Ease, US grade level, sentence length, long words. Beside hush: [i-have-adhd](https://github.com/ayghri/i-have-adhd), built for ADHD readers, and [simple-english](https://github.com/AminBlg/SimpleEnglish), aerospace's controlled English. Same 17 jobs, same run, on Sonnet.

| Setup | words | lines | words per sentence | long words | reading ease | grade level | ends with something to run |
| --- | --- | --- | --- | --- | --- | --- | --- |
| no plugin | 96 | 4 | 15.4 | 10.5% | 68.4 | 7.5 | **94%** |
| **hush** | 74 | 3 | 12.9 | **7.0%** | **79.9** | 5.3 | 77% |
| i-have-adhd | 48 | 3 | 10.5 | 8.2% | 77.3 | **5.1** | 82% |
| simple-english | 80 | 4 | 12.7 | 7.1% | 76.7 | 5.7 | 90% |
| caveman | 45 | 3 | **8.8** | 9.5% | 70.9 | 5.5 | 75% |

**hush writes the easiest prose in the room — and it's the only one that also goes quiet.** Highest reading ease, fewest long words, a grade-five read instead of grade-eight. It said nothing at all in 48 sessions of 51; the quietest rival managed 22. The honest loss: hush ends with something you can run 77% of the time, plain Claude 94%.

*How we tested: same jobs, several runs each in fresh throwaway workspaces, on Sonnet — full headless agent sessions, never a single generated reply, costs read from the API. Suite-wide numbers move a few percent between runs, but a single row can swing 10 to 20 points — read the direction, not the decimal. The cost and reading tables come from two different runs, so never compare across them. Reproduce it yourself: [the marketplace repo](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush).*

### Better together

razor cuts the code, hush cuts the noise. They fire on different moments of a session, so neither notices the other.

## Under the hood

Every trim happens locally as Claude works — read the plugin's files if you want the exact mechanics. `pick-style` swaps your chosen style into hush's own slot so it binds like stock, and swaps stock back on request.

## Settings

Most people never touch these. The day-to-day ones:

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops every hook — no compression, no reminders, no files written. The output style is a separate switch: run `/hush:pick-style` to hand the slot back to stock, or uninstall |
| `HUSH_DEBUG=1` | Writes a local record of what hush did to each tool output — sizes in and out, and where the full copy went |
| `HUSH_NUDGE=turn` | The spend dial. Keeps one quiet reminder at the start of each turn and drops the mid-turn ones. Costs the same as no plugin, and stays far quieter than no plugin — the default is quieter still, at a premium on long sessions that resume |

`HUSH_WRAP=1` is a situational switch — it lets hush trim failing commands too; see the callout under [How it works](#how-it-works).

There are no compression levels and no profiles — the trimming is one policy.

## Good to know

- **Getting the full output back.** The summary names the file hush parked. Read it and you have every byte. If the file is gone, run the command again — hush never claims it regenerates what was lost.
- **Turning it off is two switches.** `HUSH_DISABLE=1` stops everything hush does while a session runs. The style is chosen at session start — hand it back with `/hush:pick-style`, or uninstall.
- **Where the parked output lives.** Your system temp folder, in `hush-sidecar`, one folder per session, readable only by you where the OS supports that. hush deletes that folder when the session ends, and clears anything a crashed session left behind once it's a day old. Anything you'd hate to see in a temp file, keep out of the terminal.
- **Windows caveat.** Same atomic writes, same refusal to follow symlinks, but the read-only-to-you file mode isn't enforceable there. Treat parked output as readable by anything running as you.

## License

MIT — see [LICENSE](./LICENSE).
