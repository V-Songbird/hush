---
type: knowledge
summary: "hush's environment variables, the output style setting, the status-line count and the two voice commands; read before changing a switch or the style slot."
related_files:
  - hooks/lib/gate.js
  - hooks/compress-tool-output.js
  - output-styles/hush.md
  - skills/pick-style/SKILL.md
  - skills/craft-style/SKILL.md
---

# Settings

Most people never touch any of this. hush trims one way, always: the first and last stretch of a
long output plus every warning, error and failure line, and a digest with the full copy on disk for
a very large one. There are no levels and no profiles to pick between. The caps tighten on their own
as a session grows — see [How hush works](how-it-works.md#what-happens-to-a-commands-output).

← [Back to the README](../../README.md)

---

## Environment variables

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything hush does. No trimming, no reminders, no files written. The writing voice is a separate switch — run `/hush:pick-style` to put the original back, or uninstall. |
| `HUSH_CORE=off` | Stops the trims and everything around them: no trimmed output, no parked files, no command wrapping, nothing added at compaction, no cleanup when the session ends. The reminder and the subagent brief keep running. |
| `HUSH_QUIET=off` | Stops the reminder and the subagent brief. The trims keep running, and so does the writing voice. |
| `HUSH_NUDGE=off` | Stops only the reminder. |
| `HUSH_NUDGE=max` | As quiet as hush gets. A reminder on every command result, whether or not anything slipped. Costs the most too. |
| `HUSH_SIDECAR=off` | Never parks output in a file. A very large output gets the normal trimmed view instead of a digest, and a shortened Grep list has no full copy to read back. |
| `HUSH_GREP=off` | Grep match lists arrive whole, however long. |
| `HUSH_TEMPLATE=off` | Runs of same-shape lines are no longer folded. Exact repeats still fold into one line and a count. |
| `HUSH_COMPACT=off` | Leaves compaction to Claude Code. hush no longer asks the summary to keep paths and identifiers word for word, or lists the files it parked. |
| `HUSH_SUBAGENT=off` | Subagents start without hush's brief. |
| `HUSH_DEBUG=1` | Writes a local record of what hush did to each command result: sizes in and out, and where the full copy went. It lands in `hush-debug-<session>.jsonl` in your system temp folder, outside the session's parked-output folder. hush never deletes these files: they stay until you remove them. |
| `HUSH_WRAP=1` | Lets hush trim failing commands as well as passing ones. See below. |

`HUSH_DISABLE` beats every other switch, and `HUSH_CORE` and `HUSH_QUIET` beat every switch inside
what they stop: with `HUSH_QUIET=off`, `HUSH_NUDGE=max` does nothing. Every switch shown as `off`
also takes `0` or `false`, in any letter case; the switches shown as `1` take exactly `1`. With
`HUSH_CORE=off`, the reminder's small per-session counter stays in your temp folder until your
system clears it.

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

The setting still changes one thing. When `outputStyle` names hush, Claude Code also adds a short
reminder on every turn that the style is active. Every published number was measured with it set. To
run that same setup, add this line to `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

`/hush:pick-style` swaps voices for you after that, and it will not remove this line.

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

## Writing your own voice

| You want to… | Command |
| --- | --- |
| Build a voice of your own on hush's quiet frame | `/hush:craft-style` |
| Switch between your voices, or go back to the one hush installs | `/hush:pick-style` |

Describe the voice you want and `/hush:craft-style` writes it — robotic, dry, loud, whatever you
ask for. The words change; the machinery underneath does not. A check runs after the rewrite and
names anything the new voice dropped, and a voice that lost a rule never reaches your session.

Both commands ask before they swap, and both take effect at your next session. Updating the plugin
puts the shipped voice back, so pick again after an update.

Every published number belongs to the voice hush shipped when its batch ran. A voice you craft is unmeasured.
