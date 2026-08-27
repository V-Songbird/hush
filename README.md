<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Claude talks a lot while it works, and you pay for every word. hush turns down the chatter.</strong></p>

  <img src="assets/hero.svg" alt="A poster of the whole benchmark suite as one waveform, one spike per run — words of play-by-play before the answer. Left of the hush-installed divider, 16 sessions without the plugin spike to 83 words. Right of it, the same 16 sessions with hush run flat: silent in 10 of 16, nothing over 9 words. It reads: Quiet." width="700" />

  <p><em>The same eight jobs the tables below measure, on the default setting, on Opus 5 at medium effort. 16 sessions each way.</em></p>
</div>

<p align="center">
    <a href="https://github.com/V-Songbird/hush/stargazers"><img src="https://img.shields.io/github/stars/V-Songbird/hush?style=social" alt="GitHub stars"/></a>
    <a href="https://github.com/V-Songbird/hush/blob/main/LICENSE"><img src="https://img.shields.io/github/license/V-Songbird/hush" alt="License"/></a>
    <a href="https://docs.anthropic.com/en/docs/claude-code"><img src="https://img.shields.io/badge/Claude_Code-E5582B" alt="Claude Code"/></a>
</p>

> **TL;DR** — Claude talks a lot while it works, and dumps every log line into the conversation. hush cuts that noise: a big slice of the machine output, and nearly all the play-by-play. What you get back is one short, readable answer at the end. On the newest models the cut reaches Claude's own reply too — on our latest run it came out cheaper on seven of the eight jobs.

---

## What is this?

Claude talks a lot while it works. "Let me look at the codebase." "Now I'll check the config." Then four hundred lines of build output you never asked for. And at the very end, the one sentence you actually needed.

hush trims that bulk — logs, command output, play-by-play — at the source, before Claude has to read any of it back. It earns its keep in sessions that read logs, run builds, and keep going turn after turn. A short question that runs nothing has nothing to trim. There you pay a little more for the quieter reply.

And the one message you do get is built to be read on an empty tank. Answer first. Everyday words. One fact per sentence. It aims for six lines, and sentences of about eight words. Made for ADHD readers, and for anyone fried at the end of a long day.

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

## Just the voice, no plugin

You don't have to install anything from a marketplace. The writing voice is a single Markdown file. Claude Code reads it on its own.

Here is the honest split. Claude Code calls a writing voice an **output style**, and that file gives you one. You get the silence while it works, and the one short final message. You do **not** get the trimming of command output and log files. That part needs the plugin. The voice is what makes the answer readable. The trimming is what saves you money.

**The easy way — ask Claude to do it.** Paste this into any Claude Code session:

```
Fetch https://raw.githubusercontent.com/V-Songbird/hush/main/output-styles/hush.md
and save it, unchanged, to ~/.claude/output-styles/hush.md — create that folder if
it isn't there. Then set "outputStyle": "Hush" in ~/.claude/settings.json, keeping
whatever else that file already has. Tell me when it's done.
```

Swap `~/.claude` for `.claude` in that prompt to set it up for one project instead. Then restart the session.

**Or do it by hand.** Save the file as one of these:

| Where you put it | Who gets it |
| --- | --- |
| `~/.claude/output-styles/hush.md` | You, in every project |
| `.claude/output-styles/hush.md` in a repo | That project only — check it in and your team gets it too |

Then pick **Hush** under Output style in `/config`, or write it into a settings file yourself:

```json
{
  "outputStyle": "Hush"
}
```

It takes effect at your next session. Install the plugin later and it brings its own copy — delete your hand-placed file then, so there's only one Hush on the list.

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

We gave the same eight jobs to plain Claude Code, and to Claude Code with hush. Real sessions on Opus 5 at its recommended medium effort: it reads files, edits code, runs commands. Noisy builds, big log files, wide renames, and long jobs where the plan keeps changing. Every price below is the real bill from the API.

<p align="center"><img src="assets/bench-cuts.svg" alt="What hush cuts, averaged per session over the same 8 jobs on Opus 5 at medium effort. command output: no plugin 26.9k chars, hush 16.9k chars, minus 37%. chatter while working: no plugin 29 words, hush 3 words, minus 91%. words Claude wrote: no plugin 5,995 tok, hush 3,593 tok, minus 40%. cost per session: no plugin $0.6001, hush $0.4703, minus 22%." width="700"></p>

**hush cuts the noise, and this run it cut the bill too.** On the big model the cut reaches two places at once: what your commands print, and what Claude itself writes — 40% fewer words out of the model per session. The 22% saving is one run, though, and single jobs have flipped direction before. [The next table](#when-it-saves-you-money-and-when-it-costs-you) shows every job.

**And you read it in silence.** hush finished the whole session without a word of play-by-play in 10 jobs of 16 — plain Claude Code managed that in 0. It still speaks up to flag something you would want to stop, or when it is stuck and needs you.

### When it saves you money, and when it costs you

Two things get trimmed: **what your commands print**, and **what Claude itself writes**.

A step is one round trip: Claude thinks, runs something, reads the result. hush carries its writing rules along on every one of those. That is a small fixed cost, paid every step. It earns the cost back twice over — by trimming what your commands print, and by keeping Claude's own reply short. On Opus 5 the second cut is big, so this run hush came out cheaper on seven of the eight jobs.

Here is every job from the run, ordered by how much its commands printed:

| The job | printed per step | no plugin | hush | change |
| --- | --- | --- | --- | --- |
| Build a notification router while the plan changes four times | 0.5k | $0.839 | **$0.662** | **−21%** |
| Get a build clean again after a dependency bump | 1.0k | $0.266 | **$0.250** | **−6%** |
| Dig through 300 KB of logs for the cause of an outage | 1.4k | $0.859 | **$0.538** | **−37%** |
| Fix a red test suite hiding three real failures | 2.5k | $0.263 | **$0.257** | **−2%** |
| Scope a column rename that matches a thousand lines | 2.8k | $0.400 | **$0.383** | **−4%** |
| Finish a half-done rename across 76 files | 3.6k | $0.824 | $0.868 | +5% |
| Triage a 57 KB application log | 4.0k | $0.487 | **$0.269** | **−45%** |
| Find what actually changed for users across 380 commits | 8.3k | $0.864 | **$0.534** | **−38%** |

The loud jobs still cut the most — the two loudest cut 38% and 45%. The one job hush cost money on was the 76-file rename, and the gap was 5%. One row can swing between runs, so read the direction, not the decimal.

**So: the louder your commands, the bigger the win, and on Opus 5 even quiet jobs mostly came out ahead.** Every setup got every job right this run, 16 of 16 each, so none of this was bought with a wrong answer.

### Reading it is the other half

Saving money is only half of it. The other half is whether you can read the answer. So we scored the one final message each setup wrote, using measures that have been around for decades — reading ease, US school grade level, sentence length, and how many long words it uses.

Racing beside hush: Claude Code's own **Concise** style, which ships in the tool and costs nothing, plus three community styles — [i-have-adhd](https://github.com/ayghri/i-have-adhd), built for ADHD readers, [simple-english](https://github.com/AminBlg/SimpleEnglish), the controlled English aerospace writes manuals in, and [caveman](https://github.com/JuliusBrussee/caveman), which strips answers to the bone. Same eight jobs, same run, on Opus 5 at medium effort.

| Setup | words | words per sentence | long words | reading ease | grade level | silent sessions |
| --- | --- | --- | --- | --- | --- | --- |
| no plugin | 379 | 12.3 | 9.7% | 70.7 | 6.5 | 0 of 16 |
| **hush** | **43** | **5.8** | **5.3%** | **86.5** | **2.6** | **10 of 16** |
| Concise (built in) | 262 | 12.8 | 9.5% | 68.3 | 6.9 | 1 of 16 |
| i-have-adhd | 358 | 12.6 | 10.1% | 69.5 | 6.7 | 0 of 16 |
| simple-english | 302 | 8.4 | 6.6% | 82.4 | 3.9 | 0 of 16 |
| caveman | 223 | 7.8 | 10.2% | 72.0 | 5.2 | 6 of 16 |

Higher reading ease is easier. Lower grade level is easier.

**hush writes the shortest message, reads easiest, *and* goes quiet.** Four school grades easier than plain Claude Code, a ninth of the words, and the most silent sessions by a wide margin. simple-english gets close on reading ease — while writing seven times the words and never finishing a session in silence. The honest loss: hush leaves you something you can copy and run 81% of the time, plain Claude 100%.

### The smaller model tells the same story

The tables above are Opus 5. The same eight jobs on Sonnet read the same direction:

| Setup | words | lines | long words | reading ease | grade level | silent sessions |
| --- | --- | --- | --- | --- | --- | --- |
| no plugin | 160 | 5.5 | 10.9% | 61.7 | 9.0 | 4 of 16 |
| **hush** | **61** | **5.0** | **9.3%** | **72.1** | **5.4** | **13 of 16** |

Play-by-play drops from 43 words a session to 4, and the bill lands in the same place, about a quarter dollar a session both ways. All 32 sessions got the job right.

Here is what that reads like. A real final message from this run, the dependency-bump job, exactly as hush wrote it:

> Two real bugs, both from the bump. Build now exits 0.
>
> - `options.js` read `options.retries`, but the bundler now sends `retryCount`. It now takes either.
> - `retryPolicy.js` threw on an unset flag. `undefined` now means `false`, the old default.
>
> The 8 warnings left are deprecation notices from the bumped packages.

### Why not just use Concise?

Claude Code ships its own **Concise** style. It costs nothing and it is already on your machine, so it is a fair thing to ask. The difference is what each one can reach. Concise is a set of writing rules, so it makes Claude write less — but it cannot change what your commands print. Over the same eight jobs it read back 24.9k characters of command output per session, against 26.9k with no plugin at all. Barely a cut. hush read back 16.9k, because it trims the output on the way in.

On the bill the two came out close this run — Concise's average was a few percent lower, and hush's one losing job carries most of that gap. On the loud jobs hush was well ahead: 37% cheaper on the log triage, 26% on the release digest. Where they truly part is everything else. hush goes quiet in 10 sessions of 16 against Concise's 1, says 3 words of play-by-play against 13, writes 43 words where Concise writes 262, reads four school grades easier, and keeps a copy of everything it trimmed.

*How we tested: eight jobs, six setups, two runs each, in fresh throwaway folders, on Opus 5 at medium effort, plus the same eight jobs two ways on Sonnet. Real sessions from start to finish, never a single canned reply, and every price read back from the API. One row can swing ten or twenty points between runs, so read the direction, not the decimal. Reproduce it yourself: [the marketplace repo](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush).*

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
