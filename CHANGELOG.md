# Changelog

All notable changes to hush are documented here. Hush is a monorepo-folder
plugin — its version is owned by `.claude-plugin/marketplace.json` at the
repo root, not by `hush/.claude-plugin/plugin.json` (which carries no
version field by convention).

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

Fixed an issue when pairing hush with [razor](../razor): on hard debugging tasks the combination could make the model reason for much longer than necessary — a cost and latency hit, never a correctness one. Mid-turn silence now allows stating a settled diagnosis in one line before acting on it, which keeps reasoning lean whether hush runs alone or paired.

## 0.3.5-alpha — 2026-07-07

Documented a known limitation when pairing hush with [razor](../razor) on hard debugging tasks. No behavior change; resolved in 0.3.6.

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
