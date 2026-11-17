---
type: knowledge
summary: "Every switch a Hush user can set: the session-control environment variables, HUSH_WRAP, the output style line and the /hush:config message settings with their presets; read before adding, renaming or documenting a setting."
related_files:
  - README.md
  - commands/config.md
  - hooks/style-settings.js
---

# Hush settings

This page lists everything you can set in Hush. Most people never change a setting: Hush trims one way, with no levels and no profiles. The short form is in the README, under [Settings](../../README.md#settings).

## Contents

- [Pause the voice in one session](#pause-the-voice-in-one-session)
- [Scripts and agent pipelines](#scripts-and-agent-pipelines)
- [Session controls](#session-controls)
- [`HUSH_WRAP=1`](#hush_wrap1)
- [The output style line](#the-output-style-line)
- [Message settings](#message-settings)

## Pause the voice in one session

You can pause the voice without leaving the session.

| You send | What happens |
| --- | --- |
| `hush off` | The assistant writes as it would with no output style, from that turn on. It confirms the pause in one line. |
| `hush on` | The voice comes back. The assistant confirms it in one line. |

The message must hold only those words. `stop hush` and `/hush off` work too. A longer sentence that contains them is an ordinary request.

- The pause covers the session you send it in. A new session starts with the voice on.
- The trims keep running. `HUSH_DISABLE=1` and `HUSH_CORE=off` stop those.
- A blocker, a failed check, an unverified claim and a pending approval are still said.
- The pause is a reminder sent on each turn. With `HUSH_QUIET=off` or `HUSH_NUDGE=off` no reminder is sent, so `hush off` does nothing.

## Scripts and agent pipelines

A script that runs `claude -p` from a plain shell gets the voice without [its app part](how-it-works.md#the-app-part). One started from inside a desktop session gets the app part too. When nobody reads the reply, such as an agent in a pipeline, the voice only adds cost. To run one session without it, turn the plugin off for that run:

```bash
claude -p --settings '{"enabledPlugins":{"hush@foundry":false}}' "Your prompt"
```

That run also loses the trims. Neither `"outputStyle": "default"` nor `HUSH_DISABLE=1` drops the voice. Claude Code 2.1.326 applies a plugin's forced output style before it reads `outputStyle`.

## Session controls

Each control is an environment variable. Set it before you start Claude Code.

### Switches that turn a part off

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything Hush does: no trimming, no reminders, no files written, and the desktop mod folds nothing. The voice stays on until you disable or uninstall the plugin. Outside a terminal it loses [its app part](how-it-works.md#the-app-part). |
| `HUSH_CORE=off` | Stops the trims and what goes with them: no trimmed output, no saved files, no command wrapping, nothing added at compaction, no cleanup at session end. Reminders and the subagent brief keep running. The step reminder's small counter stays in your temp folder until your system clears it. |
| `HUSH_QUIET=off` | Stops every reminder and the subagent brief. The trims, the voice and your message settings keep running. |
| `HUSH_NUDGE=off` | Stops every reminder sent while the assistant works. The subagent brief keeps running. |
| `HUSH_SIDECAR=off` | Never saves output to a file. A very large output gets the normal trimmed view, not a digest. A shortened Grep list has no full copy to read back. |
| `HUSH_GREP=off` | Grep match lists arrive whole, however long. |
| `HUSH_TEMPLATE=off` | Runs of same-shape lines are no longer folded. Exact repeats still fold. |
| `HUSH_ADAPTIVE=off` | The caps on clean and failing runs keep their full size, however long the session grows. |
| `HUSH_NOTE=off` | Hush no longer tells the assistant, once per session, what its notes in square brackets mean. The notes themselves stay. |
| `HUSH_COMPACT=off` | Leaves compaction to Claude Code. Hush no longer asks the summary to keep paths and identifiers word for word, or lists the saved files. |
| `HUSH_SUBAGENT=off` | Subagents start without Hush's brief. |

### Switches that change a size

| Variable | What it does | Default |
| --- | --- | --- |
| `HUSH_CAP_PASS=<lines>` | How many lines a long clean run keeps | 60 |
| `HUSH_CAP_FAIL=<lines>` | How many lines a long failing run keeps, and up to how many lines a listing, print or diff comes back whole | 250 |
| `HUSH_SIDECAR_MIN=<characters>` | The size from which output is saved to a file | 15,000 |
| `HUSH_SIDECAR_SHELL_MAX=<characters>` | The size from which a shell result counts as cut by Claude Code | Claude Code's own cut |

### Other switches

| Variable | What it does |
| --- | --- |
| `HUSH_NUDGE=max` | The quietest and most expensive setting. It sends the step reminder twice, after every tool call, besides the turn reminder. |
| `HUSH_DEBUG=1` | Writes a local record of what Hush did to each command result to `hush-debug-<session>.jsonl` in your system temp folder. The record holds the sizes in and out, and where the full copy went. Hush never deletes these files. |
| `HUSH_WRAP=1` | Lets Hush trim failing commands as well as passing ones. See [`HUSH_WRAP=1`](#hush_wrap1). |
| `HUSH_CONFIG_FILE=<path>` | Where `/hush:config` saves your message settings. The default is `~/.claude/hush/config.json`. |

### Which switch wins

- `HUSH_DISABLE` beats every other switch.
- `HUSH_CORE` and `HUSH_QUIET` beat every switch inside what they stop. With `HUSH_QUIET=off`, `HUSH_NUDGE=max` does nothing.

### Accepted values

| Switch shown as | Accepts |
| --- | --- |
| `off` | `off`, `0` or `false`, in any letter case, with spaces around the value ignored |
| `1` | Only `1`, with spaces around it ignored |
| A number | A whole number above zero. Zero, a negative number or text leaves the default. |

## `HUSH_WRAP=1`

`HUSH_WRAP=1` wraps each Bash and PowerShell command so its exit code survives. That lets Hush trim a failing build like a passing one. In `bypassPermissions` mode Hush wraps even without it.

**It is not safe with scoped allow rules** such as `Bash(node*)`. Claude Code checks the wrapped command statement by statement. The wrapper's extra statements match no rule, so every wrapped command is denied.

It is safe with `bypassPermissions`, or with blanket grants such as plain `Bash` or `PowerShell` in your allow rules.

To start Claude Code with it in bash:

```bash
HUSH_WRAP=1 claude
```

To start Claude Code with it in PowerShell:

```powershell
$env:HUSH_WRAP = '1'; claude
```

In PowerShell the variable stays set for that window. To clear it:

```powershell
Remove-Item Env:HUSH_WRAP
```

Every published number was measured with `HUSH_WRAP=1` set.

## The output style line

Installing Hush does not write Claude Code's Output style setting, and the voice does not need it. Every published number was also measured with this line in `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

## Message settings

`/hush:config` shapes the final message. Your choice is saved in `~/.claude/hush/config.json`.

| Where you run it | What you get |
| --- | --- |
| The Claude desktop app | A configurator with a sample message and its word count |
| A terminal | Seven questions, or eight if you say you read in the desktop app |
| Either, with your own words | It applies what you describe, as in `/hush:config only the result and the next step` |

Settings that no choice covers, such as `why` and `records`, keep their saved values.

### What no setting removes

A blocker, a pending approval, an unverified claim or anything left unchecked always stays in the message.

A failed check opens its block with the error quoted word for word. Failed and unchecked items stay under every `checks` value.

### Presets

| Preset | What you get |
| --- | --- |
| `standard` | Every setting at its default |
| `minimal` | The bold result, the next step, and only what no setting removes |
| `explainer` | No next step, up to 400 words, terms explained in place, sentences up to 20 words |
| `terminal` | Plain text for a terminal; the box never asks |

### Each setting

The default comes first.

| Setting | Values | What changes |
| --- | --- | --- |
| `next` | `end`, `top`, `off` | Where the "Next:" line goes, or none. A decision only you can make still appears as a question. The session-archive check moves with `top` and goes unsaid with `off`. |
| `rules` | `on`, `off` | Whether horizontal rules separate the parts |
| `detail` | `normal`, `short`, `full`, `bare` | About 250, 80 or 400 words outside code. `bare` keeps only the result, the next step and what no setting removes. |
| `why` | `on`, `off` | The one sentence on what caused what |
| `checks` | `line`, `each`, `off` | Passed checks in one sentence, a bullet each, or none. Failed and unchecked items stay. |
| `caveats` | `each`, `floor` | Every risk and limit, or only what no setting removes with a link to the rest. Under `detail=bare` there is no link. |
| `records` | `line`, `off` | The closing line of docs and memory written |
| `terms` | `footnote`, `inline`, `none` | How an unfamiliar term is explained |
| `markdown` | `rich`, `basic`, `plain` | Every form the desktop app renders, common Markdown only, or terminal text |
| `files` | `card`, `link` | A whole file comes as a file card above the message, or as a link in the text. A line in a file is always a link. Without the desktop app's file tool, every file is a link. |
| `sentences` | `12`, `20` | Words per sentence, at most |
| `headers` | `off`, `on` | A short bold header opens each block and names its kind. With `emoji=on` the emoji sits in the header. |
| `emoji` | `off`, `on` | One emoji opens each block to show its kind. Screen readers read each emoji's name aloud. |
| `box` | `decisions`, `work`, `text` | When the desktop app's next-step box asks: on any turn with a decision of yours, only after work, or never. With `text`, the "Next:" line carries the step. |

The box exists only in the desktop app. In a terminal the "Next:" line carries the step under any `box` value.

### How a setting reaches the assistant

At session start, and after compaction, a hook hands any setting you changed to the assistant as a short reminder. In a terminal or `claude -p`, with every setting at its default, it adds nothing. On every other host the same hook also sends [the voice's app part](how-it-works.md#the-app-part). Only `HUSH_DISABLE=1` stops it.

A missing or broken settings file falls back to the defaults.

### Setting it from a shell

You need Node.js 22 or later. Run these from the plugin folder:

| Command | What it does |
| --- | --- |
| `node hooks/style-settings.js show` | Prints your settings |
| `node hooks/style-settings.js presets` | Prints the presets |
| `node hooks/style-settings.js set preset=minimal next=top` | Applies the settings you name |
| `node hooks/style-settings.js reset` | Clears your settings |
