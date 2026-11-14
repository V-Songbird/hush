# Hush

**You asked for a change. Read what changed.**

**Available on** [Claude Code](#claude-code), the primary host. Hush has no Codex package and no Antigravity package.

[Get started](#install) · [What is this?](#what-is-this) · [How it works](#how-it-works) · [What you can do](#what-you-can-do) · [Evidence](#the-numbers)

## What is this?

You ask the assistant to fix a failing test. It reads files, runs commands and explains each step. By the time it finishes, the result is hard to find in the conversation. Hush reduces that reading.

It quiets routine narration, shortens noisy tool output and shapes the final answer around what changed, whether it worked and what comes next. The measurements below describe recorded sessions; they are not a promise for yours.

## Why you'd want it

- Read the result with less narration along the way.
- Keep long command output from filling the conversation.
- Inspect retained full output when you need more detail.

## How it works

Hush is a writing voice plus a set of small trims. Everything runs on your machine, and nothing is sent anywhere.

**The voice.** Claude Code calls it an output style. It tells the assistant to stay quiet between tool calls, then write one message at the end, in your language: the result in one bold line, the cause in one sentence, room only for checks that did not pass, and one exact next step that stands on its own and also says whether the session is finished, where the app can archive it. Passed checks give each command's counts as the runner printed them and name every failed test. Most messages fit in about 250 words outside code, at most 12 words per sentence and 40 per block. It applies whenever the plugin is enabled and holds Claude Code's one output style slot; to use another style, disable or uninstall Hush.

**The trims.** When a command finishes, Hush looks at what came back:

| What came back | What Hush does |
| --- | --- |
| Short, under 4,000 characters | Lets it through. Exact repeats fold into one line and a count. |
| A long clean run | Folds runs of five or more same-shape lines, then keeps up to 60 lines: the first stretch, the last stretch, and every warning, error and failure line. |
| A long failing run | Keeps up to 250 lines the same way, plus what sits next to a failure: stack frames and the values a test runner prints for a failed check. |
| Very large, 15,000 characters or more | Saves the output to a file on your machine and hands the assistant a digest: the first 20 and last 15 lines, the first and last 10 warning, error and failure lines with line numbers, and a count of each. |

The saved file lets the assistant read the rest, but only if it decides it needs to. Without it, a 300 KB log would be re-sent on every later turn.

Claude Code itself cuts a long shell result at its `bashOutputMaxChars` setting, else at `BASH_MAX_OUTPUT_LENGTH`, else at 30,000 characters. When a result arrives at that cut, Claude Code keeps the complete result in its own file, and Hush's digest points the assistant there first; Hush still saves the part it received, as a fallback. Hush reads `bashOutputMaxChars` from your user, project and local settings files, not from managed settings or a `--settings` flag.

Some output comes back whole, up to 250 lines: directory listings, line-range prints (`sed -n`, `head`, `tail`), `git diff` and `git show`, whole reads of source files, and, when a run did not fail, JSON or a numeric table. They have no warning lines for a trim to keep, so cutting them only makes the assistant fetch them again. Past 250 lines they are trimmed, and from 4,000 characters only exact repeats fold. From 15,000 characters they are saved to a file like any other output, JSON included, because a few lines of compact JSON can hold any amount of data. When your prompt asks for every item of something, such as "list every warning", the cap rises to 2,000 lines and nothing is folded or saved to a file.

The Read tool gets the failing-run trim on logs and on files nobody writes by hand: lockfiles, minified bundles, anything under `node_modules` or `dist`. Other files, and any read with an offset or a limit, come back untouched. A Grep list of 4,000 characters or more keeps the first 3 matches in each file and every match that reads like a warning or error, counts the rest per file and saves the full list to a file.

The caps on clean and failing runs shrink as a session grows: to three quarters past 400 KB of conversation and half past 1 MB, never below 30 lines for a clean run or 125 for a failing one. The 250-line cap above does not shrink.

A shortened view carries a note in square brackets, such as `[hush hook: 12 lines omitted from this view, none with warnings/errors/failures]`. Hush never cuts a warning, error or failure line from a trimmed view and never edits your files. If a saved file is gone, the assistant is told to run the command again.

**Failing commands.** Claude Code guards the output of a failing command, so Hush may trim it only when the session no longer asks you to approve each step, or when you set `HUSH_WRAP=1`. Otherwise failing output arrives in full. [Settings](#settings) explains `HUSH_WRAP=1`.

**Reminders.** A rule read once fades as a session grows, so Hush repeats it when it has to: a short reminder at the start of each of your turns, and a shorter one the first time chatter slips through. A turn the harness starts, such as a task notification, gets its own: when nothing is new, it ends with no message or one short line. A quiet session pays nothing extra.

**Compaction and subagents.** Before Claude Code compacts a conversation, Hush asks the summary to keep every path, identifier, command, version, error and decision word for word, and names up to 20 saved files. An output style never reaches a subagent, so each subagent gets a short brief: return the findings, mark what could not be confirmed, and write nothing between tool calls.

**Where saved output goes.** A `hush-sidecar` folder in your system temp folder, one per session. On macOS and Linux only you can read it; on Windows that lock is not available, so treat it as readable by anything running as you. Hush deletes the folder when the session ends, and also removes session folders idle for a day.

**The desktop mod.** Hush also ships an optional mod, code that Claude Code loads to draw in its interface. The command hooks above are the product: every one runs as before without the mod. In the Claude desktop app's Code tab only, once a final message arrives, the mod folds the progress texts written between tool calls into one grey line, "Show N progress messages". One press shows them in place. The line counts failed results and texts that name a failure, and its words follow Claude Code's `language` setting, Spanish or English.

A text whose first words appear elsewhere in the session, a subagent's included, stays drawn. So does every text after a prompt you queued during the turn, and every text before a compaction. Each session keeps its folds across a reopen, for the eight newest sessions. Every other reply, and every other surface, the terminal included, is left to the app whole. The mod adds no command and nothing leaves your machine.

## What you can do

| You want to | Outcome |
| --- | --- |
| Read the result first | Short, plain answers focused on the result |
| Inspect shortened output | A reference to the saved full result where available |
| Change the answer's layout | `/hush:config`, described under [Settings](#settings) |
| Turn off a session control | One environment variable per control, listed under [Settings](#settings) |
| Show what Hush kept out | A status-line script, below |

### Showing what Hush kept out

Hush keeps a running count in `saved.json` in the session's `hush-sidecar` folder: `in` is the characters it received and `out` the characters it delivered. Claude Code has one status line and Hush does not take it, so read the count from your own `statusLine` script, for example `1 - out / in` as a percentage. The folder is named for the session id, lowercased on Windows.

### Settings

Most people never touch these. Hush trims one way, always: no levels, no profiles. Everything you can set is here.

#### Session controls

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything Hush does: no trimming, no reminders, no files written, and the desktop mod folds nothing. The writing voice stays on until you disable or uninstall the plugin. |
| `HUSH_CORE=off` | Stops the trims and what goes with them: no trimmed output, no saved files, no command wrapping, nothing added at compaction, no cleanup at session end. Reminders and the subagent brief keep running, and the step reminder's small counter stays in your temp folder until your system clears it. |
| `HUSH_QUIET=off` | Stops every reminder and the subagent brief. The trims, the voice and your message settings keep running. |
| `HUSH_NUDGE=off` | Stops every reminder sent while the assistant works. The subagent brief keeps running. |
| `HUSH_NUDGE=max` | The quietest and most expensive setting: the step reminder, sent twice, after every tool call, besides the turn reminder. |
| `HUSH_SIDECAR=off` | Never saves output to a file. A very large output gets the normal trimmed view instead of a digest, and a shortened Grep list has no full copy to read back. |
| `HUSH_GREP=off` | Grep match lists arrive whole, however long. |
| `HUSH_TEMPLATE=off` | Runs of same-shape lines are no longer folded. Exact repeats still fold. |
| `HUSH_COMPACT=off` | Leaves compaction to Claude Code: Hush no longer asks the summary to keep paths and identifiers word for word, or lists the saved files. |
| `HUSH_SUBAGENT=off` | Subagents start without Hush's brief. |
| `HUSH_DEBUG=1` | Writes a local record of what Hush did to each command result (sizes in and out, and where the full copy went) to `hush-debug-<session>.jsonl` in your system temp folder. Hush never deletes these files. |
| `HUSH_WRAP=1` | Lets Hush trim failing commands as well as passing ones. See below. |
| `HUSH_CONFIG_FILE=<path>` | Where `/hush:config` saves your message settings. The default is `~/.claude/hush/config.json`. |

`HUSH_DISABLE` beats every other switch, and `HUSH_CORE` and `HUSH_QUIET` beat every switch inside what they stop: with `HUSH_QUIET=off`, `HUSH_NUDGE=max` does nothing. Every switch shown as `off` also takes `0` or `false`, in any letter case, and ignores spaces around the value. The switches shown as `1` take only `1` and ignore spaces around it.

**`HUSH_WRAP=1`** wraps each Bash and PowerShell command so its exit code survives, which lets Hush trim a failing build like a passing one. In `bypassPermissions` mode Hush wraps even without it. It is safe with `bypassPermissions` or blanket grants such as plain `Bash` or `PowerShell` in your allow rules. It is not safe with scoped allow rules such as `Bash(node*)`: Claude Code checks the wrapped command statement by statement, the wrapper's extra statements match no rule, and every wrapped command is denied. Start Claude Code with `HUSH_WRAP=1 claude` in bash, or `$env:HUSH_WRAP = '1'; claude` in PowerShell, which leaves it set for that window until `Remove-Item Env:HUSH_WRAP`. Every published number was measured with it set.

#### Output style

Installing Hush does not write Claude Code's Output style setting, and the voice does not need it. Every published number was also measured with this line in `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

#### Message settings

`/hush:config` shapes the final message. In the Claude desktop app it opens a configurator with a sample message and its word count. In a terminal it asks seven questions, or eight if you say you read in the desktop app. You can also describe what you want in your own words, as in `/hush:config only the result and the next step`. Settings no choice covers, such as `why` and `records`, keep their saved values. Your choice is saved in `~/.claude/hush/config.json`.

No setting removes the floor: a blocker, a pending approval, an unverified claim or anything left unchecked always stays in the message. A failed check opens its block with the error quoted word for word, and failed and unchecked items stay under every `checks` value.

| Preset | What you get |
| --- | --- |
| `standard` | Every setting at its default |
| `minimal` | The bold result, the next step, and only the floor |
| `explainer` | No next step, up to 400 words, terms explained in place, sentences up to 20 words |
| `terminal` | Plain text for a terminal; the box never asks |

| Setting | Values, default first | What changes |
| --- | --- | --- |
| `next` | `end`, `top`, `off` | Where the "Next:" line goes, or none; a decision only you can make still appears as a question. The session-archive check moves with `top` and goes unsaid with `off` |
| `rules` | `on`, `off` | Whether horizontal rules separate the parts |
| `detail` | `normal`, `short`, `full`, `bare` | About 250, 80 or 400 words outside code; `bare` keeps only the result, the next step and the floor |
| `why` | `on`, `off` | The one sentence on what caused what |
| `checks` | `line`, `each`, `off` | Passed checks in one sentence, a bullet each, or none; failed and unchecked items stay |
| `caveats` | `each`, `floor` | Every risk and limit, or only the floor with a link to the rest; under `detail=bare` there is no link |
| `records` | `line`, `off` | The closing line of docs and memory written |
| `terms` | `footnote`, `inline`, `none` | How an unfamiliar term is explained |
| `markdown` | `rich`, `basic`, `plain` | Every form the desktop app renders, common Markdown only, or terminal text |
| `files` | `card`, `link` | A whole file comes as a file card above the message, or as a link in the text. A line in a file is always a link. Without the desktop app's file tool, every file is a link |
| `sentences` | `12`, `20` | Words per sentence, tops |
| `headers` | `off`, `on` | A short bold header opens each block and names its kind; with `emoji=on` the emoji sits in the header |
| `emoji` | `off`, `on` | One emoji opens each block to show its kind. Screen readers read each emoji's name aloud |
| `box` | `decisions`, `work`, `text` | When the desktop app's next-step box asks: on any turn with a decision of yours, only after work, or never, leaving the step to the "Next:" line |

The box exists only in the desktop app; in a terminal the "Next:" line carries the step under any `box` value. At session start, and after compaction, a hook hands any setting you changed to the assistant as a short reminder; with every setting at its default it adds nothing, and only `HUSH_DISABLE=1` stops it. A missing or broken settings file falls back to the defaults. From the plugin folder, `node hooks/style-settings.js show`, `presets`, `set preset=minimal next=top` and `reset` print, apply and clear settings.

## Install

### Claude Code

Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Start a new session to load the plugin.

Requirements: Claude Code 2.1.323 or later, and Node.js 22 or later. hush names that version in its manifest, but an older Claude Code may still install it; hush is not tested there.

### Update

```text
/plugin marketplace update foundry
/plugin update hush@foundry
```

Then start a new session.

## Good to know

Correctness comes before silence. A short answer can omit a useful detail, and quieter sessions do not always cost less. Ask for depth when you need it, and check the result before acting.

Full-output references point to temporary files. Disabling the session controls leaves the writing style on; disable the plugin to turn it off.

The desktop mod is optional and draws only in the Claude desktop app's Code tab. It is new, and no rendered check of it is published here.

## The numbers

Each test session is a real Claude Code session in its own throwaway folder. Nine jobs span how much a session prints, from a plan with no edits to a 300 KB outage log. Every job ends with a check, and a short answer that breaks the job counts as a failure. Prices are the bill read back from the API. Prose words exclude fenced code. These observations do not guarantee the same behavior in your sessions, and results vary between runs. All results are from Claude Code.

### Claude Code results

#### Claude Opus 5.5, voice 1.13.0

Batch `o55-451-495ce18f`, started September 28, 2026: nine fixture jobs, four runs per setup, 36 sessions each, in Claude Code with Claude Opus 5.5 (model id `claude-opus-5-5`) at the default effort. Hush ran with `HUSH_WRAP=1`, set in bash as `HUSH_WRAP=1 claude` and in PowerShell as `$env:HUSH_WRAP = '1'; claude`. This measures the voice released as 1.13.0, not the current one.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5.5"],"date":"2026-09-28","reviewedAt":"2026-11-14"} -->
| Model | Setup | Jobs right | Spoke at most once before the answer | Median final prose words | Average bill per session |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | No plugin | 36/36 | 28/36 | 369 | $0.421 |
| Claude Opus 5.5 | hush | 36/36 | 36/36 | 271 | $0.458 |

Hush said nothing at all before the answer in 34 of 36 sessions, against 12 of 36 without a plugin, and sent 1.0 word of play-by-play per session against 15.4. The medians are 369 and 270.5, rounded, about 27% shorter. Sentences were shorter too: 0.5% ran past 20 words against 10.9%. Runnable content appeared in all 36 answers of both setups; that text heuristic does not check that a command is correct or complete.

**On Opus 5.5, Hush costs more.** The average bill per session was 9% higher. Seven of the nine jobs cost more, by 4% to 32%, and four of those are above about 16%, the largest gap that batch showed between two near-identical setups. Only the two jobs whose commands print the most came out cheaper: the 57 KB log by 19% and the 380 commits by 4%. Opus 5.5 already writes less without a plugin, so Hush has less to remove. Everything the assistant wrote per session was 6% higher, 3,654 tokens against 3,453, while what the commands printed fell 9%, 22.2k characters against 24.4k. Treat a per-job cost difference under about 16% in this batch as noise.

Hush's gain is partly separate from length. In three jobs, the red test suite, the notification router and the half-done rename, Hush wrote more prose words on average, and in the first two every Hush session was longer than every no-plugin session. Hush messages still held 52.3% of their words in blocks over 40 words on average, against 78.3% without a plugin.

A fresh Claude Sonnet session that got only the request and the final message answered all three questions (what happened, what to open or run, what to do next) for 100% of Hush answers and 94.4% of no-plugin answers; the two no-plugin misses came from the notification router job. This test moves a few points between runs on its own. A message linked the file to open with a line number in 29 of 36 Hush sessions and none of 36 without a plugin.

#### Claude Opus 5.5, 40 words per block

The voice now also caps each block of the final answer at 40 words; a block is the text between two blank lines. The figures above do not measure that rule. Batch `o55-888-1bec0539`, started September 28, 2026: the same nine jobs, four runs per setup, 36 sessions each, Claude Opus 5.5, default effort, `HUSH_WRAP=1`, with no no-plugin setup. It compares the 1.13.0 build with the same build plus the block rule.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5.5"],"date":"2026-09-28","reviewedAt":"2026-11-14"} -->
| Claude Opus 5.5, 36 sessions each | hush 1.13.0 | hush with the block rule |
| --- | --- | --- |
| Jobs right | 36/36 | 36/36 |
| Median final prose words | 283 | 256 |
| Words in blocks over 40 words, mean | 59.1% | 45.3% |
| Words in blocks over 40 words, median | 62.3% | 50.0% |
| Notes that link the file with a line number | 27/36 | 29/36 |
| A fresh reader could answer all three questions | 100% | 100% |
| Everything Claude writes in a session | 3,938 tok | 3,490 tok |
| Average bill per session | $0.461 | $0.452 |

The rule cut the share of words in long blocks by 13.8 points, in 7 of the 9 jobs (exact two-sided sign-flip p 0.016), and cost no correctness. The cost difference is within this batch's noise: per job it ranged from 23% cheaper on the half-done rename to 31% dearer on the release notes. Compare these two setups only with each other; the same 1.13.0 voice held 52.3% of its words in long blocks in the first batch and 59.1% here, and the two batches ran different tool-output compression.

#### Claude Sonnet 5.5, voice 2.0.0 build

Batch `b31-quiet-0c14009e`, started October 13, 2026, in Claude Code with Claude Sonnet 5.5 (model id `claude-sonnet-5-5`) at the default effort: two runs of eleven jobs per setup, 22 sessions each, shuffled inside each job and repetition. Hush ran with `HUSH_WRAP=1` from a build whose manifest read 2.0.0; it also carried part of the voice a later release shipped. The eleven jobs are the nine above plus a listing of 167 locale files and the three bad rows in a 151-line stretch of a 1,600-row CSV file. Compare these figures only with each other: the same build's bill per session has moved by about 5% between batches.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Sonnet 5.5"],"date":"2026-10-13","reviewedAt":"2026-11-14"} -->
| Claude Sonnet 5.5, 22 sessions each | no plugin | hush |
| --- | --- | --- |
| Jobs right | 20/22 | 22/22 |
| Spoke at most once before the answer | 17/22 | 22/22 |
| Said nothing at all | 14/22 | 21/22 |
| Total mid-work messages | 14 | 1 |
| Words of play-by-play, per session | 10.2 | 1.1 |
| Median final prose words | 293 | 231 |
| Sentences over 12 words | 32.8% | 15.8% |
| Words in blocks over 40 words, mean | 74.1% | 46.8% |
| Average bill per session | $0.164 | $0.174 |

Both no-plugin misses came from the `--json` flag plan: Claude planned without reading the code, and neither plan named the files the job's check needs. Hush still wrote about one sentence in six over its own 12-word limit, and kept almost half of each message in blocks over 40 words. Hush cost 6% more per session, and two sessions per job are too few to tell a difference that size from noise.

Each job has a fixed answer key of required facts, matched by code or judged by a Claude Sonnet session that must quote its source. Nine jobs have a key; the two new jobs have none, and the notification router is left out because its facts arrive in later prompts. Over 8 jobs and 16 sessions each, Hush carried 88.8% of required facts against 79.2%, and 11 of 16 sessions carried every fact against 10 of 16. The gap comes from one job: the two no-plugin `--json` plans carried none of its facts. Over the other seven jobs, no plugin carried 90.5% and Hush 87.1%. Hush carried more on 2 of the 8 jobs and less on 2 (p 0.875).

#### Claude Opus 5, September 1, 2026

Batch `rivalA-762f888b`, started September 1, 2026 at 07:34 UTC: nine jobs, four runs per setup, 36 sessions each, in Claude Code with the `opus` alias (identified as Opus 5 by the published source) at medium effort, `HUSH_WRAP=1`. The hush sessions ran hush 1.11.1, the release current when the batch started; the records do not store a version. This is an earlier voice than the one measured above.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5"],"date":"2026-09-01","reviewedAt":"2026-11-14"} -->
| Claude Opus 5, 36 sessions each | Jobs right | Spoke at most once before the answer | Median final prose words | Sentences over 20 words | Words in blocks over 40 words, mean |
| --- | --- | --- | --- | --- | --- |
| No plugin | 36/36 | 14/36 | 367 | 19.2% | 67.8% |
| hush | 36/36 | 36/36 | 69 | 0.3% | 5.8% |

That batch does not separate structure from length: Hush's range of words per session overlapped the no-plugin range in none of the nine jobs, so every difference is also a length difference. Hush was cheaper on six of the nine jobs, by 13% to 37%, but cost more on the three quietest jobs, by 1%, 4% and 10%. A per-job cost difference under about 15% in that batch is noise: two identical setups differed by 14%, $0.4765 against $0.4112, 36 sessions each. Runnable content appeared in 34 of 36 Hush answers, 94%, and in all 36 without a plugin; the two Hush answers without it came from the red test suite and the notification router, one session each.

#### Claude Opus 5 and Claude Sonnet, August 30, 2026

Two batches, both in Claude Code with `HUSH_WRAP=1` and an earlier voice. They recorded no explicit effort, so the effective default is unknown, and the hush version is not stated. `rm320-99a236ff`, started 02:53 UTC with the recorded `opus` alias (Opus 5): 36 sessions per setup. `sn320-a9885078`, started 03:30 UTC with `sonnet`: 18 sessions per setup. Both setups got every job right in both batches (36/36 on Opus 5, 18/18 on Sonnet).

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5","Claude Sonnet"],"date":"2026-08-30","reviewedAt":"2026-11-14"} -->
| Setup | Opus 5, spoke at most once | Opus 5, said nothing at all | Opus 5, words of play-by-play per session | Sonnet, spoke at most once | Sonnet, said nothing at all | Sonnet, words of play-by-play per session |
| --- | --- | --- | --- | --- | --- | --- |
| No plugin | 12/36 | 0/36 | 41.1 | 12/18 | 5/18 | 30.1 |
| hush | 36/36 | 28/36 | 1.5 | 16/18 | 11/18 | 8.1 |

The fully silent count is the softer measure: it slides with session length, near 100% on short jobs and lower on the longest, and the at-most-once result is not a guarantee for other workloads. On Opus 5, Hush cut what the commands printed by 28% (23.1k characters against 16.5k per session) and everything Claude wrote by 40% (4,442 tokens against 7,365).

Cost by job swung. On Opus 5, Hush cost less on 7 of 9 jobs, by 8% to 41%, and 1% and 4% more on the other two. On Sonnet it cost 7% to 8% more on four jobs (the `--json` plan, the red test suite, the dependency bump and the half-done rename) and 31% more on the notification router, and saved 39% and 41% on the two jobs that print most. This harness has read anywhere from -15% to +4% overall across runs, so Hush states no suite-wide cost figure.

A fresh Claude Sonnet reader answered all three questions for 97.2% of answers with and without Hush on Opus 5, a tie: one Hush reply in 36 did not say plainly enough what had happened. On Sonnet, 100% against 83.3%. That test moves a few points between runs. A note linked the file with a line number in 81% of Hush sessions on Opus 5 and 44% on Sonnet; none of the 54 no-plugin sessions produced a clickable file link.

#### What the earlier figures cannot show

Every earlier-voice figure was measured before output under 4,000 characters stopped being folded by shape or cut by line count, and before listings, line-range prints, diffs, whole source reads and clean JSON came back whole. Replaying recorded no-plugin tool output offline through the compression with and without the 4,000-character floor, Hush prints 2.8% more per session in the September 1 batch, 1.8% more in the August 30 Opus batch and 0.1% more in the Sonnet one, averaged over nine jobs. Two later changes add to the September 1 batch only: whole source reads, +0.4%, and listings or diffs piped into a line-range print, +1.1%. The replay counts characters only: no price was re-measured, and it cannot show the re-runs the floor exists to prevent.

The raw records and definitions behind these figures, and the benchmark harness, are kept outside this repository and are not distributed with the plugin.

## What changed

Release notes are on the [releases page](https://github.com/V-Songbird/hush/releases).

## License

MIT, see [LICENSE](LICENSE).
