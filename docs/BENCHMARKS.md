# The numbers, in full

Wins and losses. The front page carries the headline; this page carries everything, including the
rows where hush comes out behind.

← [Back to the README](../README.md)

---

## What a test session is

Eight jobs, each in its own throwaway folder. Real Claude Code sessions from start to finish — it
reads files, edits code, runs commands. Never a single canned reply.

The jobs are deliberately spread across the range of how much a session prints: a notification
router where the plan changes four times, a dependency bump that breaks a build, a 57 KB
application log, a 300 KB outage, a red test suite, a column rename across a thousand lines, a
half-done rename across 76 files, and 380 commits to turn into release notes.

Every job ends with a check. The code gets run, or the answer gets matched against that job's own
checklist. **A short answer that breaks the job counts as a failure, not a win.**

Every price is the real bill, read back from the API.

The run below is Claude Opus 5 at its recommended medium effort, four runs each way, plus the same
eight jobs twice each way on Claude Sonnet. Failing-command trimming was on (`HUSH_WRAP=1`).

## Does it still work?

| setup | jobs right, Opus 5 | jobs right, Sonnet |
| --- | --- | --- |
| no plugin | 32 / 32 | 16 / 16 |
| **hush** | **32 / 32** | **16 / 16** |

Nothing on this page was bought with a wrong answer.

## How quiet

Every model opens a turn with a line about what it is about to do. No wording removes that for
good, so the claim worth making is not *never speaks* — it is *speaks once, then nothing*.

| Claude Opus 5, 32 sessions each | no plugin | hush |
| --- | --- | --- |
| spoke at most once before the answer | 9 | **32** |
| said nothing at all | 0 | **17** |
| worst single session | **7 separate messages** | **1** |
| total mid-work messages | 80 | **15** |
| words of play-by-play, per session | 31.7 | **3.1** |

| Claude Sonnet, 16 sessions each | no plugin | hush |
| --- | --- | --- |
| spoke at most once before the answer | 7 | **14** |
| said nothing at all | 3 | **11** |
| worst single session | 6 messages | 4 |
| words of play-by-play, per session | 51.8 | **7.2** |

The zero-word count is the softer of the two. It slides with how long a session runs — on Opus it
is 75% of sessions in the 11-to-15-command band and 0% past 26 commands, on the same build. The
at-most-once count does not move with length.

## How much it cuts

Averaged per session over the eight jobs, Opus 5:

| | no plugin | hush | |
| --- | --- | --- | --- |
| what your commands print | 21.9k chars | **19.8k chars** | −9% |
| play-by-play while working | 32 words | **3 words** | −90% |
| everything Claude writes in a session | 8,006 tok | **5,138 tok** | −36% |

On Opus the second cut is the big one. hush's writing rules cost a little on every round trip and
earn it back by keeping Claude's own output short.

## The bill, job by job

There is no suite-wide cost percentage on this page, and there never will be. The same comparison
has read anywhere from −15% to +4% across runs of this harness, and a single job flipping direction
moves it double digits. Per job is the honest unit.

**Claude Opus 5**, ordered by how much each job's commands print:

| The job | printed per step | no plugin | hush | change |
| --- | --- | --- | --- | --- |
| Build a notification router while the plan changes four times | 0.6k | $0.708 | **$0.687** | −3% |
| Get a build clean again after a dependency bump | 0.9k | $0.267 | **$0.263** | −2% |
| Fix a red test suite hiding three real failures | 1.2k | $0.273 | **$0.254** | −7% |
| Triage a 57 KB application log | 1.4k | $0.399 | **$0.385** | −3% |
| Dig through 300 KB of logs for the cause of an outage | 1.5k | $1.127 | **$0.608** | **−46%** |
| Scope a column rename that matches a thousand lines | 2.0k | $0.534 | **$0.453** | −15% |
| Finish a half-done rename across 76 files | 3.3k | **$0.655** | $0.813 | **+24%** |
| Find what actually changed for users across 380 commits | 5.3k | $0.777 | **$0.552** | **−29%** |

**Claude Sonnet:**

| The job | printed per step | no plugin | hush | change |
| --- | --- | --- | --- | --- |
| Build a notification router while the plan changes four times | 1.3k | **$0.277** | $0.332 | +20% |
| Fix a red test suite hiding three real failures | 1.9k | **$0.114** | $0.119 | +5% |
| Scope a column rename that matches a thousand lines | 2.3k | $0.125 | **$0.110** | −12% |
| Finish a half-done rename across 76 files | 2.5k | $0.292 | **$0.293** | 0% |
| Get a build clean again after a dependency bump | 2.8k | $0.150 | **$0.112** | −25% |
| Dig through 300 KB of logs for the cause of an outage | 3.0k | $0.328 | **$0.198** | **−40%** |
| Find what actually changed for users across 380 commits | 9.0k | $0.382 | **$0.246** | **−36%** |
| Triage a 57 KB application log | 16.0k | $0.224 | **$0.191** | −15% |

**The louder the job, the bigger the win.** The quiet end is where it can go the other way: the
router job on Sonnet cost 20% more, and the 76-file rename on Opus cost 24% more. Both are jobs
that search a lot and print little, so there is not much for hush to trim, and its writing rules
still ride along on every step.

Any one row can swing between runs. Read the direction, not the decimal.

## Reading it

Saving money is half of it. The other half is whether you can read the answer. These measures have
been around for decades — reading ease, US school grade level, sentence length, and how many long
words a text uses.

**Claude Opus 5:**

| setup | words | words per sentence | long words | reading ease | grade level |
| --- | --- | --- | --- | --- | --- |
| no plugin | 420 | 13.6 | 10.2% | 69.0 | 7.0 |
| **hush** | **68** | **6.4** | **5.0%** | **87.6** | **2.6** |

**Claude Sonnet:**

| setup | words | words per sentence | long words | reading ease | grade level |
| --- | --- | --- | --- | --- | --- |
| no plugin | 141 | 18.2 | 12.4% | 56.8 | 9.9 |
| **hush** | **74** | **10.3** | **7.7%** | **77.0** | **5.1** |

Higher reading ease is easier. Lower grade level is easier. hush is four school grades easier than
plain Claude Code on both models, in a sixth of the words on Opus.

## Can you act on it without asking?

Short is cheap; useful is the point. So a fresh session gets only the original request and the one
final message — no transcript, no files — and answers three plain questions. What happened. What do
I open or run. What should I do next. A message that carries no answer counts as a miss.

| Claude Opus 5 | no plugin | hush |
| --- | --- | --- |
| what happened | 100% | **100%** |
| what to open or run | 100% | **100%** |
| what to do next | 100% | **100%** |
| all three | 100% | **100%** |
| the job's own facts that reach those answers | 91.7% | **95.8%** |

| Claude Sonnet | no plugin | hush |
| --- | --- | --- |
| what happened | 93.8% | **100%** |
| what to open or run | 87.5% | **100%** |
| what to do next | 81.3% | **93.8%** |
| all three | 81.3% | **93.8%** |
| the job's own facts that reach those answers | **83.3%** | 79.2% |

On Opus both setups now answer everything, and more of each job's real facts survive into hush's
answers. On Sonnet hush wins every question and **loses the last row** — its answers are more
complete as answers, and carry slightly fewer of the checklist facts. That is the compression
showing.

This test is one model reading another's message, so it moves a few points between runs on its own.
Read the direction.

## Naming the file

| notes that name the file to open, with a line number | no plugin | hush |
| --- | --- | --- |
| Claude Opus 5 | **0%** | 91% |
| Claude Sonnet | **0%** | 69% |

Plain Claude Code did not produce a single clickable file link in any of the 48 sessions.

## Where hush loses

Three places, and they are all on this page above.

**A quiet, search-heavy job can cost more.** hush's writing rules are carried on every round trip.
On a job that searches a lot and prints little there is nothing to trim against that, and the bill
goes up — 24% on the 76-file rename on Opus, 20% on the router job on Sonnet.

**On Sonnet, slightly fewer of a job's checklist facts survive into the answers** — 79.2% against
83.3%. Its answers are more complete; some of the supporting detail is gone.

**The zero-word silence count drops as sessions get longer.** It is a real number and it is on this
page, but it is not a promise. The at-most-one-message count is.

## Run it yourself

The whole harness is public, in the marketplace repo under
[`benchmarks/hush`](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush). Same jobs,
same checks, your own API key.
