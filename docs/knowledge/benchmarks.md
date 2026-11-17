---
type: knowledge
summary: "Every published Hush measurement on Claude Code: the 1.13.0 voice on Claude Opus 5.5 that the README shows, the 1.11.1 voice on Claude Opus 5, and where Hush loses; read before changing a published number."
related_files:
  - README.md
  - output-styles/hush.md
---

# Hush benchmarks

This page holds every measurement Hush publishes, with its method and its limits. The README shows the first batch only, under [The numbers](../../README.md#the-numbers).

All results are from Claude Code. Results vary between runs, and none of them promises the same behavior in your sessions. Each batch names the release whose voice it measured. The current voice has no measured result.

## Contents

- [How a session is measured](#how-a-session-is-measured)
- [Claude Opus 5.5, voice 1.13.0](#claude-opus-55-voice-1130)
- [Claude Opus 5, September 1, 2026](#claude-opus-5-september-1-2026)
- [Where Hush loses](#where-hush-loses)

## How a session is measured

- Each test session is a real Claude Code session in its own throwaway folder.
- Nine jobs span how much a session prints, from a plan with no edits to a 300 KB outage log.
- Every job ends with a check. A short answer that breaks the job counts as a failure.
- Prices are the bill read back from the API.
- Prose words exclude fenced code.

The raw records, the definitions behind these figures and the benchmark harness are kept outside this repository. They are not distributed with the plugin.

## Claude Opus 5.5, voice 1.13.0

Batch `o55-451-495ce18f`, started September 28, 2026: nine fixture jobs, four runs per setup, 36 sessions each, in Claude Code with Claude Opus 5.5 (model id `claude-opus-5-5`) at the default effort. Hush ran with `HUSH_WRAP=1`, set in bash as `HUSH_WRAP=1 claude` and in PowerShell as `$env:HUSH_WRAP = '1'; claude`. This measures the voice of release [1.13.0](https://github.com/V-Songbird/hush/releases/tag/v1.13.0).

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5.5"],"date":"2026-09-28","reviewedAt":"2026-11-14"} -->
| Model | Setup | Jobs right | Spoke at most once before the answer | Median final prose words | Average bill per session |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | No plugin | 36/36 | 28/36 | 369 | $0.421 |
| Claude Opus 5.5 | hush | 36/36 | 36/36 | 271 | $0.458 |

<p align="center"><img src="../../assets/hero.svg" alt="One spike per recorded session on Claude Opus 5.5 for words of play-by-play before the answer: 36 sessions without hush average 15.4 words and 28 speak at most once; 36 sessions of the same nine jobs with hush average 1.0 word, and all 36 speak at most once." width="700"></p>

<details>
<summary>Watch the recorded demo: one real session each on Claude Opus 5.5, paced by each session's recorded time</summary>

<p align="center"><img src="../../assets/demo.svg" alt="The same job side by side: to get a red pricing suite green, Claude without hush sends 2 progress notes, then a 179-word answer; with hush it stays quiet, then sends one 206-word answer. Both leave the suite green." width="700"></p>

</details>

Hush said nothing at all before the answer in 34 of 36 sessions, against 12 of 36 without a plugin, and sent 1.0 word of play-by-play per session against 15.4. The medians are 369 and 270.5, rounded, about 27% shorter. Sentences were shorter too: 0.5% ran past 20 words against 10.9%. Runnable content appeared in all 36 answers of both setups; that text heuristic does not check that a command is correct or complete.

**On Opus 5.5, Hush costs more.** The average bill per session was 9% higher. Seven of the nine jobs cost more, by 4% to 32%, and four of those are above about 16%, the largest gap that batch showed between two near-identical setups. Only the two jobs whose commands print the most came out cheaper: the 57 KB log by 19% and the 380 commits by 4%. Opus 5.5 already writes less without a plugin, so Hush has less to remove. Everything the assistant wrote per session was 6% higher, 3,654 tokens against 3,453, while what the commands printed fell 9%, 22.2k characters against 24.4k. Treat a per-job cost difference under about 16% in this batch as noise.

Most of that gap is the voice's own text, which rides in every request. Both setups made about seven requests per session. The tokens sent across them were 11% higher with Hush, 184,489 against 166,730. That is about 2,500 more per request. The batch ran a 5.8 KB voice. Today's voice is 18.4 KB in the desktop app, and no batch has measured its cost. A terminal session or `claude -p` carries 11.1 KB of it; [the app part](how-it-works.md#the-app-part) says why.

Hush's gain is partly separate from length. In three jobs, the red test suite, the notification router and the half-done rename, Hush wrote more prose words on average, and in the first two every Hush session was longer than every no-plugin session. Hush messages still held 52.3% of their words in blocks over 40 words on average, against 78.3% without a plugin.

A fresh Claude Sonnet session that got only the request and the final message answered all three questions (what happened, what to open or run, what to do next) for 100% of Hush answers and 94.4% of no-plugin answers; the two no-plugin misses came from the notification router job. This test moves a few points between runs on its own. A message linked the file to open with a line number in 29 of 36 Hush sessions and none of 36 without a plugin.

## Claude Opus 5, September 1, 2026

Batch `rivalA-762f888b`, started September 1, 2026 at 07:34 UTC: nine jobs, four runs per setup, 36 sessions each, in Claude Code with the `opus` alias (the records store the alias, not a model id; it is taken to be Opus 5) at medium effort, `HUSH_WRAP=1`. The hush sessions ran hush [1.11.1](https://github.com/V-Songbird/hush/releases/tag/v1.11.1); the records do not store a version, so that is the release this batch is taken to measure.

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5"],"date":"2026-09-01","reviewedAt":"2026-11-14"} -->
| Claude Opus 5, 36 sessions each | Jobs right | Spoke at most once before the answer | Median final prose words | Sentences over 20 words | Words in blocks over 40 words, mean |
| --- | --- | --- | --- | --- | --- |
| No plugin | 36/36 | 14/36 | 367 | 19.2% | 67.8% |
| hush | 36/36 | 36/36 | 69 | 0.3% | 5.8% |

<p align="center"><img src="../../assets/hero-opus5.svg" alt="One spike per recorded session for words of play-by-play before the answer: 36 sessions without hush reach 134 words, and the same 36 with hush speak at most once, never past 7 words." width="700"></p>

<details>
<summary>Watch the recorded demo from this batch: one real session each on Claude Opus 5</summary>

<p align="center"><img src="../../assets/demo-opus5.svg" alt="The same job side by side: to get a red pricing suite green, Claude without hush sends 4 progress notes and a 254-word write-up; with hush it stays quiet, then sends one 42-word answer. Both leave the suite green." width="700"></p>

</details>

That batch does not separate structure from length: Hush's range of words per session overlapped the no-plugin range in none of the nine jobs, so every difference is also a length difference. Hush was cheaper on six of the nine jobs, by 13% to 37%, but cost more on the three quietest jobs, by 1%, 4% and 10%. A per-job cost difference under about 15% in that batch is noise: two identical setups differed by 14%, $0.4765 against $0.4112, 36 sessions each. Runnable content appeared in 34 of 36 Hush answers, 94%, and in all 36 without a plugin; the two Hush answers without it came from the red test suite and the notification router, one session each.

## Where Hush loses

Each loss below is measured in a batch on this page. They are gathered here so none is missed.

| Loss | Batch |
| --- | --- |
| Hush cost 9% more per session on average, and more on seven of nine jobs | Claude Opus 5.5, voice 1.13.0 |
| Hush wrote more prose words on three jobs: the red test suite, the notification router and the half-done rename | Claude Opus 5.5, voice 1.13.0 |
| Hush cost more on the three quietest jobs, by 1%, 4% and 10% | Claude Opus 5, voice 1.11.1 |
| Runnable content appeared in 34 of 36 Hush answers, against all 36 without a plugin | Claude Opus 5, voice 1.11.1 |
