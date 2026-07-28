# Reproduce hush's benchmarks

Curious whether the numbers on hush's front page hold up? This is the actual harness — run it yourself.

It drives **real headless Claude Code sessions** (`claude -p`) on the same fixed tasks, once with no plugin and once with hush, and reads the true cost and token counts straight out of the API's own usage blocks. No tokenizer estimates, no hand-waving, and no single-shot prompts — a canned reply can't tell you what a plugin costs across a real multi-turn session, so we don't measure it that way. Correctness is checked mechanically, so compression that mangles the answer scores as a *failure*, not a win.

## Before you start

- **Claude Code, signed in.** `claude` must be on your PATH and already authenticated (run any `claude` command once first). Every run bills your account — see the cost note below.
- **Node** on your PATH (any recent version). If you use [fnm](https://github.com/Schniz/fnm), activate it in this shell first — e.g. on PowerShell: `fnm env --use-on-cd | Out-String | Invoke-Expression`.
- Run the commands **from this `benchmarks/` directory.**

## The honest disclaimer, up front

> [!WARNING]
> This costs real money. The cheap default run is roughly **$1–3 on the small model** and takes a few minutes. The full suite, or running on the bigger model, costs more.

> [!NOTE]
> The numbers move between runs — a handful of reps against a live model, not a powered experiment. Expect single-digit-percent swings on any given task, and more on the noisy ones. `noisy-build` is genuinely bimodal on the bigger model, sometimes running clean and sometimes triggering extra verification turns — judge it by the *per-rep spread*, not just the mean.

**What you should see:** the same *shape* as our published charts — hush **below baseline on the log-heavy tasks** (`log-triage`, `incident-followup`, `incident-pool-leak`), **above baseline on the no-tools ones**, and **far less mid-turn narration** with leaner tool output throughout. You will **not** reproduce our exact figures, and that's expected. The claim holds if the noisy rows win by more than the quiet rows lose, with every task still passing — a run where hush is cheaper on every single task would be the surprising result, not the target.

## Run it

**1. Smoke test first** (one task, one rep — pennies, ~30s) to confirm the plumbing drives `claude` and scores an answer:

```bash
node runner/run.js --tag smoke --tasks explain-rerender --reps 1 --model haiku
```

**2. The real thing** — the cheap default subset (8 tasks × baseline + hush × 2 reps, small model):

```bash
node runner/run.js --tag mine --model haiku
node runner/report.js --tag mine
```

That writes `results/mine/report.md` and `results/mine/report.html` — tables, SVG bar charts, and the two arms' final answers side by side. Open the HTML to see it all at a glance.

**3. Go bigger** (optional) — the whole task suite, or the larger model (costs more):

```bash
node runner/run.js --tag full --full --model haiku      # all 15 tasks
node runner/run.js --tag big  --model sonnet            # default subset, bigger model
```

Flags: `--tasks a,b` (pick tasks) · `--full` (whole suite) · `--reps N` · `--model haiku|sonnet` · `--arms baseline,hush` · `--concurrency N` · `--tag NAME` · `--resume` (re-read completed runs from disk instead of paying for them again — a rate-limited or interrupted run records as an error and re-runs) · `--hush-debug` (attach hush's per-decision manifest to each hush-arm record, surfaced in `report.md` as a "hush decisions" line per task).

## Bring your own rival

Want to see how hush stacks up against some *other* plugin? Point `--rival-dir` at any plugin directory on your machine and it becomes a third arm — measured on exactly the same tasks, same way:

```bash
node runner/run.js --tag vs --rival-dir /path/to/other-plugin
node runner/report.js --tag vs
```

Options: `--rival-name <label>` (how it shows up in the report) · `--rival-settings <path>` (a `--settings` file if that plugin needs one) · `--rival-env KEY=VAL,KEY2=VAL2` (env vars it expects). Repeat the flags to race several rivals at once — the Nth `--rival-name`/`--rival-settings`/`--rival-env` belongs to the Nth `--rival-dir`. We don't ship or name any rival — you bring whichever one you're curious about.

## Verify it yourself, for free

The claims also rest on hush's unit tests, which cost nothing to run — they exercise the compression and narration logic directly:

```bash
node --test hush/tests/*.test.js
```

(Run that from the repo root. On Windows Node 22, use the explicit `*.test.js` glob shown here — a bare `node --test tests/` with a trailing slash trips up on that version.)

## What's measured

Each run records, per session: cost, output tokens, **context traffic** (the sum of input + cache tokens across every API call — where tool-output compression shows up), mid-turn narration words vs. the final answer, characters of tool output that entered context, turns, wall time, and a pass/fail from the task's ground-truth check.

The tasks: 15 in all — three no-tools questions (measuring how much Claude *says*), eleven tool tasks that fix failing tests, triage a long log, summarize a small codebase, or report every warning from a noisy build, and one multi-turn task (`incident-followup`) that carries a conversation across three prompts in the same session — the only way to see what a plugin costs once history has accumulated, not just on the first exchange. Correctness is a keyword rubric or `node --test` exit code, hand-ground-truthed per task — a degenerate one-word answer fails.

Every repo the tool tasks run in is a purpose-built fixture — a small seeded project with the bug or the noisy log already in place, not an open-source checkout. That keeps runs comparable and cheap; it also means the suite measures those shapes of work, not the shape of your repo.

### A note on fairness

hush's output style is part of the product, so its prompt overhead is included in the measurement, not subtracted. Each arm runs in a fresh throwaway workspace outside any git repo, with only that one plugin loaded (`--setting-sources project`, no MCP servers, a scoped tool allowlist) — so a difference between arms is the plugin, nothing else.
