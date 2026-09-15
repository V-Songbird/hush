# Settings

Most people never touch any of this. hush trims one way, always — there are no levels and no
profiles to pick between.

← [Back to the README](../README.md)

---

## Environment variables

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Stops everything hush does. No trimming, no reminders, no files written. The writing voice is a separate switch — run `/hush:pick-style` to put the original back, or uninstall. |
| `HUSH_DEBUG=1` | Writes a local record of what hush did to each command result: sizes in and out, and where the full copy went. It lands in `hush-debug-<session>.jsonl` in your system temp folder. |
| `HUSH_NUDGE=max` | As quiet as hush gets. A reminder on every command result, whether or not anything slipped. Costs the most too. |
| `HUSH_WRAP=1` | Lets hush trim failing commands as well as passing ones. See below. |

## Why `HUSH_WRAP` exists

Claude Code protects the output of a command that failed — a plugin cannot replace it in the
general case. hush is allowed to trim it in two situations: when the session has stopped asking you
to approve each step, or when this variable is set.

Leave it unset and failing output arrives in full. That is the safe default. Set it and a failing
build gets the same treatment as a passing one, keeping every error and warning line.

Every published number was measured with `HUSH_WRAP=1`.

## The output style setting

Claude Code's **Output style** setting is what picks hush's voice. Installing the plugin sets it for
you. If it did not take, write it in by hand in `~/.claude/settings.json`:

```json
{
  "outputStyle": "hush:Hush"
}
```

Leave that line in place. Claude Code reads it at the start of every turn, and that is the setup
every published number was measured on.

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

Only the shipped voice was measured. Every published number belongs to it.
