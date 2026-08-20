<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Claude talks a lot while it works, and you pay for every word. hush turns down the chatter.</strong></p>

  <img src="assets/hero.svg" alt="A poster of the whole benchmark suite as one waveform, one spike per run — words of play-by-play before the answer. Left of the hush-installed divider, the 85 sessions without the plugin spike to 320 words. Right of it, the same 85 sessions with every hush reminder turned on run flat: silent in 81 of 85, nothing over 24 words. It reads: Quiet." width="700" />

  <p><em>An 85-session run of an older 17-job suite, with every reminder turned on: <code>HUSH_NUDGE=max</code>. The tables below are the current six-job suite on the default setting.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/hush/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/hush?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/hush/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/hush" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

> **TL;DR** — Claude talks a lot while it works, and dumps every log line into the conversation. hush cuts that noise: about half the machine output, and nearly all the play-by-play. What you get back is one short, readable answer at the end. On the last run the bill came out the same as without it, so take this as a quiet-and-readable tool, not a discount.

---

## What is this?

Claude talks a lot while it works. "Let me look at the codebase." "Now I'll check the config." Then four hundred lines of build output you never asked for. And at the very end, the one sentence you actually needed.

hush trims that bulk — logs, command output, play-by-play — at the source, before Claude has to read any of it back. It earns its keep in sessions that read logs, run builds, and keep going turn after turn. A short question that runs nothing has nothing to trim. There you pay a little more for the quieter reply.

And the one message you do get is built to be read on an empty tank. Answer first. Everyday words. One fact per sentence. It aims for twelve lines, and sentences of about ten words. Made for ADHD readers, and for anyone fried at the end of a long day.

## Why you'd want it

- **Noisy sessions get quiet.** The two biggest sources of bulk — machine output and the play-by-play — get shrunk at the source, before Claude has to read them back.
- **Easier to read.** The answer sits at the top of one final message, not buried in a play-by-play.
- **Your files are never touched, and big output is saved before it's shortened.** The summary points at the saved file. Smaller trims keep the error and warning lines and drop the repetitive middle.
- **Zero setup.** Install it and it's on. Nothing to configure, nothing to learn.

## How it works

| Moment | What happens |
| --- | --- |
| The play-by-play while it works | Swapped for one clean summary at the end |
| Command output & log files | Trimmed as they come in — a short tail from a clean run, up to 250 lines from a failing one, with the error and warning lines pulled through |
| Really large output (a huge log, a giant lockfile) | Parked in a local file behind a short summary, so it isn't re-sent in full every turn |

That's the whole list. No workflow to learn, no dial to find first.

> [!IMPORTANT]
> **A command that fails is not trimmed on a default install.** Claude Code only lets hush replace failing output when the session has stopped asking you to approve each step, or when you set `HUSH_WRAP=1`. The figures below were measured with `HUSH_WRAP=1`.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

It kicks in at your next session — nothing to configure.

Running [razor](https://github.com/V-Songbird/razor) too? They work at different moments of a session, so neither trips over the other.

## What you can do

hush runs itself. Two commands sit off to the side, for when you want that last message written in a different voice. Claude Code calls a writing voice an **output style**, and hush ships a few:

| You want to… | Command |
| --- | --- |
| Try one of the voices hush ships, or go back to the one it installs | `/hush:pick-style` |
| Build a voice of your own on hush's quiet frame | `/hush:craft-style` |

Every style runs the same silent machinery. They differ only in the voice of that one last message:

| Style | What the final message does |
| --- | --- |
| **Glyph** | Emoji-telegram reports — an emote replaces each obvious word |
| **Rock** | Stone Age dialect — noun chains, no articles, `=` for cause |
| **Pirate** | Every report in full pirate dialect, outcome first |
| **Sensei** | Teaches the change at newcomer depth — the why and how, closed by a `Lesson:` and a `Check:`. No length cap |

`/hush:craft-style` writes a new voice from your description, then checks that the quiet machinery survived the rewrite. Both commands ask before they swap, and take effect at your next session. Updating the plugin puts the voice hush ships back, so pick again after an update. Only that one was measured — the numbers on this page belong to it.

**See them side by side.** Same bug, same fix, five sign-offs — [`styles/README.md`](styles/README.md).

## Benchmarks

We put hush up against plain Claude Code on six fixed jobs — the work hush is built for: noisy builds and logs, a big migration sweep, and long sessions that drift. These are real sessions where Claude reads, edits, and runs code, and every cost comes straight from the API.

<p align="center"><img src="assets/bench-cuts.svg" alt="What hush cuts, averaged per session over the same 6 jobs on Sonnet. Tool output: no plugin 33.6k chars, hush 18.0k chars, 46% less. Chatter before the answer: no plugin 55 words, hush 9 words, 84% less. Tokens the model wrote: no plugin 4,583 tok, hush 5,199 tok, 13% more. Cost per session: no plugin $0.393, hush $0.388, 1% less." width="700"></p>

**hush cuts the noise. The bill lands about where it started.** Tool output drops 46% and the running commentary all but disappears. Cost came out a wash this run: two jobs got a lot cheaper, three got dearer. [The full picture](#the-full-picture) below has every row, the wins and the losses.

**And you read it in silence.** hush went the whole session without a word of play-by-play in 8 jobs of 12 — plain Claude Code managed that in 2. Claude still speaks up to flag something you'd want to stop, or when it's blocked and needs you.

### The full picture

Every kind of work, the wins **and** the losses. Typical (median) cost per session, on Sonnet.

| Kind of work | no plugin | hush | change | worst single job for hush |
| --- | --- | --- | --- | --- |
| Noisy builds and logs (3 jobs) | $0.183 | $0.202 | +10% | the dependency bump, +23% |
| Search-heavy (1 job) | $0.642 | **$0.616** | **−4%** | — |
| Long drifting sessions (2 jobs) | $0.525 | **$0.520** | **a wash** | the feature job, +44% |
| **Whole suite (mean)** | $0.393 | **$0.388** | **−1%** | |

Job by job it swings hard both ways: the log triage came out 36% cheaper and the incident job 24% cheaper, while the feature job cost 44% more. Read the rows, not just the last one — your bill will follow whichever rows look like your work. Every setup passed every correctness check this run, 12 of 12 each, so nothing here was bought with a wrong answer. On Haiku, hush costs about 11% more and speaks up just twice in twelve jobs — but it missed two correctness checks there. Treat it as a quiet tool first on the small model.

### Reading it is the other half

We also scored the one final message each setup shipped, on measures none of us invented — Flesch Reading Ease, US grade level, sentence length, long words. Beside hush: [i-have-adhd](https://github.com/ayghri/i-have-adhd), built for ADHD readers, [simple-english](https://github.com/AminBlg/SimpleEnglish), aerospace's controlled English, and [caveman](https://github.com/JuliusBrussee/caveman), ultra-compressed answers. Same six jobs, same run, on Sonnet.

| Setup | words | lines | words per sentence | long words | reading ease | grade level | silent sessions |
| --- | --- | --- | --- | --- | --- | --- | --- |
| no plugin | 71.5 | 3 | 15.2 | 10.1% | 65.9 | 7.8 | 2 of 12 |
| **hush** | 67.5 | 2.5 | 12.2 | **5.8%** | **81.0** | **5.0** | **8 of 12** |
| i-have-adhd | 94.5 | 3.5 | 15.7 | 9.7% | 70.1 | 7.4 | 4 of 12 |
| simple-english | 75.5 | 3 | 15.4 | 9.1% | 71.0 | 7.2 | 3 of 12 |
| caveman | **32** | **1.5** | **8.7** | 12.5% | 65.3 | 6.3 | 4 of 12 |

**hush reads easiest of the pack *and* goes quiet.** It takes the reading crowns this run — two grades easier than the style built for ADHD readers, nearly three easier than plain Claude Code, and the fewest long words on the board — and it's still the only setup that regularly finishes a session in silence. caveman writes far shorter messages, with the longest words of anyone. The honest loss: hush ends with something you can run 83% of the time, plain Claude every time.

Here's what that reads like. One real final message from this run, the dependency-bump job, exactly as hush shipped it:

> Builds clean now, exit 0.
>
> The real problem was two spots that never got updated for the new bundler's option shapes.
>
> 1. `src/core/options.js` read `options.retries`, but the bumped bundler now sends `retryCount`. That was throwing on `undefined.toFixed()`.
> 2. `src/net/retryPolicy.js` required `backoffEnabled` to be strictly `true` or `false`, but the new config loader leaves it `undefined` when unset. That threw too.
>
> Both now handle the new shapes, and the rest of the warnings are just noisy deprecation notices from the bump, not bugs. Build finishes with 8 warnings, 0 errors.

*How we tested: same jobs, two runs each in fresh throwaway workspaces, on Sonnet — full headless agent sessions, never a single generated reply, costs read from the API. Suite-wide numbers move a few percent between runs, and a single row can swing 10 to 20 points — read the direction, not the decimal. Reproduce it yourself: [the marketplace repo](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush).*

## Under the hood

Every trim happens on your machine as Claude works — read the plugin's files if you want the exact mechanics. `/hush:pick-style` puts the voice you chose where Claude Code looks for hush's, so Claude picks it up the same way, and puts the original back on request.

## Settings

Most people never touch these. By default hush reminds Claude to stay quiet once at the start of each turn, and once more only in the moments chatter actually slips through — so a session that stays quiet pays nothing extra:

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything hush does — no trimming, no reminders, no files written. The writing voice is a separate switch: run `/hush:pick-style` to put the original back, or uninstall |
| `HUSH_DEBUG=1` | Writes a local record of what hush did to each tool output — sizes in and out, and where the full copy went — to `hush-debug-<session>.jsonl` in your system temp folder |
| `HUSH_NUDGE=max` | As quiet as hush gets — a reminder on every tool result, whether or not anything slipped. Costs the most too |

`HUSH_WRAP=1` is a situational switch — it lets hush trim failing commands too; see the callout under [How it works](#how-it-works).

There are no levels and no profiles to pick between — hush trims one way, always.

Claude Code's own **Output style** setting is what picks Hush's voice. Installing the plugin sets it for you. If it didn't take, write it in by hand in `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

Once it takes you can delete those lines again — `/hush:pick-style` swaps voices for you after that.

## Good to know

- **Getting the full output back.** The summary names the file hush parked. Read it and you have every byte. If the file is gone, run the command again — hush never claims it regenerates what was lost.
- **Turning it off is two switches.** `HUSH_DISABLE=1` stops everything hush does while a session runs. The voice is chosen when a session starts — put the original back with `/hush:pick-style`, or uninstall.
- **Where the parked output lives.** Your system temp folder, in `hush-sidecar`, one folder per session, readable only by you where the OS supports that. hush deletes that folder when the session ends, and clears anything a crashed session left behind once it's a day old. Anything you'd hate to see in a temp file, keep out of the terminal.
- **On Windows, one protection is missing.** hush writes those files just as carefully, but Windows can't lock them to your account alone. Treat parked output there as readable by anything running as you.

## License

MIT — see [LICENSE](./LICENSE).
