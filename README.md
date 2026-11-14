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

**The voice.** Claude Code calls it an output style. It tells the assistant to stay quiet between tool calls, then write one message at the end, in your language. The message opens with the result in one bold line, then the cause in one sentence. Only checks that did not pass get room. One exact next step closes it, and that line also says whether the session can be archived. Most messages fit in about 250 words outside code, with at most 12 words per sentence and 40 per block. A request with several parts, or for the long version, gets more blocks. The voice applies whenever the plugin is enabled.

**The trims.** When a command finishes, Hush looks at what came back:

| What came back | What Hush does |
| --- | --- |
| Short, under 4,000 characters | Lets it through. Exact repeats fold into one line and a count. |
| A long clean run | Folds runs of five or more same-shape lines, then keeps up to 60 lines: the first stretch, the last stretch, and every warning, error and failure line. |
| A long failing run | Keeps up to 250 lines the same way, plus what sits next to a failure: stack frames and the values a test runner prints for a failed check. |
| Very large, 15,000 characters or more | Saves the whole output to a file on your machine and hands the assistant a digest: the first 20 and last 15 lines, the first and last 10 warning, error and failure lines with line numbers, and a count of each. |

The saved file lets the assistant read the rest, but only if it decides it needs to. Without it, a 300 KB log would be re-sent on every later turn.

Some output always comes back whole, up to 250 lines: directory listings, line-range prints (`sed -n`, `head`, `tail`), `git diff` and `git show`, whole reads of source files, a clean run's JSON, and numeric tables a command printed. These have no warning lines for a trim to keep, so cutting them only makes the assistant fetch them again. Past 250 lines they are trimmed. When you ask for every item, such as "list every warning", the cap rises to 2,000 lines and nothing is folded.

Hush applies the same trims to the Read tool on logs and files nobody writes by hand, such as lockfiles and minified bundles, and to long Grep lists. A Grep list of 4,000 characters or more keeps the first 3 matches per file and every match that looks like a warning or error. All other files, and any read with an offset or a limit, come back untouched. The caps tighten as a session grows: three quarters of their size past 400 KB of conversation, half past 1 MB, never below 30 lines for a clean run or 125 for a failing one.

When Hush shortens something, it leaves a note in square brackets, such as `[hush hook: 12 lines omitted from this view, none with warnings/errors/failures]`. It never cuts a warning, error or failure line from a trimmed view, and it never edits your files. If a saved file is gone, the assistant is told to run the command again.

**Failing commands.** Claude Code guards the output of a failing command, so Hush may trim it only when the session no longer asks you to approve each step, or when you set `HUSH_WRAP=1`. Otherwise failing output arrives in full. See [Settings](#settings) before setting it.

**Reminders.** A rule read once fades as a session grows, so Hush repeats it when it has to. It sends a short reminder at the start of each of your turns, and a shorter one the first time chatter slips through in a turn. A turn the harness starts, such as a task notification, gets its own reminder: when nothing is new, it ends with no message or one short line. A session that stays quiet pays nothing extra.

**Compaction and subagents.** Before Claude Code compacts a conversation, Hush asks for a compact list that keeps every path, identifier, command, version, error and decision word for word, and names up to 20 saved files. An output style never reaches a subagent, so each subagent gets a short brief: return the findings, mark what could not be confirmed, and write nothing between tool calls.

**Where saved output goes.** A `hush-sidecar` folder in your system temp folder, one folder per session. On macOS and Linux only you can read it. On Windows that lock is not available, so treat it as readable by anything running as you. Hush deletes the folder when the session ends, and each time a session ends it also removes session folders nothing has written to for a day.

**The desktop mod.** Hush also ships an optional mod, code that Claude Code loads to draw in its interface. It works only in the Claude desktop app's Code tab. The command hooks above are the product: they behave the same whether or not the mod loads, for instance when mods are switched off. The mod does three things:

- It draws the final message's `mermaid` blocks as pictures in the app's own colors, light and dark. A block it cannot read, or one too crowded for the width, stays a code block.
- It draws GitHub alerts as the app draws its own banners: Warning, Caution and Important in a bordered box with an icon, Note and Tip as one line led by the icon.
- Once the final message arrives, it folds the progress texts written between tool calls into one dim line, "Show N progress messages", that opens with a press. The line counts failed results and texts that name a failure.

A message with no Mermaid block and no alert is left to the app whole. The terminal and every other surface are never touched.

The voice bans `mermaid` blocks and alerts because the app shows them as raw text. It allows four Mermaid kinds (`flowchart TD`, `flowchart LR`, `xychart-beta`, `pie`) and two alerts (Warning and Caution), only in a session whose prompt has a section headed "Forms this desktop session draws". The mod adds that section only when Hush is the output style, the desktop is the only surface, the session is not `--bare`, and your `markdown` setting is `rich`. Everywhere else the ban stands.

On every surface, the mod also checks each final message against the voice's countable rules, such as words per sentence and where "Next:" goes, under your message settings. It keeps the totals on your machine, and the `/hush-lint` command prints them. It shows you nothing else. Its text follows Claude Code's `language` setting, Spanish or English. The Mermaid renderer is ported from [skins](https://github.com/hellosverre/claude-skins) (MIT), and the alert icons are GitHub's Octicons (MIT); both notices ship in `hooks/`.

## What you can do

| You want to | Outcome |
| --- | --- |
| Read the result first | Short, plain answers focused on the result |
| Inspect shortened output | A reference to the saved full result where available |
| Change the answer's layout | `/hush:config`, described under [Message settings](#message-settings) |
| Turn off a session control | One environment variable per control, listed under [Settings](#settings) |
| See what the mod counted | `/hush-lint` in the desktop app |

### Settings

Most people never touch these. Hush trims one way, always: no levels, no profiles.

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything Hush does: no trimming, no reminders, no files written, and the desktop mod draws, composes and counts nothing. The writing voice stays on until you disable or uninstall the plugin. |
| `HUSH_CORE=off` | Stops the trims and everything around them: no trimmed output, no saved files, no command wrapping, nothing added at compaction, no cleanup when the session ends. The reminders and the subagent brief keep running. The step reminder's small per-session counter stays in your temp folder until your system clears it. |
| `HUSH_QUIET=off` | Stops every reminder and the subagent brief. The trims and the voice keep running, and so do your [message settings](#message-settings). |
| `HUSH_NUDGE=off` | Stops every reminder Hush sends while the assistant works. The subagent brief keeps running. |
| `HUSH_NUDGE=max` | The quietest and most expensive setting: the step reminder, a short text sent twice, after every tool call, besides the turn reminder. |
| `HUSH_SIDECAR=off` | Never saves output to a file. A very large output gets the normal trimmed view instead of a digest, and a shortened Grep list has no full copy to read back. |
| `HUSH_GREP=off` | Grep match lists arrive whole, however long. |
| `HUSH_TEMPLATE=off` | Runs of same-shape lines are no longer folded. Exact repeats still fold. |
| `HUSH_COMPACT=off` | Leaves compaction to Claude Code: Hush no longer asks the summary to keep paths and identifiers word for word, or lists the saved files. |
| `HUSH_SUBAGENT=off` | Subagents start without Hush's brief. |
| `HUSH_DEBUG=1` | Writes a local record of what Hush did to each command result (sizes in and out, and where the full copy went) to `hush-debug-<session>.jsonl` in your system temp folder. Hush never deletes these files. |
| `HUSH_WRAP=1` | Lets Hush trim failing commands as well as passing ones. See below. |
| `HUSH_CONFIG_FILE=<path>` | Where `/hush:config` saves your message settings. The default is `~/.claude/hush/config.json`. |

`HUSH_DISABLE` beats every other switch, and `HUSH_CORE` and `HUSH_QUIET` beat every switch inside what they stop: with `HUSH_QUIET=off`, `HUSH_NUDGE=max` does nothing. Every switch shown as `off` also takes `0` or `false`, in any letter case, and ignores spaces around the value. The switches shown as `1` take only `1`.

**`HUSH_WRAP=1`** wraps each Bash and PowerShell command so its exit code survives, which lets Hush trim a failing build like a passing one. In `bypassPermissions` mode Hush wraps even without it. Set it only when your permission rules let a wrapped command through:

- **Safe:** `bypassPermissions` mode, or blanket grants with no command pattern, such as plain `Bash` or `PowerShell` in your allow rules.
- **Not safe:** scoped allow rules such as `Bash(node*)`. Claude Code checks the wrapped command statement by statement, the wrapper's extra statements match no rule, and every wrapped command is denied.

To set it for one run, start Claude Code with `HUSH_WRAP=1 claude` in bash. In PowerShell, `$env:HUSH_WRAP = '1'; claude` leaves it set for that window until you run `Remove-Item Env:HUSH_WRAP`.

**The output style setting.** Installing Hush does not write Claude Code's Output style setting, and the voice does not need it. Every published number was also measured with this line in `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

### Message settings

`/hush:config` shapes the final message. In the Claude desktop app it opens a configurator: the length as four moon phases, the other choices below, and a sample message with its word count. A choice that changes nothing in the sample is greyed out and says why. The save button asks Claude to run the save command. In a terminal it asks seven questions, or eight if you say you read in the desktop app. You can also describe what you want in your own words, as in `/hush:config only the result and the next step`.

No setting removes the floor: a blocker, a pending approval, an unverified claim or anything left unchecked always stays in the message. A failed check opens its block with the error quoted word for word, and passed checks share one plain sentence. A pending approval goes in the next step.

Your choice is saved in `~/.claude/hush/config.json`. Presets set several settings at once:

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
| `checks` | `line`, `each`, `off` | Passed checks in one sentence, a bullet each, or none |
| `caveats` | `each`, `floor` | Every risk and limit, or only the floor with a link to the rest; under `detail=bare` there is no link |
| `records` | `line`, `off` | The closing line of docs and memory written |
| `terms` | `footnote`, `inline`, `none` | How an unfamiliar term is explained |
| `markdown` | `rich`, `basic`, `plain` | Every form the desktop app renders, common Markdown only, or terminal text. Only `rich` lets the desktop mod's `mermaid` blocks and alerts in |
| `files` | `card`, `link` | A whole file comes as a file card above the message, or as a link in the text. A line in a file is always a link. Without the desktop app's file tool, every file is a link |
| `sentences` | `12`, `20` | Words per sentence, tops |
| `headers` | `off`, `on` | A short bold header opens each block and names its kind; with `emoji=on` the emoji sits in the header |
| `emoji` | `off`, `on` | One emoji opens each block to show its kind. Screen readers read each emoji's name aloud |
| `box` | `decisions`, `work`, `text` | When the desktop app's next-step box asks: on any turn with a decision of yours, only after work, or never, leaving the step to the "Next:" line |

The box exists only in the desktop app. The app shows the message only when it comes after the box's `wrap_up` call, and a box that asks a question ends the turn with no message, so it asks only when its recap and question say everything. In a terminal the "Next:" line carries the step under any `box` value.

At session start, and again after compaction, a hook hands any setting you changed to the assistant as a short reminder. With every setting at its default it adds nothing. Only `HUSH_DISABLE=1` stops it. A missing or broken settings file falls back to the defaults.

From a terminal in the plugin folder, `node hooks/style-settings.js show` prints the settings, `presets` prints the presets, `set preset=minimal next=top` applies a preset and then changes one setting, and `reset` returns every setting to its default.

### Showing what Hush kept out

Hush keeps a running count in `saved.json` beside the saved output: characters in, characters delivered. Claude Code has one status line and Hush does not take it, so read the count from your own script:

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

## Install

Hush runs in Claude Code, its primary host. It has no Codex or Antigravity package.

### Claude Code

Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Start a new session to load the plugin. Hush's voice applies on its own.

Requirements: Claude Code 2.1.323 or later, and Node.js 22 or later. The plugin declares that Claude Code version in its manifest, so a Claude Code at 2.1.323 or later will not install or load a release it is too old for. An older Claude Code ignores that declaration, and Hush is not tested there.

### Update

```text
/plugin marketplace update foundry
/plugin update hush@foundry
```

Then start a new session.

## Good to know

Correctness comes before silence. A short answer can omit a useful detail, and quieter sessions do not always cost less. Ask for depth when you need it, and check the result before acting.

Full-output references point to temporary files. Disabling the session controls leaves the writing style on; disable the plugin to turn it off. The voice holds Claude Code's one output style slot while the plugin is enabled; to use another style, disable or uninstall Hush.

Claude Code guards the output of a failing command, so failing output arrives in full unless the session stops asking for approval or you set `HUSH_WRAP=1`. Every published number was measured with `HUSH_WRAP=1`.

The desktop mod is optional and draws only in the Claude desktop app's Code tab. It is new, and no rendered check of it is published here. A thread's prompt is fixed once sent, so a mod turned off mid-thread leaves the section in place until the next thread or compaction.

Hush reads Claude Code's output limit from your user, project and local settings files; it cannot see managed settings or a `--settings` flag.

## The numbers

Each comparison asks whether jobs were completed correctly, how often the assistant spoke at most once before the answer, how long its final answers were and what a session cost. A test session is a real Claude Code session in its own throwaway folder, from start to finish, never a canned reply. Nine jobs cover the range of how much a session prints, from a plan with no edits to a 300 KB outage log. Every job ends with a check, and a short answer that breaks the job counts as a failure. Prices are the bill read back from the API. These observations do not guarantee the same behavior in your sessions, and results vary between runs. Prose words exclude fenced code; counts of sentences and blocks treat inline code, paths and links as one word each.

### Claude Code results

All results are from Claude Code. They are not Codex or Antigravity results.

#### Claude Opus 5.5, voice 1.13.0

Batch `o55-451-495ce18f`: nine fixture jobs, four runs per setup, 36 sessions each, in Claude Code with Claude Opus 5.5 (model id `claude-opus-5-5`) at the default effort, started September 28, 2026. Hush ran with `HUSH_WRAP=1`, set in bash as `HUSH_WRAP=1 claude` and in PowerShell as `$env:HUSH_WRAP = '1'; claude`. This measures the voice released as 1.13.0, not the current one.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5.5"],"date":"2026-09-28","reviewedAt":"2026-11-14"} -->
| Model | Setup | Jobs right | Spoke at most once before the answer | Median final prose words | Average bill per session |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | No plugin | 36/36 | 28/36 | 369 | $0.421 |
| Claude Opus 5.5 | hush | 36/36 | 36/36 | 271 | $0.458 |

Both setups passed all 36 task checks. Hush spoke at most once before the answer in every session, and said nothing at all before it in 34 of 36, against 12 of 36 without a plugin. Without a plugin, Opus 5.5 already spoke at most once in 28 of 36 sessions, and sent 15.4 words of play-by-play per session against 1.0 with Hush. The loudest no-plugin session wrote 59 words of play-by-play; the loudest Hush session wrote 19. The medians are 369 and 270.5, rounded, about 27% shorter.

Sentences were shorter too: 0.5% ran past 20 words against 10.9% without a plugin, and 12.0 words per sentence fell to 8.1. Reading ease rose from 78.2 to 88.6 and grade level fell from 5.3 to 2.9. Those are text formulas, not a reader study. Job by job, Hush had fewer prose words in 6 of 9 jobs (exact two-sided sign-flip p 0.133), and a smaller share of sentences over 20 words in 9 of 9 (p 0.004).

**On Opus 5.5, Hush costs more.** The average bill per session was 9% higher. Seven of the nine jobs cost more, by 4% to 32%, and four of those are above about 16%, the largest gap that batch showed between two near-identical setups. Only the two jobs whose commands print the most came out cheaper: the 57 KB log by 19% and the 380 commits by 4%. Opus 5.5 already writes less without a plugin, so Hush has less to remove. Everything the assistant wrote per session was 6% higher, 3,654 tokens against 3,453, while what the commands printed fell 9%, 22.2k characters against 24.4k. Treat a per-job cost difference under about 16% in this batch as noise.

Structure is partly separate from length here. Hush wrote more prose words on average in three jobs: the red test suite, the notification router and the half-done rename. Hush messages still held 52.3% of their words in blocks over 40 words on average (median 57.6%), against 78.3% (median 79.7%) without a plugin. Runnable content appeared in all 36 answers of both setups; that text heuristic does not check that a command is correct or complete.

To test whether answers can be acted on, a fresh Claude Sonnet session got only the request and the final message and answered three questions. All three were answered for 100% of Hush answers and 94.4% of no-plugin answers, and the job's own facts reached those answers 90.0% against 83.3%. The two no-plugin misses came from the notification router job. This test moves a few points between runs on its own. A message linked the file to open with a line number in 29 of 36 Hush sessions and none of 36 without a plugin.

#### Claude Opus 5.5, 40 words per block

The voice now also caps each block of the final answer at 40 words; a block is the text between two blank lines. The figures above do not measure that rule. Batch `o55-888-1bec0539`, started September 28, 2026: the same nine jobs, four runs per setup, 36 sessions each, Claude Opus 5.5, default effort, `HUSH_WRAP=1`, with no no-plugin setup. It compares hush 1.13.0 with the same build plus the block rule.

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

The rule cut the share of words in long blocks by 13.8 points, in 7 of the 9 jobs (p 0.016), and cost no correctness. The cost difference is within this batch's noise: per job it ranged from 23% cheaper on the half-done rename to 31% dearer on the release notes. Compare these two setups only with each other; the same 1.13.0 voice held 52.3% of its words in long blocks in the batch above and 59.1% here, and the two batches ran different tool-output compression.

#### Claude Sonnet 5.5, voice 2.0.0 build

Batch `b31-quiet-0c14009e`, started October 13, 2026, in Claude Code with Claude Sonnet 5.5 (model id `claude-sonnet-5-5`) at the default effort: two runs of eleven jobs per setup, 22 sessions each, shuffled inside each job and repetition. Hush ran with `HUSH_WRAP=1` from `main` at a build whose manifest read 2.0.0; it also carried part of the voice a later release shipped. The eleven jobs are the nine above plus a listing of 167 locale files and the three bad rows in a 151-line stretch of a 1,600-row CSV file. Compare these figures only with each other: the same build's bill per session has moved by about 5% between batches.

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

Each job has a fixed answer key of required facts, matched by code where exact and otherwise judged by a Claude Sonnet session that must quote its source (scoring prompt `cov-2`, keys version 1.0.0). Nine of the eleven jobs have a key; the two new jobs have none, and the notification router is left out because its facts arrive in later prompts. Over 8 jobs and 16 sessions each, Hush carried 88.8% of required facts against 79.2%, and 11 of 16 sessions carried every fact against 10 of 16. The gap comes from one job: the two no-plugin `--json` plans carried none of its facts. Over the other seven jobs, no plugin carried 90.5% and Hush 87.1%. Hush carried more on 2 of the 8 jobs and less on 2 (p 0.875).

#### Claude Opus 5 and Claude Sonnet, earlier voices

These batches measured earlier voices, before the current rules, and the tool-output compression of their time. Batch `rivalA-762f888b`, started September 1, 2026: nine jobs, four runs per setup, 36 sessions each, the `opus` alias (identified as Opus 5 by the published source) at medium effort, `HUSH_WRAP=1`, hush 1.11.1.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5"],"date":"2026-09-01","reviewedAt":"2026-11-14"} -->
| Claude Opus 5, 36 sessions each | Jobs right | Spoke at most once before the answer | Median final prose words | Sentences over 20 words | Words in blocks over 40 words, mean |
| --- | --- | --- | --- | --- | --- |
| No plugin | 36/36 | 14/36 | 367 | 19.2% | 67.8% |
| hush | 36/36 | 36/36 | 69 | 0.3% | 5.8% |

Every difference in that batch is also a length difference: Hush's range of words per session overlapped the no-plugin range in none of the nine jobs. It was cheaper on six of the nine jobs, by 13% to 37%, but cost more on the three quietest jobs, by 1%, 4% and 10%, within that batch's noise of about 15% (two identical setups differed by 14%). Runnable content appeared in 34 of 36 Hush answers, 94%, and in all 36 without a plugin; the two Hush answers without it came from the red test suite and the notification router. A fresh Sonnet reader answered all three questions for 97.2% of answers with and without Hush on Opus 5, a tie in which one Hush reply in 36 did not say plainly enough what had happened. Links with a line number appeared in 81% of Hush notes on Opus 5 and 44% on Sonnet, and in none of the 54 no-plugin sessions.

Two batches started August 30, 2026 did not record an explicit effort, so the effective default is unknown. `rm320-99a236ff` (`opus`, 36 sessions per setup): Hush spoke at most once before the answer in 36 sessions against 12, said nothing at all in 28 against 0, and wrote 1.5 words of play-by-play per session against 41.1; Opus 5 session output fell from 7,365 to 4,442 tokens, and what the commands printed fell 28%. `sn320-a9885078` (`sonnet`, 18 per setup): 16 sessions against 12 spoke at most once, 11 against 5 said nothing, 8.1 words of play-by-play against 30.1. Both setups got every job right in both batches. The fully silent count is the softer measure: it slides with session length, near 100% on short jobs and lower on the longest, and the at-most-once result is not a guarantee for other workloads.

On those batches the cost swung by job. Hush cost less on 7 of 9 Opus 5 jobs, by 8% to 41%, and about the same on the others (+1% and +4%). On Sonnet it cost 7% to 8% more on four jobs (the `--json` plan, the red test suite, the dependency bump and the half-done rename) and 31% more on the notification router, while saving 39% to 41% on the two jobs that print most. Any one row can swing between runs, and the same comparison has read anywhere from -15% to +4% overall across runs of this harness, so Hush states no suite-wide cost figure.

#### What the earlier figures cannot show

Every earlier-voice figure was measured before output under 4,000 characters stopped being folded by shape or cut by line count, and before listings, line-range prints, diffs, whole source reads and clean JSON started coming back whole. Replaying recorded no-plugin tool output offline through the compression with and without that floor, Hush prints 2.8% more per session in the `rivalA-762f888b` batch, 1.8% more in the August 30 Opus batch and 0.1% more in the Sonnet one, averaged over nine jobs. The replay counts characters only: no price was re-measured, and it cannot show the re-runs the floor exists to prevent.

The raw records and definitions behind these figures, and the benchmark harness, are kept outside this repository and are not distributed with the plugin.

## What changed

Release notes are on the [releases page](https://github.com/V-Songbird/hush/releases).

## License

MIT, see [LICENSE](LICENSE).
