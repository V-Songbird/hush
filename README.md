<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Claude talks a lot while it works, and you pay for every word. hush turns down the chatter.</strong></p>

  <img src="assets/hero.svg" alt="A poster of the whole benchmark suite as one waveform, one spike per run — words of play-by-play before the answer. Left of the hush-installed divider, 16 sessions without the plugin spike to 190 words. Right of it, the same 16 sessions with hush run flat: silent in 11 of 16, nothing over 37 words. It reads: Quiet." width="700" />

  <p><em>The same eight jobs the tables below measure, on the default setting. 16 sessions each way.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/hush/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/hush?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/hush/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/hush" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

> **TL;DR** — Claude talks a lot while it works, and dumps every log line into the conversation. hush cuts that noise: about half of the machine output, and nearly all the play-by-play. What you get back is one short, readable answer at the end. Whether it saves you money depends on how much your commands print — a lot, and it pays for itself; a little, and it costs you a little.

---

## What is this?

Claude talks a lot while it works. "Let me look at the codebase." "Now I'll check the config." Then four hundred lines of build output you never asked for. And at the very end, the one sentence you actually needed.

hush trims that bulk — logs, command output, play-by-play — at the source, before Claude has to read any of it back. It earns its keep in sessions that read logs, run builds, and keep going turn after turn. A short question that runs nothing has nothing to trim. There you pay a little more for the quieter reply.

And the one message you do get is built to be read on an empty tank. Answer first. Everyday words. One fact per sentence. It aims for six lines, and sentences of about ten words. Made for ADHD readers, and for anyone fried at the end of a long day.

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

We gave the same eight jobs to plain Claude Code, and to Claude Code with hush. Real sessions: it reads files, edits code, runs commands. Noisy builds, big log files, wide renames, and long jobs where the plan keeps changing. Every price below is the real bill from the API.

<p align="center"><img src="assets/bench-cuts.svg" alt="What hush cuts, averaged per session over the same 8 jobs on Sonnet. command output: no plugin 29.3k chars, hush 13.7k chars, minus 53%. chatter while working: no plugin 52 words, hush 6 words, minus 89%. words Claude wrote: no plugin 4,896 tok, hush 4,163 tok, minus 15%. cost per session: no plugin $0.2548, hush $0.2266, minus 11%." width="700"></p>

**hush cuts the noise, and this run it cut the bill too.** Command output drops by half, and the running commentary all but disappears. The 11% saving is one run, though, and the direction has flipped before. Whether hush saves you money depends on your work. [The next table](#when-it-saves-you-money-and-when-it-costs-you) says exactly when.

**And you read it in silence.** hush finished the whole session without a word of play-by-play in 11 jobs of 16 — plain Claude Code managed that in 4. It still speaks up to flag something you would want to stop, or when it is stuck and needs you.

### When it saves you money, and when it costs you

It comes down to one thing: **how much your commands print.**

A step is one round trip: Claude thinks, runs something, reads the result. hush carries its writing rules along on every one of those. That is a small fixed cost, paid every step. It earns the cost back by trimming what your commands print. When there is little to trim, you just pay it.

Here is every job from the run, ordered by how much its commands printed:

| The job | printed per step | no plugin | hush | change |
| --- | --- | --- | --- | --- |
| Build a notification router while the plan changes four times | 0.6k | $0.284 | $0.361 | +27% |
| Get a build clean again after a dependency bump | 1.0k | $0.125 | $0.142 | +13% |
| Fix a red test suite hiding three real failures | 1.3k | $0.138 | $0.145 | +5% |
| Dig through 300 KB of logs for the cause of an outage | 1.4k | $0.262 | **$0.230** | **−12%** |
| Finish a half-done rename across 76 files | 3.0k | $0.451 | **$0.367** | **−19%** |
| Scope a column rename that matches a thousand lines | 3.0k | $0.119 | $0.124 | +4% |
| **— around here the two swap places —** | **~3.5k** | | | |
| Find what actually changed for users across 380 commits | 7.5k | $0.450 | **$0.330** | **−27%** |
| Triage a 57 KB application log | 15.1k | $0.209 | **$0.114** | **−45%** |

The line sits at about **3,500 characters printed per step**. We checked it against 48 job-and-run pairs drawn from seven separate runs, and 47 of them land on the right side of it. Six of the eight jobs above do — the two that don't are the closest calls on the board.

**So: if your day is builds, logs and big searches, hush pays for itself. If it is small edits and short commands, it costs you a little.** Every setup got every job right this run, 16 of 16 each, so none of this was bought with a wrong answer.

### Reading it is the other half

Saving money is only half of it. The other half is whether you can read the answer. So we scored the one final message each setup wrote, using measures that have been around for decades — reading ease, US school grade level, sentence length, and how many long words it uses.

Racing beside hush: Claude Code's own **Concise** style, which ships in the tool and costs nothing, plus three community styles — [i-have-adhd](https://github.com/ayghri/i-have-adhd), built for ADHD readers, [simple-english](https://github.com/AminBlg/SimpleEnglish), the controlled English aerospace writes manuals in, and [caveman](https://github.com/JuliusBrussee/caveman), which strips answers to the bone. Same eight jobs, same run, on Sonnet.

| Setup | words | words per sentence | long words | reading ease | grade level | silent sessions |
| --- | --- | --- | --- | --- | --- | --- |
| no plugin | 126 | 18.3 | 11.6% | 60.5 | 9.4 | 4 of 16 |
| **hush** | 82 | 12.2 | **6.8%** | **77.1** | **5.5** | **11 of 16** |
| Concise (built in) | 112 | 15.6 | 11.6% | 63.4 | 8.3 | 4 of 16 |
| i-have-adhd | 87 | 15.7 | 11.0% | 63.3 | 8.3 | 4 of 16 |
| simple-english | 149 | 15.8 | 11.6% | 61.9 | 8.5 | 2 of 16 |
| caveman | **74** | **9.7** | 9.6% | 70.0 | 5.9 | 4 of 16 |

Higher reading ease is easier. Lower grade level is easier.

**hush reads easiest of the pack *and* goes quiet.** Nearly four school grades easier than plain Claude Code, and the fewest long words on the board — and it is still the one that finishes a session in silence most often, by a wide margin. caveman writes shorter messages but not simpler ones. The honest loss: hush leaves you something you can copy and run 81% of the time, plain Claude 100%.

### On the bigger model the gap is wider

The table above is Sonnet. On Opus, plain Claude Code writes a *lot* more, and hush cuts a *lot* more:

| Setup | words | lines | long words | reading ease | grade level |
| --- | --- | --- | --- | --- | --- |
| no plugin | 520 | 20.5 | 10.5% | 69.6 | 6.7 |
| **hush** | **49** | **4.0** | **4.3%** | **91.8** | **1.9** |

That is a 500-word wall of text against four lines. The bill lands in the same place either way, $0.71 a session both ways. Play-by-play drops from 81 words a session to 6 — though full silence is rarer here than on Sonnet, 3 sessions of 16 against 11.

Here is what that reads like. A real final message from this run, the dependency-bump job, exactly as hush wrote it:

> Builds clean now, 0 errors.
>
> Two real bugs were hiding under all that deprecation noise, both from the bundler's new options shape:
>
> 1. `src/core/options.js` still read `options.retries`, but the new bundler sends `options.retryCount`. That threw because `retries` was `undefined`.
> 2. `src/net/retryPolicy.js` only accepted `true` or `false` for the backoff flag. The new config loader leaves unset flags as `undefined`, which isn't either, so it threw too.
>
> Fixed both. `node build.js` now finishes in 44.9s with 8 warnings, 0 errors, exit code 0.

### Why not just use Concise?

Claude Code ships its own **Concise** style. It costs nothing and it is already on your machine, so it is a fair thing to ask. The difference is what each one can reach. Concise is a set of writing rules, so it makes Claude write less — but it cannot change what your commands print. Over the same eight jobs it read back 29.2k characters of command output per session, against 29.3k with no plugin at all. That is no cut. hush read back 13.7k, because it trims the output on the way in.

The line from the table above applies here too. On the loud jobs hush came out well ahead of Concise — 55% cheaper on the log triage, 23% on the release digest, 9% on the outage dig. So if your day is small edits and short commands, take Concise: it is free and already there. If your commands print a lot, hush is the one that pays for itself. Against Concise it also goes quiet far more often, 11 sessions of 16 against 4, says 6 words of play-by-play against 45, reads nearly three school grades easier, and keeps a copy of everything it trimmed.

*How we tested: eight jobs, six setups, two runs each, in fresh throwaway folders, on Sonnet, plus the same eight jobs two ways on Opus. Real sessions from start to finish, never a single canned reply, and every price read back from the API. One row can swing ten or twenty points between runs, so read the direction, not the decimal — the ordering by how much a job prints is what held up across seven separate runs. Reproduce it yourself: [the marketplace repo](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush).*

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
- **Showing what it kept out.** Beside the parked output hush keeps a running count, in `saved.json` — characters in, characters actually delivered. Claude Code has one status line and hush doesn't take it, so read the count from your own script:

```js
// statusline.js — point Claude Code's statusLine command at: node statusline.js
const fs = require('fs'), os = require('os'), path = require('path');
let stdin = '';
process.stdin.on('data', (d) => (stdin += d)).on('end', () => {
  const id = String(JSON.parse(stdin).session_id).replace(/[^a-zA-Z0-9-]/g, '_');
  const dir = process.platform === 'win32' ? id.toLowerCase() : id;
  try {
    const t = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'hush-sidecar', dir, 'saved.json'), 'utf8'));
    process.stdout.write(`hush kept out ${Math.round((1 - t.out / t.in) * 100)}% of ${t.in} characters`);
  } catch {
    /* nothing trimmed yet this session */
  }
});
```

- **On Windows, one protection is missing.** hush writes those files just as carefully, but Windows can't lock them to your account alone. Treat parked output there as readable by anything running as you.

## License

MIT — see [LICENSE](./LICENSE).
