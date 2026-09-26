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

**A writing voice.** One Markdown file that tells Claude to stay quiet between tool calls and then
write one message at the end, in your language. That message opens with the result in one bold
line, then the idea in one sentence, how it was checked, and one exact next step. A request with
several parts, or for the long version, gets more blocks. There is no word cap, only a limit of 12
words per sentence. Claude Code calls this an *output style*.

**A set of trims.** Small programs that run when a command finishes, and shorten what Claude has to
read back.

The voice is what makes the answer readable. The trims are what keep a long session cheap. You can
have the voice on its own — see [flint](https://github.com/V-Songbird/flint) — but the trims need
the plugin.

## What happens to a command's output

Every time Claude runs something, hush looks at what came back and decides between four doors.

| What came back | What hush does |
| --- | --- |
| Something short, under 4,000 characters | Lets it through. Only exact repeats fold, into one line and a count. |
| A long clean run | Folds runs of five or more same-shape lines, then keeps up to 60 lines: the first stretch, the last stretch, and every warning, error and failure line wherever it sat. |
| A long failing run | Keeps up to 250 lines the same way. It also keeps what sits next to a failure: the first stack frame after a Node, Java or Go error, every frame of a Python traceback, and the values and file:line lines a test runner prints for a failed check — go test, Jest, Vitest, pytest, cargo test and RSpec. |
| Something very large — 15,000 characters or more | Writes the whole thing to a file on your machine, then hands Claude a digest that names that file: the first 20 and last 15 lines, the first and last 10 warning, error and failure lines with their line numbers, and a count of each kind. The file holds every line. |

That last one is the important one. Without it, a 300 KB log is not read once. It sits in the
conversation and gets re-sent on every turn after it. Parking it means Claude can still go and read
it, but only if it decides it needs to. Claude Code cuts a long shell result at the
`bashOutputMaxChars` setting, else at `BASH_MAX_OUTPUT_LENGTH`, else at 30,000 characters. A shell
result that arrives at that cut was cut short. Claude Code saves that complete result in its own
file and names it for Claude, so hush writes no file of its own: the digest covers the part hush
received and tells Claude to read Claude Code's file for the rest.
hush reads the setting from your user, project and local settings files; it cannot see managed
settings or a `--settings` flag.

A directory listing, a print of a line range or a diff comes back whole up to 250 lines, however
long the session: `ls`, `dir`, `Get-ChildItem`, `find` without `-exec`, `sed -n`, `head` or `tail`
with a line count, `Get-Content` with `-TotalCount` or `-Tail`, and `git diff` or `git show`, each run
on its own rather than piped or chained. Nothing in it is folded, cut or parked in a file. Past 250
lines only exact repeats fold, into one line and a count: under 4,000 characters it still comes
back whole, from 4,000 it keeps 250, the first and last stretch, and from 15,000 characters it is
parked like any other output. Such output has no warning or error lines for a trim to keep, so a
trim only cut names, code or diff lines Claude then had to fetch again.

A whole-file print, `cat`, `type` or `Get-Content` run on its own, keeps up to 250 lines like a
failing run: a trim there cuts file text, not noise. Without an exit code, neither it nor a listing,
a line-range print or a diff counts as a failing run: the words error or failed in them are the
file's text, so a trimmed view of them never says the run failed.
A printed test log still keeps a failed check's values and file:line lines out of the fold.

Two other tools get the same treatment:

- **Read.** A log file, or a file nobody writes by hand — a lockfile, a minified bundle, anything
  under `node_modules` or `dist` — is trimmed like a failing run. Any other file, and any read with
  an offset or a limit, comes back untouched.
- **Grep.** A match list of 4,000 characters or more keeps the first 3 matches in each file and
  every match that reads like a warning or an error. It counts the rest per file and saves the full
  list to a file.

The caps on a clean or failing run tighten as a session grows. Past 400 KB of conversation each is
three quarters of its size, and past 1 MB it is half, never below 30 lines for a clean run or 125
for a failing one. The 250-line cap on a listing, a line-range print or a diff stays 250. When
you ask for every item — "list every warning" — the cap rises to 2,000 lines, and nothing is folded
by shape or parked in a file.

## Where the parked output goes

Your system temp folder, in `hush-sidecar`, one folder per session. On macOS and Linux it is
readable only by you. On Windows that lock is not available, so treat it as readable by anything
running as you.

hush deletes the folder when the session ends. Each time a session ends, it also removes every
session folder nothing has written to for a day: what a crashed session left behind, and the folder
of a session left idle that long.

Beside the parked files it keeps `saved.json` — characters in, characters actually delivered. That
is the count the status-line snippet in [Settings](settings.md) reads.

## The markers you will see

When hush shortens something it leaves a short note in square brackets, like
`[hush hook: 12 lines omitted from this view, none with warnings/errors/failures]`. That note is
hush talking, not the command. It says what was dropped, but not always how to get it back. A
digest names the file that holds everything, and a trimmed failing run says to re-run the command.
A view with same-shape folds ends with one note on reading the dropped lines. When the folds saved
less than that note costs, a one-line version replaces it, and folds that cannot pay even for that
line are not made. For any other note, re-run the command, or read the file with an offset and a
limit.

Omission is deterministic. In a trimmed view, a line is cut only when it matches no warning, error
or failure pattern. A digest shows a sample of those lines instead, and names the file that holds
all of them. The file on disk and the command's real output are never changed.

A line of the output itself that already opens with `[hush` gets a backslash in front, `\[hush`, so
it cannot pass for one of these notes. That holds when spaces or invisible characters come first,
when invisible characters sit inside `[hush`, when the bracket is the fullwidth `［`, and when the
letters are fullwidth, another compatibility form such as mathematical bold, or the Cyrillic and
Greek letters drawn like h, u and s (Н, Һ, һ, Η, υ, Ѕ, ѕ). It happens
in any shell output hush may rewrite, however short, in the logs and generated files it trims, in
the parked copy, and in a long search result hush shortens. Any other file and any read with an
offset or a limit come back exactly as they are on disk, and a search result hush does not shorten
comes back exactly as the search returned it.

Each note sits on a line of its own that opens with `[hush:` or `[hush hook:`. The first time one
appears in a session, hush tells Claude once where its notes can appear: shell output, the logs,
generated files and parked copies Claude reads back, and long search results. Anything else shaped like
a note, such as a `[[hush:exit=N]]` a command printed, is part of the output, and it does not use up
that one-time note.

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

By default it reminds Claude once at the start of each of your turns, and again once, the first time
chatter slips through in that turn. A line Claude Code itself asked for when you had not heard from
Claude in a while does not count. hush spots that line by the `silent_turn_reminder` entry Claude
Code writes before it, a name Claude Code does not document; if Claude Code renames it, the line
counts as chatter and can draw that one reminder. A session that stays quiet pays nothing extra.
`HUSH_NUDGE=max` reminds on every single command result instead — quieter, and it costs the most.

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
never reaches your session. When a voice's only gap is the paragraph about `[hush ...]` lines from an
older hush, both commands offer to swap in the current one, and with your yes it is the only line of
the file that changes.

Updating the plugin puts the shipped voice back. Pick again after an update.

## What hush leaves alone

It edits your files only when you ask: `/hush:craft-style` writes the voice you describe, and
picking a voice can remove an `outputStyle` setting the swap makes redundant and, with your yes,
swap in the current `[hush ...]` paragraph. It never sends anything off your machine. It never cuts
a warning, an error or a failure line from a trimmed view, and when a digest samples them, the file
it names holds every one. And it never claims it can regenerate output that was lost — if the
parked file is gone, it tells you to run the command again.
