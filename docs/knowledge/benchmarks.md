---
type: knowledge
summary: "The full Claude Code benchmark tables behind the README: correctness, quiet, cost per job, runnable content, long-sentence and block exposure, prose surface, answer usefulness and where hush loses; read before changing a published number."
related_files:
  - README.md
  - output-styles/hush.md
---

# The numbers, in full

The README uses the September 1, 2026 comparison, `rivalA-762f888b`; its setup and tables are under [The README comparison](#the-readme-comparison).

Every table from [The earlier comparisons](#the-earlier-comparisons) onward preserves the August 30 comparisons: `rm320-99a236ff` (`opus`, 36 sessions per setup) and `sn320-a9885078` (`sonnet`, 18 per setup). Those batches did not record an explicit effort override, so the effective host default is unknown. They are separate runs, not additional repetitions of the README comparison.

The records, definitions and source reconciliation behind these figures are kept outside this repository. Raw output-token counts include all output billed by the API; prose word counts exclude fenced code. The README comparison's final prose words and the words column under Prose surface are medians; the job-by-job comparison uses job averages. Reading-ease and grade scores are heuristic averages, not a reader study.

Every figure on this page was measured before same-shape folding got its 4,000-character floor (see [Unreleased](changelog.md#unreleased) in the changelog). The README comparison ran hush 1.11.1, the release current when it started, and the August 30 comparisons ran the same compression code; both folded runs of same-shape lines at any size. To see what the floor changes, the no-plugin sessions' recorded tool output was replayed offline through the current compression and through the same code without the floor. With the floor, hush prints 1.2% more per session in the README comparison, 1.3% more in the August 30 Opus comparison and 0.2% more in the Sonnet one, averaged over the nine jobs. The largest changes are on Opus: the outage job, +9.8% and +6.6%, and the 57 KB log job in the August 30 run, +7.8%. The three quietest jobs of the README comparison do not change. The replay counts characters only: no price was re-measured, and it cannot show the re-runs the floor exists to prevent.

← [Back to the README](../../README.md)

---

## What a test session is

Nine jobs, each in its own throwaway folder. Real Claude Code sessions from start to finish — it
reads files, edits code, runs commands. Never a single canned reply.

The jobs are deliberately spread across the range of how much a session prints: a notification
router where the plan changes four times, a dependency bump that breaks a build, a 57 KB
application log, a 300 KB outage, a red test suite, a column rename across a thousand lines, a
half-done rename across 76 files, 380 commits to turn into release notes, and one that asks how it
would add a CLI flag without letting it write anything.

Every job ends with a check. The code gets run, or the answer gets matched against that job's own
checklist. **A short answer that breaks the job counts as a failure, not a win.**

Every price is the real bill, read back from the API.

## The README comparison

Batch `rivalA-762f888b`, started September 1, 2026 at 07:34 UTC: the nine jobs above, four repetitions per setup, in Claude Code with the recorded `opus` alias (identified as Opus 5 by the published source) at medium effort. Hush used the shipped writing voice and `HUSH_WRAP=1`.

| Claude Opus 5, 36 sessions each | jobs right | spoke at most once before the answer | median final prose words |
| --- | --- | --- | --- |
| no plugin | 36/36 | 14/36 | 367 |
| caveman | 36/36 | 31/36 | 151 |
| **hush** | **36/36** | **36/36** | **69** |

The medians are 366.5, 150.5 and 68.5, rounded. Prose words exclude fenced code. The batch also ran two other setups, which the README does not compare.

### Reading it

Short is not the same as easy to read. The same sessions were measured for how much of each final message sits in long sentences or in long unbroken blocks, beside whether the job came out right. These thresholds are not clinically validated, and none of these measures is a reader study.

| Claude Opus 5, 36 sessions each | jobs right | sentences over 20 words | over 25 | over 30 | words in blocks over 40 words, mean | median |
| --- | --- | --- | --- | --- | --- | --- |
| no plugin | 36/36 | 19.2% | 9.8% | 3.9% | 67.8% | 69.3% |
| caveman | 36/36 | 4.3% | 2.0% | 0.7% | 55.2% | 64.4% |
| **hush** | **36/36** | **0.3%** | **0.0%** | **0.0%** | **5.8%** | **0.0%** |

For sentences and blocks, fenced code is left out, and inline code, paths, file names, identifiers, flags, versions, hashes and URLs each count as one word. Sentence shares are pooled over every sentence a setup wrote. A block is the text between blank lines, table rows left out; the last two columns give the share of each message's words that sit in blocks over 40 words, as the mean and the median over the 36 sessions.

Reading ease and grade level are prose surface: formulas over word and sentence length, not a measure of whether a reader understood the answer or could act on it. Same sessions, same counting:

| Claude Opus 5, 36 sessions each | words per sentence | reading ease | grade level |
| --- | --- | --- | --- |
| no plugin | 12.9 | 70.9 | 6.6 |
| caveman | 8.4 | 73.5 | 5.1 |
| **hush** | **6.2** | **90.9** | **2.1** |

Job by job: in how many of the nine jobs hush's average beat the other setup's, with the exact two-sided sign-flip p over the nine job differences. Nine of nine gives 0.004, the smallest p that nine jobs allow.

| hush against | no plugin | caveman |
| --- | --- | --- |
| fewer prose words | 9 of 9, p 0.004 | 9 of 9, p 0.004 |
| smaller share of sentences over 20 words | 9 of 9, p 0.004 | 8 of 9, p 0.008, 1 tie |
| smaller share of sentences over 30 words | 9 of 9, p 0.004 | 4 of 9, p 0.125, 5 ties |
| less of the message in blocks over 40 words | 9 of 9, p 0.004 | 9 of 9, p 0.004 |
| higher reading ease | 9 of 9, p 0.004 | 9 of 9, p 0.004 |

**This batch does not separate structure from length.** Counted with the prose word count behind the medians above, fenced code excluded, hush's range of words per session overlaps the no-plugin range in none of the nine jobs, and the caveman range in one job, only through a single 42-word caveman session. Every difference in these tables is also a length difference.

### Cost and runnable content by job

Same batch, `rivalA-762f888b`. Its hush sessions ran hush 1.11.1, the release current when the batch started; the records themselves do not store a version. Each price is the average bill of a job's four sessions, read back from the API, with the change against no plugin; the cheapest setup is in bold. An answer counts as runnable when its final message holds a fenced code block or inline code with a space in it, the usual shape of a command. That heuristic does not check that the command is correct or complete. Jobs are ordered by how much tool output the no-plugin sessions took in, least first.

| The job | tool output per session, no plugin | no plugin | caveman | hush | answers with runnable content, no plugin · caveman · hush |
| --- | --- | --- | --- | --- | --- |
| Plan a `--json` flag without editing anything | 2.9k chars | **$0.155** | $0.169, +9% | $0.170, +10% | 4/4 · 4/4 · 4/4 |
| Get a build clean again after a dependency bump | 6.7k chars | **$0.250** | $0.259, +4% | $0.254, +1% | 4/4 · 4/4 · 4/4 |
| Fix a red test suite hiding three real failures | 9.8k chars | $0.257 | **$0.242, −6%** | $0.267, +4% | 4/4 · 4/4 · 3/4 |
| Build a notification router while the plan changes four times | 14.0k chars | $0.689 | $0.649, −6% | **$0.588, −15%** | 4/4 · 4/4 · 3/4 |
| Dig through 300 KB of logs for the cause of an outage | 18.8k chars | $0.850 | $0.631, −26% | **$0.564, −34%** | 4/4 · 4/4 · 4/4 |
| Finish a half-done rename across 76 files | 20.4k chars | $0.429 | **$0.352, −18%** | $0.368, −14% | 4/4 · 4/4 · 4/4 |
| Scope a column rename that matches a thousand lines | 24.1k chars | $0.432 | $0.410, −5% | **$0.377, −13%** | 4/4 · 4/4 · 4/4 |
| Find what actually changed for users across 380 commits | 52.8k chars | $0.709 | **$0.417, −41%** | $0.513, −28% | 4/4 · 4/4 · 4/4 |
| Triage a 57 KB application log | 60.9k chars | $0.516 | $0.511, −1% | **$0.325, −37%** | 4/4 · 4/4 · 4/4 |

hush cost more than no plugin on the three quietest jobs, by 1%, 4% and 10%. Runnable content appeared in 34 of 36 hush answers, 94%, and in all 36 answers without a plugin and with caveman. The two hush answers without it came from the first session of the red test suite job and of the notification router job.

## The earlier comparisons

Below: the earlier Opus and Sonnet comparisons described above. Failing-command trimming was on (`HUSH_WRAP=1`), with the shipped writing voice.

## Does it still work?

| setup | jobs right, Opus 5 | jobs right, Sonnet |
| --- | --- | --- |
| no plugin | 36 / 36 | 18 / 18 |
| **hush** | **36 / 36** | **18 / 18** |

Nothing on this page was bought with a wrong answer.

## How quiet

Some sessions still open with a line about what the assistant is about to do. These comparisons count both fully silent sessions and sessions that spoke at most once before the answer. The Opus table is batch `rm320-99a236ff`, started August 30, 2026 at 02:53 UTC with the recorded `opus` alias; the Sonnet table is batch `sn320-a9885078`, started the same day at 03:30 UTC with `sonnet`.

| Claude Opus 5, 36 sessions each | no plugin | hush |
| --- | --- | --- |
| spoke at most once before the answer | 12 | **36** |
| said nothing at all | 0 | **28** |
| worst single session | **10 separate messages** | **1** |
| total mid-work messages | 104 | **8** |
| words of play-by-play, per session | 41.1 | **1.5** |

| Claude Sonnet, 18 sessions each | no plugin | hush |
| --- | --- | --- |
| spoke at most once before the answer | 12 | **16** |
| said nothing at all | 5 | **11** |
| worst single session | 4 messages | 3 |
| words of play-by-play, per session | 30.1 | **8.1** |

The zero-word count is the softer of the two. It slides with how long a session runs — on the same
build it reads near 100% on short jobs and drops away on the longest ones. The at-most-once result held across these Opus sessions; it is not a guarantee for other workloads.

## How much it cuts

Averaged per session over the nine jobs, Opus 5:

| | no plugin | hush | |
| --- | --- | --- | --- |
| what your commands print | 23.1k chars | **16.5k chars** | −28% |
| play-by-play while working | 41 words | **2 words** | −96% |
| everything Claude writes in a session | 7,365 tok | **4,442 tok** | −40% |

On Opus the second cut is the big one. hush's writing rules cost a little on every round trip and
earn it back by keeping Claude's own output short.

## The bill, job by job

There is no suite-wide cost percentage on this page, and there never will be. The same comparison
has read anywhere from −15% to +4% across runs of this harness, and a single job flipping direction
moves it double digits. Per job is the honest unit.

**Claude Opus 5**, ordered by how much each job's commands print:

| The job | printed per step | no plugin | hush | change |
| --- | --- | --- | --- | --- |
| Build a notification router while the plan changes four times | 0.6k | $0.813 | **$0.715** | −12% |
| Plan a `--json` flag without editing anything | 0.7k | **$0.163** | $0.165 | +1% |
| Get a build clean again after a dependency bump | 0.9k | $0.289 | **$0.240** | −17% |
| Triage a 57 KB application log | 1.3k | $0.386 | **$0.355** | −8% |
| Fix a red test suite hiding three real failures | 1.5k | **$0.263** | $0.273 | +4% |
| Dig through 300 KB of logs for the cause of an outage | 1.7k | $1.067 | **$0.625** | **−41%** |
| Scope a column rename that matches a thousand lines | 1.7k | $0.485 | **$0.382** | −21% |
| Finish a half-done rename across 76 files | 3.2k | $0.865 | **$0.695** | −20% |
| Find what actually changed for users across 380 commits | 7.8k | $0.868 | **$0.615** | **−29%** |

**Claude Sonnet:**

| The job | printed per step | no plugin | hush | change |
| --- | --- | --- | --- | --- |
| Plan a `--json` flag without editing anything | 0.5k | **$0.067** | $0.072 | +7% |
| Build a notification router while the plan changes four times | 1.0k | **$0.285** | $0.373 | **+31%** |
| Dig through 300 KB of logs for the cause of an outage | 1.4k | $0.242 | **$0.211** | −13% |
| Fix a red test suite hiding three real failures | 1.6k | **$0.116** | $0.124 | +7% |
| Get a build clean again after a dependency bump | 1.7k | **$0.118** | $0.126 | +7% |
| Scope a column rename that matches a thousand lines | 2.5k | $0.129 | **$0.128** | −1% |
| Finish a half-done rename across 76 files | 2.9k | **$0.286** | $0.309 | +8% |
| Find what actually changed for users across 380 commits | 8.1k | $0.392 | **$0.238** | **−39%** |
| Triage a 57 KB application log | 17.6k | $0.250 | **$0.148** | **−41%** |

**The louder the job, the bigger the win**, and the pattern is clearest on Sonnet: every job that
prints more than about 8k characters a step saves a third or more, and the quiet end costs a little.
On Opus, where Claude's own replies are longer, the second cut carries jobs that print almost
nothing — seven of the nine came out cheaper there.

Any one row can swing between runs. Read the direction, not the decimal.

## Prose surface

These comparisons were scored for prose surface only — reading ease, US school grade level,
sentence length, and how many long words a text uses. The formulas look at word and sentence
length, not at whether a reader understood the answer, and these batches were not measured for long
sentences or blocks. For those, see [Reading it](#reading-it).

**Claude Opus 5:**

| setup | words | words per sentence | long words | reading ease | grade level |
| --- | --- | --- | --- | --- | --- |
| no plugin | 406 | 13.5 | 9.9% | 70.0 | 6.8 |
| **hush** | **71** | **6.9** | **4.2%** | **88.7** | **2.6** |

**Claude Sonnet:**

| setup | words | words per sentence | long words | reading ease | grade level |
| --- | --- | --- | --- | --- | --- |
| no plugin | 167 | 16.5 | 11.3% | 61.8 | 8.7 |
| **hush** | **82** | **10.9** | **8.4%** | **73.7** | **5.7** |

Higher reading ease and lower grade level indicate simpler text in these formulas. Hush scores three to four grades lower on these replies. That is a comparison of text features, not proof of comprehension or accessibility for a particular reader.

## Can you act on it without asking?

Short is cheap; useful is the point. So a fresh session gets only the original request and the one
final message — no transcript, no files — and answers three plain questions. What happened. What do
I open or run. What should I do next. A message that carries no answer counts as a miss.

| Claude Opus 5 | no plugin | hush |
| --- | --- | --- |
| what happened | **100%** | 97.2% |
| what to open or run | 100% | **100%** |
| what to do next | 97.2% | **100%** |
| all three | 97.2% | **97.2%** |
| the job's own facts that reach those answers | 88.3% | **90.0%** |

| Claude Sonnet | no plugin | hush |
| --- | --- | --- |
| what happened | 94.4% | **100%** |
| what to open or run | 94.4% | **100%** |
| what to do next | 83.3% | **100%** |
| all three | 83.3% | **100%** |
| the job's own facts that reach those answers | 80.0% | **86.7%** |

On Sonnet hush answers every question in every session, and carries more of each job's real facts
into those answers. On Opus the two tie, with one hush reply out of 36 not spelling out plainly
enough what had happened.

This test is one model reading another's message, so it moves a few points between runs on its own.
Read the direction.

## Naming the file

| notes that name the file to open, with a line number | no plugin | hush |
| --- | --- | --- |
| Claude Opus 5 | **0%** | 89% |
| Claude Sonnet | **0%** | 58% |

Plain Claude Code did not produce a single clickable file link in any of the 54 sessions.

## Where hush loses

Three places, all of them above.

**A quiet job can cost more.** hush's writing rules ride along on every round trip. On a job that
prints little there is nothing to trim against them — the router job on Sonnet cost 31% more, and
four other Sonnet jobs cost 7-8% more. On Opus the effect is smaller: two jobs, at +1% and +4%.

**On Opus the answer test is a tie, not a win.** One hush reply in 36 did not say plainly enough
what had happened.

**The zero-word silence count drops as sessions get longer.** It is a real number and it is on this
page, but it is not a promise. The at-most-one-message count also describes these runs, not a guarantee.

## The harness

The harness that ran these jobs is kept outside this repository and is not distributed with the
plugin. Each table above keeps its run's setup, model and date so the figures can be judged.
