---
type: knowledge
summary: "hush's environment variables, the output style setting, and the status-line count; read before changing a switch or the style slot."
related_files:
  - hooks/lib/gate.js
  - hooks/compress-tool-output.js
  - output-styles/hush.md
  - commands/config.md
  - hooks/style-settings.js
  - modules/
  - widgets/config.html
---

# Settings

Most people never touch any of this. hush trims one way, always: the first and last stretch of a
long output plus every warning, error and failure line, and a digest with the full copy on disk for
a very large one. Trimming has no levels and no profiles to pick between. The caps tighten on their own
as a session grows — see [How hush works](how-it-works.md#what-happens-to-a-commands-output).

← [Back to the README](../../README.md)

---

## Environment variables

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything hush does. No trimming, no turn reminders, no files written. The writing voice stays on until you disable or uninstall the plugin. |
| `HUSH_CORE=off` | Stops the trims and everything around them: no trimmed output, no parked files, no command wrapping, nothing added at compaction, no cleanup when the session ends. The turn reminder and the subagent brief keep running. |
| `HUSH_QUIET=off` | Stops the turn reminder and the subagent brief. The trims keep running, and so does the writing voice. Your [message settings](#message-settings) still reach Claude. |
| `HUSH_NUDGE=off` | Stops only the turn reminder. |
| `HUSH_NUDGE=max` | As quiet as hush gets. A turn reminder on every command result, whether or not anything slipped. Costs the most too. |
| `HUSH_SIDECAR=off` | Never parks output in a file. A very large output gets the normal trimmed view instead of a digest, and a shortened Grep list has no full copy to read back. |
| `HUSH_GREP=off` | Grep match lists arrive whole, however long. |
| `HUSH_TEMPLATE=off` | Runs of same-shape lines are no longer folded. Exact repeats still fold into one line and a count. |
| `HUSH_COMPACT=off` | Leaves compaction to Claude Code. hush no longer asks the summary to keep paths and identifiers word for word, or lists the files it parked. |
| `HUSH_SUBAGENT=off` | Subagents start without hush's brief. |
| `HUSH_DEBUG=1` | Writes a local record of what hush did to each command result: sizes in and out, and where the full copy went. It lands in `hush-debug-<session>.jsonl` in your system temp folder, outside the session's parked-output folder. hush never deletes these files: they stay until you remove them. |
| `HUSH_WRAP=1` | Lets hush trim failing commands as well as passing ones. See below. |
| `HUSH_CONFIG_FILE=<path>` | Where `/hush:config` saves your [message settings](#message-settings) and the session-start hook reads them. The default is `~/.claude/hush/config.json`. |

`HUSH_DISABLE` beats every other switch, and `HUSH_CORE` and `HUSH_QUIET` beat every switch inside
what they stop: with `HUSH_QUIET=off`, `HUSH_NUDGE=max` does nothing. Every switch shown as `off`
also takes `0` or `false`, in any letter case, and ignores spaces around the value; the switches
shown as `1` take only `1`, and ignore spaces around it too. With `HUSH_CORE=off`, the turn reminder's
small per-session counter stays in your temp folder until your system clears it.

## Why `HUSH_WRAP` exists

Claude Code protects the output of a command that failed — a plugin cannot replace it in the
general case. hush is allowed to trim it in two situations: when the session has stopped asking you
to approve each step, or when this variable is set.

Leave it unset and failing output arrives in full. That is the safe default. Set it and a failing
build gets the same treatment as a passing one, keeping every error and warning line.

`HUSH_WRAP=1` works by wrapping each Bash and PowerShell command so its exit code survives. Set it
only when your permission rules let a wrapped command through:

- **Safe:** `bypassPermissions` mode, or blanket grants with no command pattern — plain `Bash` or
  `PowerShell` in your allow rules. Those match the wrapped command as a whole.
- **Not safe:** scoped allow rules such as `Bash(node*)` or `PowerShell(node*)`. Claude Code checks
  the wrapped command statement by statement, and the wrapper's extra statements match no rule, so
  every wrapped command is denied.

In `bypassPermissions` mode hush wraps even without `HUSH_WRAP`, since nothing is checked there.

Every published number was measured with `HUSH_WRAP=1`.

## The output style setting

Installing hush does not write Claude Code's **Output style** setting, and the voice does not need
it: the plugin marks its voice to apply whenever the plugin is enabled, so it is active from your next
session either way.

The setting still changes one thing. When `outputStyle` names hush, Claude Code also adds its own short
reminder on every turn that the style is active, apart from hush's turn reminder. Every published number was measured with it set. To
run that same setup, add this line to `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

## Message settings

`/hush:config` shapes the final message with eight choices: length, where you read, the next step,
scanning aids, checks that passed, warnings, reading, and whether the box asks your decisions. Each
choice sets one or more of the settings below. In the Claude desktop app it shows a configurator:
the length as four moon phases, the other choices below, plus the Markdown level (none, essential
or full) and whether files come as cards or links, and the sample message you would find when
you come back, with its word count. A choice that changes nothing in the sample under your other
choices is greyed out and says why. The save button asks Claude to run the save command. In a
terminal it asks the same questions in two rounds, and skips the box question unless you say you
read in the desktop app: seven questions, or eight. You can also describe what you want in
your own words, as in `/hush:config only the result and the next step`; the configurator opens with
those values, or the terminal shows them and asks before saving. Settings no choice covers, such as
`why` and `records`, keep their saved values. It saves your choice in `~/.claude/hush/config.json`.
Set `HUSH_CONFIG_FILE` to keep it somewhere else.

| Preset | What you get |
| --- | --- |
| `standard` | Every setting at its default |
| `minimal` | The bold result, the next step, and only the floor: blockers, pending approvals, unverified claims, failed checks and anything left unchecked |
| `explainer` | No next step, up to 300 words, terms explained in place, sentences up to 20 words |
| `terminal` | Plain text for a terminal; the box never asks |

| Setting | Values, default first | What changes |
| --- | --- | --- |
| `next` | `end`, `top`, `off` | Where the "Next:" line goes, or none; a decision only you can make still appears as a question |
| `rules` | `on`, `off` | Whether horizontal rules separate the parts |
| `detail` | `normal`, `short`, `full`, `bare` | About 150, 80 or 300 words outside code; `bare` keeps only the result, the next step and the floor |
| `why` | `on`, `off` | The one sentence on what caused what |
| `checks` | `line`, `each`, `off` | Passed checks in one sentence, a bullet each, or none |
| `caveats` | `each`, `floor` | Every risk and limit, or only the floor (blockers, pending approvals, unverified claims, anything left unchecked) with a link to the rest; under `detail=bare` there is no link |
| `records` | `line`, `off` | The closing line of docs and memory written |
| `terms` | `footnote`, `inline`, `none` | How an unfamiliar term is explained |
| `markdown` | `rich`, `basic`, `plain` | Every form the desktop app renders, common Markdown only, or terminal text |
| `files` | `card`, `link` | A whole file comes as a file card above the message, or as a link in the text. A line in a file is always a link, because a card cannot point at a line. Without the desktop app's file tool, every file is a link |
| `sentences` | `12`, `20` | Words per sentence, tops |
| `headers` | `off`, `on` | A short bold header opens each block and names its kind, such as Checks, Warnings or Next step; with `emoji=on` the emoji sits in the header |
| `emoji` | `off`, `on` | One emoji opens each block to show its kind: ✅ result, 💡 cause, 🔧 changes, 🧪 checks, ⚠️ risks, 🧭 recommendation, 📝 records, 👉 next step. Screen readers read each emoji's name aloud |
| `box` | `decisions`, `work`, `text` | When the desktop app's next-step box asks: on any turn with a decision of yours, only after work, or never, leaving the step to the "Next:" line |

The rest of the voice is fixed: quiet while it works, the bold result first, plain words, and links
only to places it saw. No setting removes the floor: a blocker, a pending approval, an unverified
claim or anything left unchecked always stays in the message. Each kind has its own place. Checks give room only to what did
not pass: a failed check opens the block with its error quoted word for word, passed checks share
one plain sentence, and anything left unchecked joins the risks and limits in prose. A pending
approval goes in the next step. Checks carry no colors or marks, so they cannot be mistaken for a
code diff. Failed and unchecked items stay under every `checks` value. The box exists only in the Claude desktop app; in a
terminal the "Next:" line carries the step under any `box` value.

The desktop app shows the message only when it comes after the next-step box's `wrap_up` call;
text written before a tool call does not reach the reader as the message. A box that asks a
question ends the turn with no message, so it asks only when its recap and question say
everything. When the turn has more to say, the box carries the recap alone and the "Next:" line
asks the question.

A session-start hook hands a changed setting to the model as a short settings reminder. It also runs after
compaction, so the setting survives a summary. With every setting at its default it adds nothing.
Each setting replaces only the rule it names. Only `HUSH_DISABLE=1` stops this settings reminder;
`HUSH_QUIET=off` does not.

From a terminal, `node hooks/style-settings.js show` prints the settings, `presets` prints the
presets, `set preset=minimal next=top` applies a preset and then changes one setting, and `reset`
returns every setting to its default. A broken or hand-edited file falls back to the
defaults.

## Showing what hush kept out

hush keeps a running count next to the parked output, in `saved.json`: characters in, characters
actually delivered. Claude Code has one status line and hush does not take it, so read the count
from your own script.

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
