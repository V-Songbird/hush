# Changelog

All notable changes to hush are documented here. Looking for a version
number? It lives in the [foundry marketplace](https://github.com/V-Songbird/foundry)
listing — that's why `plugin.json` here carries none.

## 1.6.4 — 2026-08-19

The final message breaks up its longest sentences more often. A comma that joins two facts is now treated like a semicolon or a dash.

`HUSH_DEBUG=1` records now name the parked file whenever hush writes one, not only when parking is the recovery route the view suggests.

## 1.6.3 — 2026-08-18

Fixed an issue where a style could pass the verifier and then never show up in `/hush:pick-style`. A style's description now has to end with the exact sentence the shelf reads — `Unmeasured variant of Hush.` for one you crafted, `Unmeasured preset shipped with Hush.` for one hush ships.

Fixed an issue where `HUSH_DEBUG=1` left file-list and count `Grep` responses out of the debug manifest.

The poster at the top of the README now says which suite it was measured on.

## 1.6.2 — 2026-08-17

A flow or a chain in the final message is now sketched as plain text inside a code block, so it reads as written in the terminal and in the desktop app. The bundled sensei style follows the same rule.

## 1.6.1 — 2026-08-13

The README now shows how to make Hush your active output style, for one project or for every project at once.

## 1.6.0 — 2026-08-11

The one final message is easier to read: one fact per sentence, a 10-word sentence cap in place of the old 15, and no dash-glued clauses. The bundled pirate style follows the same rules.

The benchmark page is re-measured on this build. hush now takes every reading crown on the suite — reading ease, grade level, and long words — and the README shows a real final message from the run, verbatim.

The style verifier now matches shape-table rows precisely, so a crafted style can reuse a row's words in its prose without hiding a dropped row.

## 1.5.0 — 2026-08-11

The default now reminds only when it helps: one reminder at the start of each turn, plus one more only in the moments chatter actually slips through. A session that stays quiet pays nothing extra — the new default runs both cheaper and quieter than the old one. `HUSH_NUDGE=lean` did the same job for more money and now behaves like the default; `HUSH_NUDGE=max` is unchanged.

The benchmark page is re-measured on this new default, against a suite rebuilt around the work hush is for: noisy builds, big searches, and long sessions that drift.

## 1.4.0 — 2026-08-08

The default is quieter to run: one reminder at the start of each turn, instead of one after every tool result. Cost drops close to what running no plugin costs; the default now catches a little less than before. The old behavior is still there — set `HUSH_NUDGE=max` for a reminder on every tool result.

Added `HUSH_NUDGE=lean`, a middle ground between the two: a little quieter than the default, for a little more.

## 1.3.0 — 2026-08-08

Added a spend dial: `HUSH_NUDGE=turn` keeps one quiet reminder at the start of each turn and drops the mid-turn ones. It costs the same as running no plugin and stays far quieter than no plugin. The default is unchanged — quietest, at a cost premium on long sessions that resume.

The dial's reminder now says silent until the final message, not until the work is done — the old wording let a spoken checkpoint slip in between finishing the edits and running the checks.

The README's lead chart now shows what hush cuts — tool output, mid-work chatter, tokens written — with cost shown honestly as a wash.

## 1.2.3 — 2026-08-07

The README is about a quarter shorter — paragraphs merged, bullets tightened. Every number, table, and chart is kept.

## 1.2.2 — 2026-08-07

The README, the style catalog, and this file's intro are rewritten in plainer language — shorter sentences, everyday words, the benefit up front. Every number, table, and setting is unchanged.

## 1.2.1 — 2026-08-06

The README now carries a second benchmark table, for how hard the final message is to read: reading ease, grade level, sentence length and long words, measured beside other output-shaping plugins. hush writes the easiest prose of the group, and hands over a runnable next step less often than plain Claude Code does — both are on the page.

Two cost claims were corrected. One of the four noisy-output jobs is a wash rather than a win, so the README no longer claims all four.

## 1.2.0 — 2026-08-06

The README now opens with a poster of the benchmark waveform, and the cost chart below was rebuilt with bigger type and plain percent chips — same numbers, readable at a glance.

The output style's length caps now apply to every part of the final message. An exception that let requested explanations run past them is gone, from the stock style and from the Pirate preset.

The final message's own read-back pass now checks the caps instead of describing them: count the longest sentence, scan for semicolons and brackets, count the lines. Fewer over-long sentences on both models, at the same cost.

## 1.1.1 — 2026-08-06

The README now says what happens to parked output when a session is summarized to free up room: the files stay put and the summary keeps their paths.

The security policy now spells out that a `[hush …]`-shaped line already inside a file is that file's own content, not a note hush wrote.

## 1.1.0 — 2026-08-06

Removed the trimming of Claude Code's own oversized-output files when Claude reads them back. `HUSH_TOOLRESULTS` no longer does anything.

The README's benchmark section is rebuilt from fresh runs — hush against plain Claude Code across 17 jobs, the wins and the losses both. The Settings section now points at the `HUSH_WRAP` switch.

## 1.0.0 — 2026-08-01

Removed `/hush:hush-compress`. hush no longer rewrites memory files — it trims tool output and keeps sessions quiet, and nothing else.

Removed `/hush:stats`. The dashboard needed `HUSH_DEBUG=1` set before the work you wanted measured, and then reported what hush did rather than what you saved. `HUSH_DEBUG=1` still writes the record it read from.

hush now watches four tools — `Bash`, `PowerShell`, `Read` and `Grep`. Results from an editor's own tools arrive whole.

Removed the mid-turn word counter. The reminder Claude gets on every tool result is what keeps it quiet now, and one less process starts on each tool call.

There are two settings now: `HUSH_DISABLE=1` turns hush off for a session, and `HUSH_DEBUG=1` writes a record of what it did. Four undocumented caps became fixed values.

Re-reading a file that changed now gives you the ordinary shortened view instead of a changed-lines-only view.

The benchmark suite, its fixture repos, and its run records no longer ship with the plugin — installing hush no longer downloads any of them. The suite lives in the marketplace repo, linked from the README.

Fixed an issue where a trimmed view could reach you longer than the output it replaced. Any view that isn't smaller — or that would drop a field the result arrived with — is dropped, and the original output is passed through untouched.

Fixed an issue where a single very long line, such as a minified bundle or a base64 blob, could stall the compression hook.

The note hush leaves before a compaction now lists every recovery file it can, says how many more there are when the list is capped, and only promises a re-run where a re-run really reproduces the output.

Fixed an issue where a failing run was compressed as if it had passed when the tool wrote its errors in lower case.

Fixed an issue where a very large failing output was trimmed with no recovery file to read the rest from. A capped view of a failing run also now says how to get the omitted lines back.

A shortened search result now keeps the matches it left out: the complete match list is saved to a file for the session, and the summary tells you where. When it can't be saved, the summary asks for a narrower re-run instead of naming a file.

A view with repeated lines collapsed now says how to get those lines back, and states what can never be collapsed — no warning, error, or failure line, and no line naming something you quoted in your prompt unless that quote matches too many lines to single any out.

An exit code that carries a signal now names it — `exit 137 (SIGKILL)`.

Output parked in a file now goes to a folder of its own for each session, and that folder is deleted when the session ends. Anything a crashed session left behind is cleared once it's a day old.

`HUSH_DISABLE=1` now stops everything hush does while a session runs — every hook, reminder, and file it would write. The output style is a separate switch: `/hush:pick-style` hands the slot back to stock.

A ranged read (`Read` with an offset or a limit) now passes through untouched — you get exactly the lines you asked for.

Switching styles now validates the new style before touching the active slot and puts the old one back if anything fails, so a failed switch can't leave you without a style. Restoring stock works as many times as you like, and `/hush:pick-style` shows where each style on the list came from.

The README describes hush as a specialist for noisy, log-heavy, multi-turn work that costs a little more on short, quiet tasks, names the benchmark rows where it wins and loses, and says plainly that a failing command is only trimmed in `bypassPermissions` mode or with `HUSH_WRAP=1`.

The built-in Hush style is now written for tired and ADHD readers: it opens with the answer, reaches for the everyday word instead of the technical one, and holds every reply to 12 lines and 15 words a sentence.

Removed the Anchor preset — the built-in style now covers what it was for.

## 0.16.4-alpha — 2026-07-22

The README's style table now quotes each bundled preset's own description, so it can't drift out of sync with the style files again.

## 0.16.3-alpha — 2026-07-22

The bundled output styles now ship with a side-by-side reference — the same bug fixed in each voice — linked from the README. The style picker now ignores a README placed in the styles folder, so only real styles are listed.

## 0.16.2-alpha — 2026-07-22

The bundled style descriptions are shorter and read more plainly, so the style picker is easier to scan. The Anchor preset's description now names its ADHD-friendly focus directly.

## 0.16.1-alpha — 2026-07-21

The stock Hush style now leans on plain, friendly prose. Short answers that used to arrive as a cluster of bullets read as a sentence or two, and lists are kept for content that is genuinely a list — bullets for parallel items like files or options, a numbered list for real steps.

## 0.16.0-alpha — 2026-07-21

The Anchor preset picked up three attention-friendly habits: when work remains for you, the report now ends on the one next action; a turn that advances a multi-step plan opens with the position (step n of N done, next step named); and from the third consecutive turn stuck on the same failure, it states the assumption it is relying on and asks one diagnostic question instead of patching blind.

## 0.15.0-alpha — 2026-07-21

Added the Anchor style preset — silent while working, then one chunked, signposted report built for limited attention. Tightened the shipped presets so every style keeps hush's silence contract, and style verification now enforces that contract in every mode.

Removed the Standup preset.

## 0.14.0-alpha — 2026-07-21

Fixed an issue where Claude could report a wrong total after hush condensed a very large output — the digest now counts only non-empty lines and steers any total or count to the full saved copy.

The benchmark harness can resume an interrupted run without paying for finished sessions again (`--resume`), and can race several rival plugins in one run by repeating `--rival-dir`.

Benchmark numbers and charts across the README are refreshed.

## 0.13.1-alpha — 2026-07-21

Stock hush reaches for bullet points less eagerly: a report holding fewer than four facts now comes back as plain sentences, and a bullet list survives only when each bullet carries its own independent fact.

## 0.13.0-alpha — 2026-07-21

Two new presets on the shelf. **Standup** shapes every report as `Done:` / `Next:` / `Blocked:`, ready for the team channel. **Sensei** closes each task with one `Lesson:` line — why it broke and the pattern to remember.

**Rock** is now pure telegram: noun chains, dropped articles, `=` for cause — a question gets what, why, and one fix. Every fact, identifier, and error string stays exact, and the mid-turn silence is untouched.

`/hush:craft-style` can now build a maximum-compression style like Rock when you ask for one, and tells you what you trade: stock's readability guarantees, never its silence.

Crafted voices carry further: distant registers get an extra push, and a voice can include character markers — a kaomoji, an aside, an address for the reader. The skill warns you when a voice inherently lengthens replies and offers the leaner cut.

## 0.12.2-alpha — 2026-07-21

Pirate leads with the outcome in its own voice and adds no heading of its own.

`/hush:craft-style` builds the voice you asked for and nothing else. A style it crafts gets a fixed opening or closing line only when you ask for one.

Rock keeps its sentences short in practice, not only in principle, and now reads shorter than stock Hush on the same work.

## 0.12.1-alpha — 2026-07-21

Fixed an issue where `/hush:pick-style` claimed a plugin update had replaced your style every time you switched back to stock Hush yourself.

`/hush:pick-style` now tells you when the active style's file is gone from disk, instead of showing a table with nothing checked.

## 0.12.0-alpha — 2026-07-20

Styles now speak in the voice you asked for, not just about it. Ask `/hush:craft-style` for a pirate and the replies come back in dialect — `be` for is, `ye` for you, dropped g's — with paths, identifiers and error text still exact.

The Pirate preset was rebuilt on the same footing and talks like a pirate throughout, not only in its heading. Rock reads blunter.

`/hush:craft-style` writes your voice through the whole style file, and the verifier checks that hush's rules survived it — every number, every cap, every listed exception, one paragraph for one paragraph.

Very old or ornate voices still arrive unevenly, and a heavy one can bury the technical terms you were looking for.

## 0.11.1-alpha — 2026-07-19

`/hush:pick-style` now lists every style in a numbered table and switches to your reply — no separate selection dialog.

## 0.11.0-alpha — 2026-07-19

Mid-turn silence holds far better on hard debugging work. Claude used to announce the bug it had just found before fixing it; now that diagnosis waits for the final message. Set `HUSH_NUDGE=off` to turn the reminder off.

The built-in style states the one-message-per-turn rule up front and drops the list of examples that was teaching the behavior it meant to prevent. Shipped presets carry the same rules.

`/hush:craft-style` now asks you to name the voice outright — writing the rules in a voice changed how the rules read, not how replies sounded.

New skill `/hush:pick-style` — browse the output styles hush ships and switch between them. Four presets come with it: Chalkline asks before a decision that's costly to undo, Sightline explains the rule behind the fix, Rock keeps it blunt, and Pirate keeps a ship's log. Stock hush is always one command away.

`/hush:craft-style` now hands activation to `/hush:pick-style`, so switching to a style you built and switching to a shipped one work the same way.

Only the built-in style is benchmarked. The presets and anything you craft are unmeasured.

## 0.10.0-alpha — 2026-07-19

The built-in output style now speaks plainer: everyday words, numbered steps where order matters, a small table where facts repeat the same fields, and plain sentences when markdown would be overkill. The silence rules and hard caps are unchanged.

New skill `/hush:craft-style` — build an output style in your own voice on hush's silent frame. It keeps track of every style it makes, verifies that hush's mechanics survive your rewrite, and activates a style only with your say-so.

Fixed an issue where a crafted style barely changed Claude's behavior once activated. Activation now swaps the crafted style into hush's own slot, and swaps stock back on request.

The README's benchmark numbers and charts are refreshed on the new default style.

## 0.9.4-alpha — 2026-07-18

Fixed an issue where a session id derived from a Windows-style transcript path kept the folder prefix on non-Windows systems.

The README is rebuilt around a TL;DR up top and one unified section order shared with razor and foreman; both commands now live in a single table.

## 0.9.3-alpha — 2026-07-18

Docs only. The README's benchmark section now covers running hush and razor as a pair, measured against a rival plugin pair.

## 0.9.2-alpha — 2026-07-18

When Claude Code moves an oversized output aside into its own storage and Claude later reads that file back, the read now returns the trimmed view — warnings, errors, and failures kept verbatim, repeated noise collapsed. A read with an explicit line range still comes back untouched. `HUSH_TOOLRESULTS=off` disables it.

## 0.9.1-alpha — 2026-07-18

Docs only. Every benchmark figure — the bill, the honest table, the waveform, the reply silhouette — is remeasured against the current release, now alongside two rival plugins instead of one.

## 0.9.0-alpha — 2026-07-18

Oversized search results now collapse to a map: each matched file keeps its first few match lines plus a per-file match count, and warning- or error-shaped matches always survive. Searches that asked for surrounding context lines, and results small enough to read whole, pass untouched. `HUSH_GREP=off` disables it.

Long console output from an IDE-run build or terminal command (delivered over MCP) now gets the same trim ordinary shell output gets — noise capped, warnings, errors, and failures kept verbatim. `HUSH_MCP_EXEC=off` disables it.

## 0.8.0-alpha — 2026-07-17

Added `/hush:stats` — reports how much a session's output actually shrank, broken down by what kind of trim did it, plus a per-model read/write summary. Needs `HUSH_DEBUG=1` set beforehand; without it there's nothing to report.

Re-reading a log or generated file that changed since you last read it now shows just the changed lines (plus any warnings, errors, or failures) instead of the whole file again. `HUSH_DELTA=off` disables it.

A large output that contains a credential-shaped secret (an API key, a token, a private key block, a connection string with embedded credentials) is never moved to a local sidecar file — it stays on the ordinary inline path instead.

## 0.7.0-alpha — 2026-07-17

Reports read plainer. Around the exact file and function names, Claude now favors everyday words over engineer shorthand, and a short report is written as plain sentences instead of labeled lines. Bullets appear only when there are enough facts to need them.

## 0.6.6-alpha — 2026-07-16

Internal housekeeping only — no change to how hush behaves.

## 0.6.5-alpha — 2026-07-15

Docs only. The benchmark charts are rebuilt out of the sessions they measure: cost is itemised as a bill, the replies are drawn at the size you actually read them, and the play-by-play is a waveform — hush's lane is close to a flat line.

## 0.6.4-alpha — 2026-07-15

Docs only. Refreshed the benchmark figures for how much you read — both the play-by-play and the replies themselves — against the current release. The note on when Claude breaks silence now matches what it actually does.

## 0.6.3-alpha — 2026-07-15

Asking for an explanation now gets a shorter one. The depth is unchanged — the same steps, laid out one per line, instead of a few heavy sentences.

## 0.6.2-alpha — 2026-07-15

Final messages are shorter. Each bullet is capped at 15 words and can no longer carry a second fact in via a semicolon or a parenthesis, so a line states one thing and stops. Asking for an explanation still gets the full depth, but as more bullets rather than longer ones.

Reports no longer end with a paragraph that restates the bullets above it.

## 0.6.1-alpha — 2026-07-15

The output style is quieter between tool calls. It no longer leaves room to read a discovery, a finished step, or an upcoming tool call as a reason to speak, and it now explicitly overrides the built-in instruction to say what you're about to do before a tool call. Text between tool calls is capped at one sentence per turn, and only when the work is about to do something you'd want to stop, is blocked on your answer, or will occupy more than a few minutes.

Subagents are now told to stay silent between tool calls as well, not just to keep their final message lean.

## 0.6.0-alpha — 2026-07-14

Added format guidance for Claude Code's own conversation-compaction summaries, so a compacted session keeps a structured list of facts (paths, decisions, open threads) instead of loose prose — and keeps pointers to any large output already moved to a local file, instead of losing track of it.

Large-output digests now open with a short breakdown of what they found (how many errors, failures, or warnings) instead of just a line count.

Log-shaped output with many similarly-structured lines (repeated build or worker-queue entries, for example) now collapses runs of them into one example line plus a count.

Diagnostics-style results from IDE tooling now compress into a table instead of passing through untouched.

The memory-file compression skill now flags content near the top of a file (timestamps, generated-on stamps) that can quietly make every session more expensive by invalidating Claude Code's prompt cache.

Added an optional debug log (`HUSH_DEBUG=1`) for troubleshooting and benchmarking — off by default.

Fixed an issue where a very large single-line output (e.g. minified JSON) could produce a compressed view larger than the original instead of being left untouched.

Fixed an issue where diagnostics-heavy MCP results were never actually compressed.

## 0.5.4-alpha — 2026-07-13

Doc-only: added a How it works section summarizing narration, output-trimming, and large-output handling; trimmed the now-redundant mechanism detail out of the opening section. No behavior change.

## 0.5.3-alpha — 2026-07-13

Doc-only: the README logo now adapts to dark mode (white silhouette instead of black). No behavior change.

## 0.5.2-alpha — 2026-07-12

Doc-only: rebuilt the Benchmarks section — a clearer set of charts, a full per-task table showing every job across all three setups, and current numbers. No behavior change.

## 0.5.1-alpha — 2026-07-12

### Changed

- Large outputs are digested more usefully: the digest now leads with the
  warning and error lines (so they're visible at a glance even when a host
  only previews the top of a big result), and compound error names like
  `ReferenceError` and `TypeError` are now recognized as signal.
- A command's output that the terminal has already truncated and saved
  itself now stays on the normal inline view instead of being moved behind
  a second digest. Large file reads are unaffected. `HUSH_SIDECAR_SHELL_MAX`
  tunes the threshold.

## 0.5.0-alpha — 2026-07-11

### Added

- Very large command output and log reads no longer enter the conversation
  whole: the full text is saved to a local file and a line-numbered digest
  takes its place — head, tail, a sample of warning/error lines with an
  exact count, and every line naming something from your prompt. Claude
  reads the file (by exact line ranges) only when it needs more.
  `HUSH_SIDECAR=off` disables it; `HUSH_SIDECAR_MIN` tunes the size
  threshold (default 15000 characters).

## 0.4.1-alpha — 2026-07-11

### Added

- Identifiers named in your prompt (backticked or quoted) now survive
  output compression, so a capped view keeps the entries you asked about.
- Compression tightens gradually in very long sessions to keep context
  lean. `HUSH_ADAPTIVE=off` disables the scaling.

## 0.4.0-alpha — 2026-07-11

### Added

- Reads of machine-generated files — lockfiles like `package-lock.json`,
  minified bundles, sourcemaps, anything under `node_modules/` or build
  output directories — are now compressed the same way logs are, with the
  usual marker noting what was trimmed. Hand-written source is never
  touched.
- Subagents now receive hush's terse-report instruction when they start,
  so their reports come back as findings instead of padded prose.
  `HUSH_SUBAGENT=off` disables it.

## 0.3.23-alpha — 2026-07-11

### Changed

- Reports with phases or sections now label each part with a bold lead
  (`**Timeline:**`, `**Fix targets:**`, `**Tests:**`), and short reports
  use labeled one-liners instead of prose paragraphs.
- Enumerable items no longer hide in a closing paragraph — they become
  bullets under their own lead.
- A single cause→effect arrow is allowed inside a bullet; longer chains
  and notation-as-prose remain out.

## 0.3.22-alpha — 2026-07-11

### Changed

- Final messages now lead with a bold outcome line and break multiple
  findings into bullet points with identifiers in code ticks, so reports
  scan at a glance. Short answers stay a single plain line.
- Word economy now means selecting what to report, not compressing the
  wording: complete clauses, no dropped articles, no arrow-chain shorthand.

## 0.3.21-alpha — 2026-07-11

### Changed

- Compression markers now identify themselves as hush's own tooling
  (`[hush hook: N lines omitted from this view, ...]`), so models treat
  them as telemetry instead of unexplained content in a file or log.

### Added

- The first compressed result in a session now carries a short provenance
  note delivered through the harness, telling the model that `[hush ...]`
  markers are trusted tooling metadata. `HUSH_NOTE=off` disables it.

## 0.3.20-alpha — 2026-07-11

### Fixed

- Fixed an issue where shell commands could be denied by permission checks
  or prompt for approval on every run even when an allow rule covered them,
  most visibly for PowerShell on Windows.

### Added

- `HUSH_WRAP=1` keeps exit-code capture active in permission-checked
  sessions whose rules grant `Bash`/`PowerShell` outright.

## 0.3.19-alpha — 2026-07-11

### Changed

- Mid-turn narration is tighter: between tool calls the correct output
  is silence, not a short status line, and check-ins now fire only on
  task-level events, not step-level ones.

## 0.3.18-alpha — 2026-07-10

### Changed

- Final-message reporting reads more clearly: no packing multiple facts
  into one line, test summaries no longer list every suite name.

## 0.3.17-alpha — 2026-07-09

### Changed

- When Claude settles a diagnosis mid-task, the check-in line now ends
  at the verdict itself instead of also announcing the next step.

## 0.3.16-alpha — 2026-07-09

### Changed

- The mid-turn narration reminder now repeats when narration keeps
  growing after a correction, instead of speaking up only once per
  turn. A single oversized message is still corrected exactly once.

## 0.3.15-alpha — 2026-07-09

### Changed

- A long-running command now gets one status line when it starts; the
  next thing said about it is its result.

## 0.3.14-alpha — 2026-07-09

Doc-only: the benchmarks section now opens with a chart of where a real session's tokens actually go — and why trimming replies alone can't cut the bill. No behavior change.

## 0.3.13-alpha — 2026-07-08

Doc-only: Benchmarks charts now display larger (640px instead of 540px). No behavior change.

## 0.3.12-alpha — 2026-07-08

Doc-only: the Benchmarks charts now carry the same sharpened figures as the surrounding text — a "3.1x" badge on the narration chart, a "+30%" badge on the noisy-build chart, and a new chart for hush's single best result (a real connection-pool-leak debugging task, 34% cheaper). No new numbers, no behavior change.

## 0.3.11-alpha — 2026-07-08

Doc-only: sharpened two Benchmarks sentences with sharper, still-exact numbers — the narration gap as a multiple ("more than three times as many words") and the noisy-build comparison against the "be brief" plugin directly ("its bill runs about 30% higher than hush's here"). No new numbers, no behavior change.

## 0.3.10-alpha — 2026-07-08

Doc-only: fixed the plugin listing's description, which claimed input-token savings the numbers don't support — it now describes output and narration only. The Benchmarks section states plainly that every number comes from a real multi-turn agent session, never a single reply. No behavior change.

## 0.3.9-alpha — 2026-07-08

Fixed an issue where a failing build or test command's output wasn't trimmed the way a passing command's was — noisy failures are now compressed the same way, with every warning, error, and failure line kept intact. Fixed a rare case where the mid-turn narration check could force an extra, unwanted reply after Claude had already finished answering.

## 0.3.8-alpha — 2026-07-08

Doc-only: plugin.json's description now matches the marketplace listing text. No behavior change.

## 0.3.7-alpha — 2026-07-07

Hush now also trims bulky log files Claude reads directly (`.log` files, and `.txt`/`.out` files inside a `logs` folder) — the same signal-preserving treatment noisy command output already gets: warning and error lines always survive, omitted stretches say so, and asking for a complete listing still gets you the whole log. Source code is never touched.

## 0.3.6-alpha — 2026-07-07

Fixed an issue when pairing hush with [razor](https://github.com/V-Songbird/razor): on hard debugging tasks the combination could make the model reason for much longer than necessary — a cost and latency hit, never a correctness one. Mid-turn silence now allows stating a settled diagnosis in one line before acting on it, which keeps reasoning lean whether hush runs alone or paired.

## 0.3.5-alpha — 2026-07-07

Documented a known limitation when pairing hush with [razor](https://github.com/V-Songbird/razor) on hard debugging tasks. No behavior change; resolved in 0.3.6.

## 0.3.4-alpha — 2026-07-07

When you ask hush to list or enumerate every warning, error, or item in a log, output compression now steps aside so you get the complete list instead of a trimmed one. Ordinary requests are still compressed as before.

## 0.3.3-alpha — 2026-07-07

When output is trimmed, the note about omitted lines now also confirms none of them contained a warning, error, or failure — so you don't need to re-run a command just to double-check nothing was hidden.

## 0.3.2-alpha — 2026-07-06

Tightened the output style's wording rules: the problem statement is skipped when the cause already makes it obvious, and a small set of standard dev abbreviations (obj, ref, var, cmd, pkg, arg, msg, config, repo, env, param) are now allowed by default.

## 0.3.1-alpha — 2026-07-06

Fixed an issue where compressing the output of a plain file-dump command (e.g. `cat`, `type`, `Get-Content`) could cut lines out of the middle of the file instead of just trimming noise. These commands are now recognized and handled so their output stays intact.

## 0.3.0-alpha — 2026-07-06

Added `/hush:hush-compress <path>` — a skill that shrinks a CLAUDE.md or memory file into a terser form, so future sessions that load it spend fewer tokens doing so. It never modifies the original file; the result is written to a new sibling file for you to review and swap in.

## 0.2.5-alpha — 2026-07-06

Sharpened the output style's word-economy guidance with concrete before/after examples, so mid-turn and summary text is terser by default. Final answers still read as complete, correct sentences — only padding is cut, not grammar or technical accuracy.

## 0.2.4-alpha — 2026-07-06

Fixed an issue where a warning, error, or failure line in an otherwise passing run could be trimmed away along with surrounding noise. Those lines are now always preserved regardless of where they fall in the output.

## 0.2.3-alpha — 2026-07-06

Fixed an issue where multi-line output from native Windows console commands (PowerShell, `Get-ChildItem`, `dir`, etc.) could be collapsed down to just its last line. Windows-style line endings are now handled correctly, so this output compresses without losing content.

Also added guidance to the output style clarifying that trimming wording never means trimming how thoroughly the agent investigates before answering.

## 0.2.2-alpha — 2026-07-05

Added `HUSH_NARRATION=off` to disable the narration correction on its own, without also disabling output compression.

## 0.2.1-alpha — 2026-07-05

Fixed an issue where the narration correction could keep re-firing within the same turn instead of only once.

## 0.2.0-alpha — 2026-07-05

The narration correction can now step in mid-turn instead of waiting until the turn ends, so an overly wordy turn gets corrected the first time it happens rather than only on the next one.

- A turn corrected mid-turn won't also be flagged again at the end of it.
- A new message from you always resets and re-arms the check.

## 0.1.1-alpha — 2026-07-05

Fixed an issue where a chain of background task notifications could each reset the narration word count, letting narration slip past uncorrected across the chain. A run of notifications without new input from you now counts as a single turn for this check.

## 0.1.0-alpha — 2026-07-05

Initial release.

- Forced output style: silent progress mid-turn, an outcome-first final message, full detail preserved for code, errors, and security-relevant output.
- Automatic compression of noisy Bash/PowerShell command output, with warnings and errors always preserved.
- Mid-turn narration correction: keeps chatty progress commentary within a configurable word budget.
- Configurable via environment variables: `HUSH_CAP_PASS`, `HUSH_CAP_FAIL`, `HUSH_NARRATION_BUDGET`, `HUSH_DISABLE`.
