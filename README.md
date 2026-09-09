<!-- foundry:edition Claude -->
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/logo-dark.svg" />
    <img src="assets/logo.svg" alt="hush" width="240" />
  </picture>
  <h1>hush</h1>
  <p><strong>Less narration while work happens. A short, useful answer when it is done.</strong></p>
</div>

<!-- foundry:platform identity -->
**Edition: Claude Code.** Use this edition’s installation and compatibility notes below.
<!-- /foundry:platform identity -->

[**Install**](#install) · [What is this?](#what-is-this) · [What you can do](#what-you-can-do) · [The numbers](#the-numbers) · [Going deeper](#going-deeper)

> **TL;DR** — Less narration while work happens. A short, useful answer when it is done.

<p align="center"><img src="assets/mascot.svg" alt="Ember quiets the speech bubbles and log pile, then returns to calm typing." width="700"></p>

## What is this?

hush is designed to reduce running commentary and long tool-output dumps. The aim is a clear final answer with the result and the file or command you need next. Check the edition status above for availability.

## Why you'd want it

- Read the result without scrolling through a running monologue.
- Keep important details accessible when output is shortened.
- Choose a writing voice that fits how you work.

## How it works

The product combines quieter narration, a chosen writing style and reduced tool-output noise. The integration and availability of those controls are documented for each edition below.

## Install

<!-- foundry:platform install -->
Inside Claude Code:

```text
/plugin marketplace add V-Songbird/foundry
/plugin install hush@foundry
```

Start a new session to load the plugin.
<!-- /foundry:platform install -->

## What you can do

| You want to | Outcome |
| --- | --- |
| Keep work quiet | Limit running commentary before the final answer |
| Change the writing voice | Choose or describe the style you want |
| Inspect shortened output | Follow the reference to the complete output when the edition provides it |

<!-- foundry:platform commands -->
Use `/hush:pick-style` to choose a voice and `/hush:craft-style` to describe a new one. See the settings guide for disabling the session controls.
<!-- /foundry:platform commands -->

## The numbers

Each result belongs to the named model and recorded run. Missing measurements remain marked as unmeasured.

<!-- foundry:platform benchmarks -->
<!-- foundry:evidence {"platform":"Claude","status":"measured","models":["Claude Opus 5"],"source":"docs/hush/validation/claude-readme-benchmark-source-2026-09-08.md","date":"unknown","revision":"13c24a9bd610a39740eb2816b54cc16b090978ed","dateReason":"The retained source excerpt does not state a run date.","reviewedAt":"2026-09-08"} -->
| Model | Setup | Jobs right | At most one update | Final words |
| --- | --- | --- | --- | --- |
| Claude Opus 5 | No plugin | 36/36 | 14/36 | 367 |
| Claude Opus 5 | caveman | 36/36 | 31/36 | 151 |
| Claude Opus 5 | hush | 36/36 | 36/36 | 69 |

The final answer was shorter, but the next runnable action was retained in 94% of hush sessions versus 100% for the other setups. Three quiet jobs cost 1–10% more. These results describe the recorded Claude run.
<!-- /foundry:platform benchmarks -->

*Results can vary between runs.*

## Going deeper

<!-- foundry:platform links -->
[How it works](docs/HOW-IT-WORKS.md) · [Settings](docs/SETTINGS.md) · [Benchmark details](docs/BENCHMARKS.md)
<!-- /foundry:platform links -->

[Foundry](https://github.com/V-Songbird/foundry) holds the research, methodology and detailed evidence for this plugin.

## Good to know

A shorter answer is useful only when it preserves the result and the next action. Correctness comes before silence. Model behavior can vary between runs.

<!-- foundry:platform compatibility -->
Full-output references point to temporary files. Disabling runtime controls and restoring the writing style are separate actions. See [Settings](docs/SETTINGS.md) for switches and platform-specific retention behavior.
<!-- /foundry:platform compatibility -->

## License

MIT — see [LICENSE](LICENSE).
