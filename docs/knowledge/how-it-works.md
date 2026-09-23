---
type: knowledge
summary: "What each hush hook does: the output trims, parked output, failing commands, the reminder, compaction, the subagent brief and the voice slot; read before changing a hook or the shipped voice."
related_files:
  - hooks/
  - output-styles/hush.md
  - scripts/activate-style.js
  - scripts/verify-style.js
---

# How hush works

Everything on this page happens on your machine, while Claude works. Nothing is sent anywhere.

← [Back to the README](../../README.md)

---

## The two halves

hush is two things that happen to fit together.

**A writing voice.** One Markdown file that tells Claude to stay quiet while it works and then
write one short message at the end. Claude Code calls this an *output style*.

**A set of trims.** Small programs that run when a command finishes, and shorten what Claude has to
read back.

The voice is what makes the answer readable. The trims are what keep a long session cheap. You can
have the voice on its own — see [flint](https://github.com/V-Songbird/flint) — but the trims need
the plugin.

## What happens to a command's output

Every time Claude runs something, hush looks at what came back and decides between four doors.

| What came back | What hush does |
| --- | --- |
| Something short | Lets it through. Only exact repeats, and runs of five or more same-shape lines, fold into one line and a count. |
| A long clean run | Keeps up to 60 lines: the first stretch, the last stretch, and every warning, error and failure line wherever it sat. |
| A long failing run | Keeps up to 250 lines the same way. It also keeps what sits next to a failure: the first stack frame after a Node, Java or Go error, every frame of a Python traceback, and the values and file:line lines a test runner prints for a failed check — go test, Jest, Vitest, pytest, cargo test and RSpec. |
| Something very large — 15,000 characters or more | Writes the whole thing to a file on your machine, then hands Claude a digest that names that file: the first 20 and last 15 lines, the first and last 10 warning, error and failure lines with their line numbers, and a count of each kind. The file holds every line. |

That last one is the important one. Without it, a 300 KB log is not read once. It sits in the
conversation and gets re-sent on every turn after it. Parking it means Claude can still go and read
it, but only if it decides it needs to. A shell result of 28,000 characters or more may already have
been cut short by Claude Code, so hush saves it as it received it and says so.

Two other tools get the same treatment:

- **Read.** A log file, or a file nobody writes by hand — a lockfile, a minified bundle, anything
  under `node_modules` or `dist` — is trimmed like a failing run. Any other file, and any read with
  an offset or a limit, comes back untouched.
- **Grep.** A match list of 4,000 characters or more keeps the first 3 matches in each file and
  every match that reads like a warning or an error. It counts the rest per file and saves the full
  list to a file.

The caps tighten as a session grows. Past 400 KB of conversation every cap is three quarters of its
size, and past 1 MB it is half, never below 30 lines for a clean run or 125 for a failing one. When
you ask for every item — "list every warning" — the cap rises to 2,000 lines, and nothing is folded
by shape or parked in a file.

## Where the parked output goes

Your system temp folder, in `hush-sidecar`, one folder per session. On macOS and Linux it is
readable only by you. On Windows that lock is not available, so treat it as readable by anything
running as you.

hush deletes the folder when the session ends, and clears anything a crashed session left behind
once it is a day old.

Beside the parked files it keeps `saved.json` — characters in, characters actually delivered. That
is the count the status-line snippet in [Settings](settings.md) reads.

## The markers you will see

When hush shortens something it leaves a short note in square brackets, like
`[hush hook: 12 lines omitted from this view, none with warnings/errors/failures]`. That note is
hush talking, not the command. It always says what was dropped and how to get it back.

Omission is deterministic. In a trimmed view, a line is cut only when it matches no warning, error
or failure pattern. A digest shows a sample of those lines instead, and names the file that holds
all of them. The file on disk and the command's real output are never changed.

## A command that fails is a special case

Claude Code guards the output of a failing command: a plugin cannot replace it in the general case.
hush is allowed to trim it in two situations — when the session has stopped asking you to approve
each step, or when you set `HUSH_WRAP=1`.

If you never set that, failing output comes through in full. That is the safe default, and it is
why the benchmark numbers were measured with `HUSH_WRAP=1`.

`HUSH_WRAP=1` is safe only in `bypassPermissions` mode or with blanket `Bash` and `PowerShell`
grants. Under scoped allow rules such as `Bash(node*)`, Claude Code denies every wrapped command.
[Settings](settings.md#why-hush_wrap-exists) has the details.

## The reminder

A writing rule read once at the start of a session fades as the session gets long. So hush repeats
itself, but only when it has to.

By default it reminds Claude once at the start of each of your turns, and again only in the moments
where chatter actually slipped through. A session that stays quiet pays nothing extra. `HUSH_NUDGE=max`
reminds on every single command result instead — quieter, and it costs the most.

## When the conversation is compacted

Claude Code summarizes a long conversation to make room. That summary replaces everything before it
and is re-sent on every turn after, so hush shapes it.

Before compaction, hush asks for a compact structured list that keeps every file path, identifier,
command, version number, error message, decision and open thread word for word, and drops narration.
If the session has parked files still on disk, it lists up to 20 of them, and says how many more
there are, so the summary carries the paths instead of the content.

After compaction, hush re-arms its one-time note about the `[hush ...]` markers, since the summary
dropped it. The note comes back with the next marker, not before.

## Subagents

An output style never reaches a subagent, and a subagent's final message lands in the conversation
and is re-sent on every turn after. So each subagent gets a short brief when it starts: return the
findings themselves with no preamble and no offers of more help, mark what could not be confirmed and
where it looked, and write nothing between tool calls.

## Which hook does what

| Hook | When it runs | What it does |
| --- | --- | --- |
| `compress-tool-output` | After Bash, PowerShell, Read and Grep | The trims above |
| `preserve-exit-code` | Before Bash and PowerShell | Keeps a failing command trimmable; see the section on failing commands |
| `silence-nudge` | At each prompt and after each tool | The reminder |
| `precompact-summary`, `postcompact-rearm` | Around compaction | Shapes the summary, then re-arms the note |
| `subagent-brief` | When a subagent starts | The brief |
| `session-end-cleanup` | When the session ends | Deletes the session's parked files |

## The voice slot

Claude Code keeps one active output style. hush ships its own and claims that slot.

`/hush:pick-style` swaps which voice sits in it, and `/hush:craft-style` writes you a new one. Both
back up the shipped voice before they touch anything, and both put it back on request. A crafted
voice is checked against the shipped one after it is written: if the rewrite dropped a rule, it
never reaches your session.

Updating the plugin puts the shipped voice back. Pick again after an update.

## What hush never does

It never edits your files. It never sends anything off your machine. It never cuts a warning, an
error or a failure line from a trimmed view, and when a digest samples them, the file it names holds
every one. And it never claims it can regenerate output that
was lost — if the parked file is gone, it tells you to run the command again.
