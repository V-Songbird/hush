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

> **TL;DR** — Claude bills you for every log line, build dump, and word of play-by-play. hush trims that bulk before it reaches your bill. Install and forget: on the noisy, long engineering work it's built for, sessions run about 15% cheaper and nearly all the play-by-play disappears. Short no-tool questions cost a little more.

---

## What is this?

Claude talks a lot while it works. "Let me look at the codebase." "Now I'll check the config." Then four hundred lines of build output you never asked for. And at the very end, the one sentence you actually needed.

hush trims that bulk — logs, command output, narration — at the source, before any of it hits your bill. It earns its keep in sessions that read logs, run builds, and keep going turn after turn. A short question with no tools has nothing to trim. There you pay a little more for the quieter reply.

And the one message you do get is built to be read on an empty tank. Answer first. Everyday words. One fact per sentence. Hard caps: 12 lines, 10 words a sentence. Made for ADHD readers, and for anyone fried at the end of a long day.

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

Running [razor](https://github.com/V-Songbird/razor) too? They fire on different moments of a session, so neither notices the other.

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

`/hush:craft-style` writes a new style in a voice you describe, and a verifier checks that the machinery survived the rewrite. Both commands ask before they swap, and take effect at your next session. Updating the plugin hands the slot back to stock, so re-pick after an update. Only stock is benchmarked — the numbers on this page belong to it.

**See them side by side.** Same bug, same fix, five sign-offs — [`styles/README.md`](styles/README.md).

## Benchmarks

We put hush up against plain Claude Code on six fixed jobs — the work hush is built for: noisy builds and logs, a big migration sweep, and long sessions that drift. Full agent sessions that explore, edit, and run code, with real numbers read from the API.

<p align="center"><img src="assets/bench-cuts.svg" alt="What hush cuts, averaged per session over the same 6 jobs on Sonnet. Tool output: no plugin 32.8k characters, hush 16.8k, 49% less. Chatter before the answer: 56 words against 12 words, 79% less. Tokens the model wrote: 5,129 against 4,714, 8% less. Cost per session: $0.444 against $0.378, 15% less" width="700"></p>

**hush cuts the noise and the bill.** Tool output drops 49%, the running commentary all but disappears, and the average session costs 15% less. It earns the most on loud logs and long digs. It costs a little on short questions with nothing to cut. [The full picture](#the-full-picture) below has every row, the wins and the losses.

**And you read it in silence.** hush went the whole session without a word of play-by-play in 8 jobs of 12, and slipped seven times in all — plain Claude Code slipped 36 times. Claude still speaks up to flag something you'd want to stop, or when it's blocked and needs you.

### The full picture

Every kind of work, the wins **and** the losses. Typical (median) cost per session, on Sonnet.

| Kind of work | no plugin | hush | change | worst single job for hush |
| --- | --- | --- | --- | --- |
| Noisy builds and logs (3 jobs) | $0.205 | $0.205 | a wash | the failing suite, +12% |
| Search-heavy (1 job) | $0.765 | $0.767 | a wash | — |
| Long drifting sessions (2 jobs) | $0.505 | **$0.438** | −13% | the feature job, +21% |
| **Whole suite (mean)** | $0.444 | **$0.378** | **−15%** | |

Every setup passed every correctness check this run — 12 of 12 each — so none of the savings came from cheaper-but-wrong answers. Read the rows, not just the last one: your bill will follow whichever rows look like your work. On Haiku, the cross-check model, hush costs about 11% more and slips just twice in twelve jobs — but it missed two correctness checks there. Treat it as a silence tool first on the small model.

### Reading it is the other half

We also scored the one final message each setup shipped, on measures none of us invented — Flesch Reading Ease, US grade level, sentence length, long words. Beside hush: [i-have-adhd](https://github.com/ayghri/i-have-adhd), built for ADHD readers, [simple-english](https://github.com/AminBlg/SimpleEnglish), aerospace's controlled English, and [caveman](https://github.com/JuliusBrussee/caveman), ultra-compressed answers. Same six jobs, same run, on Sonnet.

| Setup | words | lines | words per sentence | long words | reading ease | grade level | silent sessions | mid-work slips |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| no plugin | 100 | 5 | 14.9 | 10.5% | 66.2 | 7.7 | 2 of 12 | 36 |
| **hush** | 63 | 4 | 9.6 | **7.0%** | **81.2** | **4.3** | **8 of 12** | **7** |
| i-have-adhd | 80 | 5 | 9.9 | 9.3% | 71.6 | 5.7 | 3 of 12 | 18 |
| simple-english | 91 | 4 | 12.4 | 7.7% | 79.0 | 5.3 | 1 of 12 | 30 |
| caveman | **46** | **2.5** | **8.9** | 11.4% | 68.7 | 5.9 | 5 of 12 | 11 |

**hush reads easiest of the pack *and* goes quiet.** It takes the reading crowns this run — a full grade easier than the style built for ADHD readers, three grades easier than plain Claude Code — and it's still the only setup that regularly finishes a session in silence. caveman writes the shortest messages, with the longest words on the board. The honest loss: hush ends with something you can run 73% of the time, plain Claude 91%.

Here's what that reads like. One real final message from this run, the dependency-bump job, exactly as hush shipped it:

> Fixed two real bugs the bump exposed, not just noise.
>
> 1. `src/core/options.js` read `options.retries`, but the new bundler passes `retryCount`. Changed it to read the right field.
> 2. `src/net/retryPolicy.js` threw on `undefined` flags. Now unset flags mean backoff is off, matching the new config loader.
>
> Build now exits clean, 0 errors. The rest was just deprecation noise from the bump, safe to ignore.

*How we tested: same jobs, two runs each in fresh throwaway workspaces, on Sonnet — full headless agent sessions, never a single generated reply, costs read from the API. Suite-wide numbers move a few percent between runs, and a single row can swing 10 to 20 points — read the direction, not the decimal. Reproduce it yourself: [the marketplace repo](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush).*

## Under the hood

Every trim happens locally as Claude works — read the plugin's files if you want the exact mechanics. `pick-style` swaps your chosen style into hush's own slot so it binds like stock, and swaps stock back on request.

## Settings

Most people never touch these. By default hush reminds Claude to stay quiet once at the start of each turn, and once more only in the moments chatter actually slips through — so a session that stays quiet pays nothing extra:

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops every hook — no compression, no reminders, no files written. The output style is a separate switch: run `/hush:pick-style` to hand the slot back to stock, or uninstall |
| `HUSH_DEBUG=1` | Writes a local record of what hush did to each tool output — sizes in and out, and where the full copy went — to `hush-debug-<session>.jsonl` in your system temp folder |
| `HUSH_NUDGE=max` | As quiet as hush gets — a reminder on every tool result, whether or not anything slipped. Costs the most too |

`HUSH_WRAP=1` is a situational switch — it lets hush trim failing commands too; see the callout under [How it works](#how-it-works).

There are no compression levels and no profiles — the trimming is one policy.

Claude Code's own **Output style** setting is what selects Hush's voice. Installing the plugin sets it automatically. If it didn't bind, pin it by hand in `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

Once it binds you can drop the pin — `/hush:pick-style` swaps styles inside hush's own slot.

## Good to know

- **Getting the full output back.** The summary names the file hush parked. Read it and you have every byte. If the file is gone, run the command again — hush never claims it regenerates what was lost.
- **Turning it off is two switches.** `HUSH_DISABLE=1` stops everything hush does while a session runs. The style is chosen at session start — hand it back with `/hush:pick-style`, or uninstall.
- **Where the parked output lives.** Your system temp folder, in `hush-sidecar`, one folder per session, readable only by you where the OS supports that. hush deletes that folder when the session ends, and clears anything a crashed session left behind once it's a day old. Anything you'd hate to see in a temp file, keep out of the terminal.
- **Windows caveat.** Same atomic writes, same refusal to follow symlinks, but the read-only-to-you file mode isn't enforceable there. Treat parked output as readable by anything running as you.

## License

MIT — see [LICENSE](./LICENSE).
