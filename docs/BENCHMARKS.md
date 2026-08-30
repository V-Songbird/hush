# The numbers, in full

Wins and losses. The front page carries the headline; this page carries everything, including the
rows where hush comes out behind.

← [Back to the README](../README.md)

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

Below: Claude Opus 5 at its recommended medium effort, four runs each way, plus the same nine jobs
twice each way on Claude Sonnet. Failing-command trimming was on (`HUSH_WRAP=1`).

## Does it still work?

| setup | jobs right, Opus 5 | jobs right, Sonnet |
| --- | --- | --- |
| no plugin | 36 / 36 | 18 / 18 |
| **hush** | **36 / 36** | **18 / 18** |

Nothing on this page was bought with a wrong answer.

## How quiet

Every model opens a turn with a line about what it is about to do. No wording removes that for
good, so the claim worth making is not *never speaks* — it is *speaks once, then nothing*.

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
build it reads near 100% on short jobs and drops away on the longest ones. The at-most-once count
does not move with length.

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

## Reading it

Saving money is half of it. The other half is whether you can read the answer. These measures have
been around for decades — reading ease, US school grade level, sentence length, and how many long
words a text uses.

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

Higher reading ease is easier. Lower grade level is easier. hush is three to four school grades
easier than plain Claude Code on both models, in a sixth of the words on Opus.

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
page, but it is not a promise. The at-most-one-message count is.

## Run it yourself

The whole harness is public, in the marketplace repo under
[`benchmarks/hush`](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush). Same jobs,
same checks, your own API key.
