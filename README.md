<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png" />
    <img src="assets/banner-light.png" alt="hush" width="900" />
  </picture>
  <h1>hush</h1>
  <p><strong>You asked for a change. Read what changed.</strong></p>
</div>

<p align="center"><strong>Available on</strong></p>
<table align="center">
  <tr>
    <td align="center"><img src="assets/edition-codex.svg" alt="Codex (not available)" width="80" height="80" /><br /><del>Codex</del></td>
    <td align="center"><a href="#claude-code"><img src="assets/edition-claude.svg" alt="" width="80" height="80" /><br />Claude Code</a></td>
  </tr>
</table>
<p align="center"><small>Hush has no Codex package.</small></p>

<p align="center"><a href="#install"><strong>Get started</strong></a> · <a href="#what-is-this">What is this?</a> · <a href="#how-it-works">How it works</a> · <a href="#what-you-can-do">What you can do</a> · <a href="#the-numbers">Evidence</a></p>

## What is this?

You ask the assistant to fix a failing test. It reads files, runs commands and explains each step. By the time it finishes, the result is buried in the conversation. Hush reduces that reading.

It quiets routine narration, shortens noisy tool output and shapes the final answer around what changed, whether it worked and what comes next. The example illustrates the workflow; the measurements below describe recorded sessions.

<p align="center"><img src="assets/mascot.svg" alt="Ember quiets the speech bubbles and log pile, then returns to calm typing." width="700"></p>

## Why you'd want it

- Read the result with less play-by-play.
- Keep noisy command output from crowding the conversation.
- Inspect retained full output when you need more detail.
- Choose a writing voice that suits you.

## How it works

A writing style asks the assistant to stay quiet during routine work and finish with a short, useful answer. Session controls reinforce that behavior and trim selected tool results. Large outputs can be stored temporarily, with a reference for closer inspection. You can change the voice while keeping the session controls.

## What you can do

| You want to | Outcome |
| --- | --- |
| Keep the default voice | Short, plain answers focused on the result |
| Choose another voice | A different tone with the session controls retained |
| Describe a new voice | A custom style checked against Hush’s requirements |
| Inspect shortened output | A reference to the retained full result where available |

Use `/hush:pick-style` to choose a voice and `/hush:craft-style` to describe a new one. See the settings guide for disabling the session controls.

## Install

Hush runs in Claude Code. It is not available for Codex.

### Claude Code

Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Start a new session to load the plugin. Hush's voice applies on its own. The published numbers also
set `"outputStyle": "hush:Hush"` in `~/.claude/settings.json`, which adds Claude Code's per-turn
reminder that the style is active; see [Settings](docs/knowledge/settings.md#the-output-style-setting).

Requirements: Claude Code 2.1.139 or later, and Node.js 22 or later.

## Good to know

Correctness comes before silence. A short answer can omit a useful detail, and quieter sessions do not always cost less. Ask for depth when you need it, and check the result before acting.

Full-output references point to temporary files. Disabling runtime controls and restoring the writing style are separate actions. See [Settings](docs/knowledge/settings.md) for switches, and [How hush works](docs/knowledge/how-it-works.md#where-the-parked-output-goes) for how long those files are kept and who can read them on each platform.

## The numbers

The comparison asks whether jobs were completed correctly, how often the assistant spoke at most once before the answer, how long its final answers were and what a session cost. These observations do not guarantee the same behavior in your sessions.

### Claude Code results

<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5.5"],"source":"docs/knowledge/benchmarks.md","date":"2026-09-28","reviewedAt":"2026-09-28"} -->
| Model | Setup | Jobs right | Spoke at most once before the answer | Median final prose words | Average bill per session |
| --- | --- | --- | --- | --- | --- |
| Claude Opus 5.5 | No plugin | 36/36 | 28/36 | 369 | $0.421 |
| Claude Opus 5.5 | hush | 36/36 | 36/36 | 271 | $0.458 |

Both setups passed all 36 task checks. Hush spoke at most once before the answer in every session, and said nothing at all before it in 34 of 36. Without a plugin, Opus 5.5 already spoke at most once in 28 of 36 sessions.

Hush's median final prose was 271 words against 369 without a plugin, about 27% shorter. Its sentences were shorter too: 0.5% ran past 20 words, against 10.9% without a plugin. Runnable content appeared in all 36 answers of both setups; that text heuristic does not check that a command is correct or complete.

**On Opus 5.5, hush costs more.** The average bill per session was 9% higher. Seven of the nine jobs cost more, by 4% to 32%, and four of those are above about 16%, the largest gap that batch showed between two near-identical setups. Only the two jobs whose commands print the most came out cheaper, by 19% and 4%. Opus 5.5 already writes less without a plugin, so hush has less to cut. See [cost and runnable content on Opus 5.5](docs/knowledge/benchmarks.md#cost-and-runnable-content-on-opus-55).

Batch `o55-451-495ce18f`: nine fixture jobs, four runs per setup, in Claude Code with Claude Opus 5.5 (model id `claude-opus-5-5`) at the default effort, September 28, 2026. Measurements used the voice released in [1.13.0](docs/knowledge/changelog.md#1130--2026-09-28) and `HUSH_WRAP=1`. The voice now also caps each block of the final answer at 40 words, and these figures do not measure that rule. A block is the text between two blank lines. The rule was tested in a separate batch; see [capping blocks at 40 words](docs/knowledge/benchmarks.md#capping-blocks-at-40-words). Word counts exclude fenced code. These measurements describe the recorded Claude sessions, not Codex performance. The earlier voices, measured on Opus 5 and Sonnet, are in [the benchmark details](docs/knowledge/benchmarks.md); the records and definitions behind them are kept outside this repository.

*Results can vary between runs.*

## Going deeper

[How it works](docs/knowledge/how-it-works.md) · [Settings](docs/knowledge/settings.md) · [Benchmark details](docs/knowledge/benchmarks.md) · [Changelog](docs/knowledge/changelog.md)

[Foundry](https://github.com/V-Songbird/foundry) lists this plugin. The research records and the benchmark harness are kept outside this repository and are not distributed with the plugin.

## License

MIT — see [LICENSE](LICENSE).
