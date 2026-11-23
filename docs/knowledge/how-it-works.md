---
type: knowledge
summary: "What each part of Hush does to a session: the voice, the output trims, saved output, failing commands, the pause, compaction, subagents and the desktop mod; read before changing a hook, the mod or the shipped voice, and to predict what Hush will do to a command's output."
related_files:
  - README.md
  - output-styles/hush.md
  - hooks/hooks.json
  - hooks/compress-tool-output.js
  - hooks/register.tsx
---

# How Hush works

This page says what Hush does to a Claude Code session, part by part. It is for a user who wants to predict what Hush will do. The short form is in the README, under [How it works](../../README.md#how-it-works).

Everything runs on your machine. Nothing is sent anywhere.

## Contents

- [The two parts](#the-two-parts)
- [The voice](#the-voice)
- [What happens to a command's output](#what-happens-to-a-commands-output)
- [Output that comes back whole](#output-that-comes-back-whole)
- [Reads and searches](#reads-and-searches)
- [Long sessions](#long-sessions)
- [The notes you will see](#the-notes-you-will-see)
- [Failing commands](#failing-commands)
- [Where saved output goes](#where-saved-output-goes)
- [The saved count](#the-saved-count)
- [The pause](#the-pause)
- [Compaction and subagents](#compaction-and-subagents)
- [The desktop mod](#the-desktop-mod)

## The two parts

| Part | What it is |
| --- | --- |
| The voice | An output style. That is Claude Code's name for a writing style the assistant follows. |
| The trims | Hooks. A hook is a small program Claude Code runs at a set moment, such as when a command finishes. |

The trims are the product. Each one runs the same with or without the desktop mod.

## The voice

The voice asks the assistant for one message at the end of the work, in your language. It does not ask for silence between tool calls. Progress notes written on the way are left alone, and [the desktop mod](#the-desktop-mod) folds them.

That message holds, in order:

1. The result, in one bold line.
2. The cause, in one sentence.
3. Room only for checks that did not pass.
4. One exact next step that stands on its own.

The next step also says whether the session is finished, where the app can archive a session.

Passed checks give each command's counts as the runner printed them. Every failed test is named.

Most messages fit in about 250 words outside code. A sentence has at most 12 words, and a block at most 40. A block is the text between two blank lines.

Two cases get more room:

- You ask the assistant to explain, to teach or to go deep. That answer may pass 250 words. The result still comes first.
- A warning about lost data, a security hole or a step that cannot be undone. It is written whole, before the step it guards.

The voice applies whenever the plugin is enabled. It holds Claude Code's one output style slot. To use another output style, disable or uninstall Hush.

### The app part

Four sections of the voice cover what the desktop app draws and opens:

- Footnotes, math, `search_tree`, `<kbd>` and local images.
- File cards and the links the app opens as places, such as a session or a Terminal tab.
- Visuals, such as widgets and panes.
- The app's own signals, such as the task list and the next-step box.

A terminal session has none of those, and neither does `claude -p`. So those sections are not in the style file. A hook sends them at session start, and again after compaction, on every other host. The style file is 5.4 KB and the app part 2.0 KB. The rarer forms, such as math and `search_tree`, sit in `hooks/voice-app-forms.md`. The assistant reads that file only before it first uses one.

Hush tells the two apart by `CLAUDE_CODE_ENTRYPOINT`: `cli` is the terminal and `sdk-cli` is `claude -p`. Any other value gets the whole voice. A `claude -p` started from inside a desktop session inherits that session's value, so it gets the app part too. `HUSH_DISABLE=1` stops the hook, and with it the app part.

## What happens to a command's output

When a command finishes, Hush looks at what came back:

| What came back | What Hush does |
| --- | --- |
| Short, under 4,000 characters | Lets it through. Exact repeats fold into one line and a count. |
| A long clean run | Folds runs of five or more same-shape lines. Then it keeps up to 60 lines: the first stretch, the last stretch, and every warning, error and failure line. |
| A long failing run | Keeps up to 250 lines the same way. It also keeps what sits next to a failure: stack frames and the values a test runner prints for a failed check. |
| Very large, 15,000 characters or more | Saves the output to a file on your machine and hands the assistant a digest. |

The digest holds the first 20 and last 15 lines. It also holds the first and last 10 warning, error and failure lines with their line numbers, and a count of each. For a `node --test` run, those 10 and 10 are its failed tests, shown with the run's counts and the first failure's error.

The saved file lets the assistant read the rest, but only when it decides it needs to. Without the file, a 300 KB log would be sent again on every later turn.

### Claude Code's own cut

Claude Code itself cuts a long shell result. It cuts at its `bashOutputMaxChars` setting, else at `BASH_MAX_OUTPUT_LENGTH`, else at 30,000 characters.

When a result arrives at that cut, Claude Code keeps the complete result in its own file. Hush's digest points the assistant there first. Hush still saves the part it received, as a fallback.

Hush reads `bashOutputMaxChars` from your user, project and local settings files. It does not read it from managed settings or from a `--settings` flag.

## Output that comes back whole

Some output comes back whole, up to 250 lines:

- directory listings
- line-range prints: `sed -n`, `head` and `tail`
- `git diff` and `git show`
- whole reads of source files
- `grep -n` of named files
- JSON or a numeric table, when the run did not fail

They have no warning lines for a trim to keep. Cutting them only makes the assistant fetch them again.

Past 250 lines they are trimmed. From 4,000 characters, only exact repeats fold. From 15,000 characters they are saved to a file like any other output. That includes JSON, because a few lines of compact JSON can hold any amount of data.

When your prompt asks for every item of something, such as "list every warning", the cap rises to 2,000 lines. Nothing is folded or saved to a file.

## Reads and searches

The Read tool gets the failing-run trim on logs and on files nobody writes by hand. Those are lockfiles, minified bundles, source maps, and anything under `node_modules`, `dist`, `.next` or `__pycache__`.

Other files come back untouched. So does any read with an offset or a limit.

A Grep list of 4,000 characters or more is shortened. Hush keeps the first 3 matches in each file and every match that reads like a warning or an error. It counts the rest per file and saves the full list to a file.

## Long sessions

The caps on clean and failing runs shrink as a session grows:

| Conversation size | Caps |
| --- | --- |
| Up to 400 KB | Full size |
| Past 400 KB | Three quarters |
| Past 1 MB | Half |

A cap never goes below 30 lines for a clean run or 125 for a failing one. The 250-line cap on output that comes back whole does not shrink.

## The notes you will see

A shortened view carries a note in square brackets, such as:

```text
[hush hook: 12 lines omitted from this view, none with warnings/errors/failures]
```

Hush never cuts a warning, error or failure line from a trimmed view. It never edits your files.

If a saved file is gone, the assistant is told to run the command again.

## Failing commands

Claude Code guards the output of a failing command. So Hush may trim it only in two cases:

- The session runs in `bypassPermissions` mode, where Claude Code asks for no approval.
- You set `HUSH_WRAP=1`.

Otherwise failing output arrives in full. [Hush settings](settings.md#hush_wrap1) explains `HUSH_WRAP=1` and when it is not safe.

## Where saved output goes

Saved output goes to a `hush-sidecar` folder in your system temp folder, one folder per session.

| System | Who can read it |
| --- | --- |
| macOS and Linux | Only you |
| Windows | Treat it as readable by anything that runs as you. That lock is not available there. |

Hush deletes the folder when the session ends. It also removes session folders that were idle for a day.

## The saved count

Hush keeps a running count in `saved.json`, in the session's `hush-sidecar` folder:

| Field | Meaning |
| --- | --- |
| `in` | The characters Hush received |
| `out` | The characters Hush delivered |

Claude Code has one status line, and Hush does not take it. Read the count from your own `statusLine` script, for example `1 - out / in` as a percentage.

The folder is named for the session id, in lowercase on Windows.

## The pause

Send `hush off` to pause the voice for the session. An output style cannot be switched off mid-session, so each turn then carries a short pause reminder. Send `hush on` to end it.

Outside a pause, Hush adds nothing to your turns. Earlier releases sent a reminder to stay silent on each turn. Release notes say when that ended. [Pause the voice in one session](settings.md#pause-the-voice-in-one-session) has the details.

## Compaction and subagents

Claude Code compacts a long conversation into a summary. Before it does, Hush asks the summary to keep every path, identifier, command, version, error and decision word for word. It also names up to 20 saved files.

An output style never reaches a subagent, which is a helper session the assistant starts. So each subagent gets a short brief: return the findings, mark what could not be confirmed, and write nothing between tool calls.

## The desktop mod

Hush also ships an optional mod. A mod is code that Claude Code loads to draw in its interface. Every hook above runs as before without it.

The mod works in the Claude desktop app only. Once a final message arrives, it folds the progress texts written between tool calls into one line: "Show N progress messages". One press shows them in place.

The line counts failed results and texts that carry a warning. Its words follow Claude Code's `language` setting, Spanish or English.

A turn can end on a status line, such as "the suite runs in the background". When a task notification, a scheduled task or the report of one of the session's subagents then continues the work, that line folds too. It joins the same fold once the continuing turn ends. A notification or subagent report that arrives while the turn still runs does not stop the fold either. A turn you open yourself, or a message from another session, never folds the answer before it.

Some texts stay drawn:

- A text whose first words appear elsewhere in the session, a subagent's included.
- Every text after a prompt you queued during the turn.
- Every text before a compaction.

Each session keeps its folds when you reopen it, for the eight newest sessions. Every other reply and every other surface, the terminal included, is left to the app whole.

The mod adds no command, and nothing leaves your machine. No rendered check of it is published. `HUSH_DISABLE=1` turns it off.
