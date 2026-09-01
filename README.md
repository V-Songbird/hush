<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Claude narrates every step and dumps every log line into your chat. hush gives you one short answer at the end instead.</strong></p>

  <img src="assets/hero.svg" alt="A poster of the whole benchmark suite as one waveform, one spike per run — words of play-by-play before the answer. Left of the hush-installed divider, 36 sessions without the plugin spike to 134 words, and the loudest breaks in 7 separate times. Right of it, the same 36 sessions with hush run flat: every one of them speaks at most once, and nothing runs over 7 words. It reads: Quiet." width="700" />

  <p><em>The same nine jobs, Claude Opus 5, 36 sessions each way.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/hush/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/hush?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/hush/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/hush" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

<p align="center">
    <a href="#install"><strong>Install</strong></a> &nbsp;·&nbsp;
    <a href="#what-is-this">What is this?</a> &nbsp;·&nbsp;
    <a href="#why-youd-want-it">Why you'd want it</a> &nbsp;·&nbsp;
    <a href="#the-numbers">The numbers</a> &nbsp;·&nbsp;
    <a href="#going-deeper">Going deeper</a>
</p>

> **TL;DR** — Claude Code talks while it works, and pastes whole log files into the conversation. hush stops both. You get one short message at the end that leads with the answer and names the file to open. In 36 test sessions it spoke at most once before that answer, every single time.

---

## What is this?

You ask Claude Code to do something. Then you watch it talk.

"Let me look at the codebase." "Now I'll check the config." Four hundred lines of build output. A
log file, pasted whole. None of it is the answer. The answer is one sentence, and it arrives at the
very end, after you have scrolled past everything else.

hush does two things about that.

It keeps Claude quiet while it works, so there is one message to read instead of nine. And it
shortens the machine output before Claude ever reads it back, so a giant log does not sit in the
conversation getting re-sent on every turn after it.

That's the whole plugin.

## Why you'd want it

Here is a real one. The job was a red test suite. Same job, same starting files.

**Without hush**, it opened with `I'll start by looking at the project structure and finding the
pricing suite.`, spoke three more times while it worked, and closed with a 254-word write-up.

**With hush**, nothing at all until the work was done, and then this — the whole message, exactly
as it was written:

> **Green: 625 passing, 0 failing.**
>
> Only 3 cases failed, all in `order totals`. One bug in [pricing.js:39](src/pricing.js:39). `orderTotal` taxed the full `cents`, not the discounted amount.
>
> Rows with a zero discount or zero tax hid it. Only 3 rows had both.
>
> Fix: tax the discounted subtotal via `applyTax`.
>
> Next: nothing.

Answer first. Short sentences. Everyday words. The file to open is named and clickable. And when
the job is finished it says so, instead of inventing a next step.

It is built for reading on an empty tank — at the end of a long day, or with an ADHD brain that has
already spent its patience on the actual work.

## How it works

Two moments, and that is the list.

**While Claude works**, the play-by-play is off. You get one message at the end instead of a
running commentary.

**When a command finishes**, hush looks at what came back. Short output goes through untouched. A
long run is shortened, and every error and warning line is pulled through. Something really
large — a full log, a lockfile — is saved to a file on your machine and replaced with a short
summary that names it, so Claude can go and read it if it needs to.

Your files are never touched, and nothing leaves your machine.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

It kicks in at your next session. Nothing to configure.

Running [razor](https://github.com/V-Songbird/razor) too? Good pairing — razor keeps the code lean
while hush keeps the noise down, and neither notices the other.

## What you can do

hush runs itself. Two commands sit off to the side, for writing that last message in your own
voice.

| You want to… | Command |
| --- | --- |
| Build a voice of your own on hush's quiet frame | `/hush:craft-style` |
| Switch between your voices, or go back to the one hush installs | `/hush:pick-style` |

Describe the voice you want — robotic, dry, loud — and `/hush:craft-style` writes it. The words
change; the quiet does not. Everything else has a sensible default; if you want to change one, see
[Settings](docs/SETTINGS.md).

## Just the voice, no plugin

You don't have to install anything. The writing voice on its own is a single Markdown file, with a
paste-in installer, at [flint](https://github.com/V-Songbird/flint).

The honest split: the file gives you the silence and the one short message. It does **not** give
you the trimming of command output and log files — that part needs the plugin. The voice is what
makes the answer readable; the trimming is what keeps a long session cheap.

## The numbers

Nine jobs, each in its own throwaway folder. Real sessions from start to finish — reading files,
editing code, running commands. Every job ends with a check, so a short answer that breaks the job
counts as a failure, not a win. All of it on Claude Opus 5, 36 sessions per setup, in one run.

Beside hush: [caveman](https://github.com/JuliusBrussee/caveman), which makes Claude talk like a
caveman, and the only other setup here that ever stops narrating.

**Does it still work?**

| setup | jobs right |
| --- | --- |
| no plugin | 36 / 36 |
| caveman | 36 / 36 |
| **hush** | **36 / 36** |

**How quiet?** Every model opens with a line about what it is about to do. The number that matters
is whether it keeps talking after that.

| setup | spoke at most once before the answer | said nothing at all |
| --- | --- | --- |
| no plugin | 14 of 36 | 0 of 36 |
| caveman | 31 of 36 | 16 of 36 |
| **hush** | **36 of 36** | **30 of 36** |

**How readable?** The final message, scored on measures that have been around for decades:

| setup | words | reading ease | school grade |
| --- | --- | --- | --- |
| no plugin | 367 | 70.7 | 6.6 |
| caveman | 151 | 73.1 | 5.1 |
| **hush** | **69** | **87.7** | **2.7** |

<p align="center"><img src="assets/bench-cuts.svg" alt="What hush cuts, averaged per session over the same 9 jobs on Opus 5 at medium effort, 4 runs each way. command output: no plugin 23.4k chars, hush 15.4k chars, minus 34%. chatter while working: no plugin 34 words, hush 1 word, minus 97%. Claude's whole-session output: no plugin 5,058 tok, hush 2,981 tok, minus 41%." width="700"></p>

> [!IMPORTANT]
> **Where hush doesn't win.** The short answer sometimes drops the thing you were meant to run
> next: hush ends with something runnable in 94% of sessions, every other setup here in 100%. A
> quiet job that prints little can also cost *more*, because hush's writing rules ride along on
> every step with nothing to trim against them — three of the nine jobs came out 1-10% pricier.
> And caveman is real competition on silence, not a straw man. The full picture, wins and losses
> and every job's bill, is in [the numbers](docs/BENCHMARKS.md).

*Numbers move between runs, sometimes by a lot. Run it yourself — see [benchmarks/](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush).*

## Going deeper

Everything technical lives here, so this page can stay short:

| | |
| --- | --- |
| [How hush works](docs/HOW-IT-WORKS.md) | What gets trimmed and when, where parked output goes |
| [Settings](docs/SETTINGS.md) | Every switch, and what each one does |
| [The numbers](docs/BENCHMARKS.md) | Full results, including where hush loses |
| [Run the benchmarks](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush) | The harness, so you can check any of it yourself |

## Good to know

- **Getting the full output back.** The summary names the file hush parked. Read it and you have
  every byte. If the file is gone, run the command again — hush never claims it can regenerate what
  was lost.
- **Turning it off is two switches.** `HUSH_DISABLE=1` stops everything hush does while a session
  runs. The voice is chosen when a session starts, so put the original back with
  `/hush:pick-style`, or uninstall.
- **Parked output lives in your temp folder**, one folder per session.
  hush deletes that folder when the session ends, and clears anything a crashed session left behind once it is a day old.
  On macOS and Linux it is readable only by you; Windows can't lock it that way, so treat it as
  readable by anything running as you. Keep out of the terminal anything you'd hate to see in a
  temp file.
- **A command that fails is not trimmed by default.** Claude Code guards failing output. Set
  `HUSH_WRAP=1` to let hush shorten it too.

## License

MIT — see [LICENSE](./LICENSE).
