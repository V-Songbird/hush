# Changelog

All notable changes to hush are documented here. Hush is a monorepo-folder
plugin — its version is owned by `.claude-plugin/marketplace.json` at the
repo root, not by `hush/.claude-plugin/plugin.json` (which carries no
version field by convention).

## 0.3.7-alpha — 2026-07-07

Hush now also trims bulky log files Claude reads directly (`.log` files, and `.txt`/`.out` files inside a `logs` folder) — the same signal-preserving treatment noisy command output already gets: warning and error lines always survive, omitted stretches say so, and asking for a complete listing still gets you the whole log. Source code is never touched.

## 0.3.6-alpha — 2026-07-07

Fixed an issue when pairing hush with [razor](../razor): on hard debugging tasks the combination could make the model reason for much longer than necessary — a cost and latency hit, never a correctness one. Mid-turn silence now allows stating a settled diagnosis in one line before acting on it, which keeps reasoning lean whether hush runs alone or paired.

## 0.3.5-alpha — 2026-07-07

Documented a known limitation when pairing hush with [razor](../razor) on hard debugging tasks. No behavior change; resolved in 0.3.6.

## 0.3.4-alpha — 2026-07-07

Enumeration carve-out. When a prompt explicitly asks to enumerate EVERY / ALL / EACH of some countable thing (warnings, errors, files, items, …), the compression hook now passes the log **uncapped** (`HUSH_CAP_ENUMERATE`, default 2000 lines) — it still strips ANSI, resolves `\r`, and collapses consecutive duplicates, but elides nothing, so the model never distrusts a partial view and re-runs the command to recover it. The turn's real human prompt is read from the transcript tail (harness-injected continuations don't count), and detection requires a completeness quantifier (or the verbs `list`/`enumerate`) next to a countable noun, so ordinary prose ("explore the whole repo") doesn't disable compression. Compression still cuts noisy output you haven't asked to fully enumerate. Supersedes the 0.3.3 omission-marker approach, which reduced but didn't fully remove the distrust on completeness tasks. 76 tests (was 61); new shared `hooks/lib/transcript.js` for turn-boundary logic, now used by both the compression hook and the narration meter.

## 0.3.3-alpha — 2026-07-07

Self-certifying omission markers. A bare `[hush: N lines omitted]` reads to the model as "signal might be hidden here," so on a completeness task it re-runs the command to recover what it thinks it's missing. But `capLines` keeps every warning/error/failure line by construction, so an omitted span provably contains none. The marker now states that guarantee: `[hush: 354 lines omitted, none with warnings/errors/failures]` — honest, mechanical, local, no blanket "trust me" claim. 61 tests (was 60).

## 0.3.2-alpha — 2026-07-06

Word economy: added a named "contextual pruning" rule (drop the problem statement when the cause implies it), an explicit whitelist of standard dev shorthand (obj, ref, var, cmd, pkg, arg, msg, config, repo, env, param), and a micro-operators line (symbols for comparisons/results, short words for logic). Reconciled against Register's "no invented shorthand" line, which now points at the whitelist instead of contradicting it.

## 0.3.1-alpha — 2026-07-06

Fix: the pass-cap (60 lines) assumed a clean exit meant "log noise, safe to trim" — true for build/test output, false for a command that just prints a whole file (`cat`/`type`/`Get-Content` with no pipe/chain/redirect). Source text has no `WARN`/`ERROR` markers for `capLines`' signal-preservation to anchor on, so the head+tail cap could cut arbitrary lines out of the middle of a file. Plain file-dump commands are now detected and treated like a failing run (250-line cap). 60 tests (was 56).

## 0.3.0-alpha — 2026-07-06

New skill: `/hush:hush-compress <path>` shrinks a CLAUDE.md/memory file into hush's own dev-shorthand voice (the output style's word economy, not broken grammar) so every future session that loads it pays fewer input tokens.

It never writes to the original file in any code path — output goes to a sibling file (`CLAUDE.md` → `CLAUDE.hush.md`) for manual review and swap-in. That sidesteps the whole truncate-then-write failure class (where an interruption mid-write can leave the original empty) rather than hardening around it. No subprocess, no API key, no second LLM call — the current session compresses the file itself, the way every other skill in this monorepo works. `hush/scripts/verify-compression.js` (plain Node, no deps) mechanically checks headings, code blocks, URLs, paths, and inline-code spans all survive. 14 new tests (56 total).

## 0.2.5-alpha — 2026-07-06

Word economy sharpened from a self-check alone to a default-to-fragments rule with concrete before/after examples, e.g. `"Bug: auth middleware, expiry check used < not <=."` instead of `"I found that the bug is in the auth middleware, where..."`. Deliberately bounded — dev-shorthand density, not broken grammar: grammar stays correct where present, technical terms stay exact, nothing invented or abbreviated beyond recognition. Final answers stay complete, professional sentences.

## 0.2.4-alpha — 2026-07-06

Fix: `capLines` did a blind head+tail slice, so a build warning that happened to fall outside that window got cut along with the surrounding noise — and on a task asking for every warning, the agent couldn't see the clipped ones and re-ran the build hunting for them, the cap costing far more than it saved. Lines matching a warning/error/failure/deprecation pattern now survive the cap regardless of position — only surrounding noise gets cut, the same principle already applied to whole failing runs, extended to individual lines within a passing one. 42 tests (was 40).

## 0.2.3-alpha — 2026-07-06

Fix: `resolveCarriageReturns` treated `\r\n` (an ordinary Windows line ending) as a progress-bar redraw signal, blanking every CRLF-terminated line down to nothing and keeping only whatever survived after the last bare `\r`. Since native Windows console output (PowerShell, `Get-ChildItem`, `dir`, …) is CRLF throughout, this silently collapsed almost all passing multi-line Windows tool output to its last line. Now normalizes `\r\n` to `\n` before resolving genuine mid-line `\r` redraws. Added regression coverage for CRLF-terminated and mixed CRLF+redraw input. 40 tests (was 38).

Also added a "Word economy" + "Thoroughness is not negotiable" pairing to the output style: a self-check ("can I cut a word without losing a fact?") for prose density, paired explicitly with a rule that the cut applies to wording, never to how much the agent investigates before answering.

## 0.2.2-alpha — 2026-07-05

`HUSH_NARRATION=off` disables the narration meter alone (mirrors razor's `RAZOR_LEDGER=off`). Previously the only options were `HUSH_DISABLE=1` (kills compression too) or an absurd `HUSH_NARRATION_BUDGET` workaround — `0` is a valid budget, so the budget knob can't mean "off". 38 tests (was 37).

## 0.2.1-alpha — 2026-07-05

Fix: the Stop-mode correction re-fired on every consecutive Stop within the same logical turn — a feedback loop where each fire's injected context forced another reply whose words re-counted into the same turn. Cause: only the mid-turn (PostToolUse) path wrote the once-per-turn dedup state; Stop fires never marked the turn. Now any fire, mid-turn or Stop, writes the state. 37 tests (was 36).

## 0.2.0-alpha — 2026-07-05

Mid-turn narration meter — the Stop-only meter couldn't intervene until a turn ended, so the first offending turn always got through uncorrected.

- `narration-meter.js` is now dual-mode, registered on both `PostToolUse` and `Stop` (mode from `hook_event_name`). Mid-turn mode counts every text block so far and injects the corrective line the moment the budget is crossed — inside the offending turn.
- Once-per-turn dedup via a state file in the OS temp dir keyed by `session_id`; the turn is identified by the last real user prompt's `uuid`. Stop mode skips turns the mid-turn fire already corrected; a new human prompt re-arms the meter.
- Transcript reads are a 1MB tail window instead of a full streaming read, so cost stays flat as sessions grow. A single turn larger than 1MB undercounts (delays the fire) — documented ceiling.
- 36 tests (was 28).

## 0.1.1-alpha — 2026-07-05

Fix: `narration-meter.js`'s turn-boundary detection (`isRealUserPrompt`) treated harness-injected continuations — background Task-tool notifications (`origin.kind: "task-notification"`) and `ScheduleWakeup` firings (`isMeta: true`) — as fresh user turns. Each reset the narration accumulator, so a chain of short status pings after consecutive background-task completions never tripped the word budget. Now only `origin.kind === "human"` entries count as turn boundaries; the whole notification chain is measured as one turn. Added a matching line to `output-styles/hush.md` telling the model directly that a chain of notifications without new human input is one unit of work, not one per notification.

## 0.1.0-alpha — 2026-07-05

Initial release.

- Forced output style (`force-for-plugin: true`, `keep-coding-instructions: true`): silent mid-turn, outcome-first final message, full fidelity for code/errors/security.
- `PostToolUse` hook `compress-tool-output.js`: deterministic Bash/PowerShell output compression via `updatedToolOutput` — ANSI strip, `\r` resolution, consecutive-duplicate collapse, line caps (60 passing / 250 failing, tunable).
- `Stop` hook `narration-meter.js`: counts mid-turn narration words per turn, injects one corrective line only over budget (default 120 words).
- Env knobs: `HUSH_CAP_PASS`, `HUSH_CAP_FAIL`, `HUSH_NARRATION_BUDGET`, `HUSH_DISABLE`.
- 26 tests (node:test).
