---
description: Shape Hush's final message - a configurator with a live preview in the Claude desktop app, or seven or eight short questions in a terminal; or describe what you want in your own words
argument-hint: "[what you want, in your own words]"
allowed-tools: AskUserQuestion, Read, Bash(node:*), PowerShell(node:*)
---

Help the user shape their Hush message. Speak in the user's language.

No setting removes a blocker, a pending approval or an unverified claim. If the user asks for that, say so in one line, and offer "Warnings: only the floor", the closest choice.

1. Read the current settings:

   `node "${CLAUDE_PLUGIN_ROOT}/hooks/style-settings.js" show`

2. If the user wrote what they want after the command ("$ARGUMENTS"), map those words to the choices in the table below. Those values replace the current ones in the next step.

3. If a tool that renders an inline widget is in this session, such as `show_widget`, show the configurator:

   - Load the widget guidance first, if the tool asks for it, without mentioning it.
   - Read `${CLAUDE_PLUGIN_ROOT}/widgets/config.html`.
   - In the line `const CUR={};`, put the settings from steps 1 and 2 as JSON.
   - In the line `const ROOT='';`, put `${CLAUDE_PLUGIN_ROOT}` with forward slashes.
   - If the user does not write in English, translate every string value inside the `T` object into their language. Keep `{root}`, `{args}`, `TOKEN`, `<br>`, and the text inside braces and backticks. Change nothing else in the file.
   - Render the result with that tool, then end the turn with one line: change the settings, watch the preview, and press the save button.

   The save button sends a message that asks to run the `set` command with the chosen values. When that message arrives, run it and go to step 6.

   Without such a tool, as in a terminal, go to step 4.

4. Ask the questions of the table, seven or eight, in two AskUserQuestion calls, in the table's order: the first four, then the rest. Skip "The box asks your decisions" unless the answer to "Where you read" is the desktop app, so the second call asks three or four. Mark the option that matches the current settings with "(current)" in its label, and give every option a one-line description in the user's language. If step 2 mapped words, first show the values that would change, each with one plain line on what it does, and ask to save or adjust; on save go to step 5, on adjust ask the two calls.

   | Question | Options, and the settings each one sets |
   | --- | --- |
   | Length | Minimum: `detail=bare`, only the result, the next step and what always stays. Short: `detail=short`, about 80 words. Normal: `detail=normal`, about 150. Full: `detail=full`, up to 300, with the evidence. |
   | Where you read | Desktop app, file cards: `markdown=rich files=card`, a whole file comes as a card above the message. Desktop app, links: `markdown=rich files=link`, every file is a link in the text. Other viewer: `markdown=basic box=text`, common Markdown only. Terminal: `markdown=plain box=text`, plain text. A line in a file is always a link, and other viewers and terminals have no cards, so their options keep `files` as it is. |
   | The next step | Top: `next=top`, right under the result. End: `next=end`, last, below a rule. None: `next=off`; a decision only the user can make still appears as a question. |
   | Scanning aids | None: `rules=off headers=off emoji=off`. Rules: `rules=on headers=off emoji=off`. Headers: `rules=on headers=on emoji=off`, a short bold header names each block. Headers and emoji: `rules=on headers=on emoji=on`, the header opens with an emoji for its kind; screen readers read each emoji's name aloud. |
   | Checks that passed | None: `checks=off`. One sentence: `checks=line`. Each one: `checks=each`, a bullet per check. Failed and unchecked items always stay. |
   | Warnings | All: `caveats=each`. Only the floor: `caveats=floor`, blockers, pending approvals, unverified claims and anything left unchecked; the rest goes to a file the message links. |
   | Reading | Plain: `terms=inline sentences=12`, terms explained in place. Standard: `terms=footnote sentences=12`. Expert: `terms=none sentences=20`, no term notes, longer sentences. |
   | The box asks your decisions | Yes: `box=decisions`, the desktop app's next-step box asks with buttons. No: `box=text`, the "Next:" line carries every step. |

   If the user chose "Other" or skipped a question, keep the settings that question would set.

5. Save every setting that changed in one command, for example:

   `node "${CLAUDE_PLUGIN_ROOT}/hooks/style-settings.js" set detail=short next=top`

6. The command prints the reminder future sessions will receive. Follow it from your next message on. It also loads at the start of every new session and after compaction.

7. Reply with the values that differ from the default. Say how to undo them:

   `node "${CLAUDE_PLUGIN_ROOT}/hooks/style-settings.js" reset`
