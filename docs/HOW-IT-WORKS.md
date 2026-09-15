# How hush works

Everything on this page happens on your machine, while Claude works. Nothing is sent anywhere.

← [Back to the README](../README.md)

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

Every time Claude runs something, hush looks at what came back and decides between three doors.

| What came back | What hush does |
| --- | --- |
| Something short | Nothing. It goes through untouched. |
| A long clean run | Keeps a tail of it. The last stretch is almost always the part that matters. |
| A long failing run | Keeps up to 250 lines, and pulls every error and warning line through no matter where they sat. |
| Something very large — a full log, a lockfile | Writes the whole thing to a file on your machine, then hands Claude a short summary that names that file. |

That last one is the important one. Without it, a 300 KB log is not read once. It sits in the
conversation and gets re-sent on every turn after it. Parking it means Claude can still go and read
it, but only if it decides it needs to.

## Where the parked output goes

Your system temp folder, in `hush-sidecar`, one folder per session. On macOS and Linux it is
readable only by you. On Windows that lock is not available, so treat it as readable by anything
running as you.

hush deletes the folder when the session ends, and clears anything a crashed session left behind
once it is a day old.

Beside the parked files it keeps `saved.json` — characters in, characters actually delivered. That
is the count the status-line snippet in [Settings](SETTINGS.md) reads.

## The markers you will see

When hush shortens something it leaves a short note in square brackets, like
`[hush hook: 12 lines omitted from this view, none with warnings/errors/failures]`. That note is
hush talking, not the command. It always says what was dropped and how to get it back.

Omission is deterministic. A line is cut only when it matches no warning, error or failure pattern.
The file on disk and the command's real output are never changed.

## A command that fails is a special case

Claude Code guards the output of a failing command: a plugin cannot replace it in the general case.
hush is allowed to trim it in two situations — when the session has stopped asking you to approve
each step, or when you set `HUSH_WRAP=1`.

If you never set that, failing output comes through in full. That is the safe default, and it is
why the benchmark numbers were measured with `HUSH_WRAP=1`.

## The reminder

A writing rule read once at the start of a session fades as the session gets long. So hush repeats
itself, but only when it has to.

By default it reminds Claude once at the start of each of your turns, and again only in the moments
where chatter actually slipped through. A session that stays quiet pays nothing extra. `HUSH_NUDGE=max`
reminds on every single command result instead — quieter, and it costs the most.

## The voice slot

Claude Code keeps one active output style. hush ships its own and claims that slot.

`/hush:pick-style` swaps which voice sits in it, and `/hush:craft-style` writes you a new one. Both
back up the shipped voice before they touch anything, and both put it back on request. A crafted
voice is checked against the shipped one after it is written: if the rewrite dropped a rule, it
never reaches your session.

Updating the plugin puts the shipped voice back. Pick again after an update.

## What hush never does

It never edits your files. It never sends anything off your machine. It never removes a warning, an
error or a failure line from what Claude reads. And it never claims it can regenerate output that
was lost — if the parked file is gone, it tells you to run the command again.
