<!-- foundry:edition Codex -->
<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png" />
    <img src="assets/banner-light.png" alt="hush" width="900" />
  </picture>
  <h1>hush</h1>
  <p><strong>You asked for a change. Read what changed.</strong></p>
</div>

<!-- foundry:platform identity -->
**Edition: Codex.** In development; not available to install.
<!-- /foundry:platform identity -->

[Install](#install) · [Using Hush](#what-you-can-do) · [Evidence](#the-numbers) · [Limits](#good-to-know)

## What is this?

A coding assistant can finish the job and still leave you with a lot to read. Hush reduces that reading: less narration during the work, shorter command output, and a final answer focused on the result.

For a task such as fixing a failing test, the useful answer tells you what was fixed, whether the check passed and anything you still need to do. That is the kind of answer Hush aims for. This is an illustration of the goal, not a recorded result.

<p align="center"><img src="assets/mascot.svg" alt="Ember quiets the speech bubbles and log pile, then returns to calm typing." width="700"></p>

## Why you'd want it

The point is to make the work easier to follow. Routine narration gets less space; the outcome, relevant detail and next action should remain. When shortened output is not enough, its reference gives you a way to inspect the full result where supported.

## How it works

There are two layers. Session controls reduce narration and tool-output noise. A writing style shapes the answer you read at the end. You can change the voice without changing the quiet-session controls.

## What you can do

- **Keep the default voice** for short, plain answers.
- **Choose another voice** when you want a different tone.
- **Describe a new voice** when the available styles do not fit.
- **Inspect the full output** when a shortened command result needs closer reading.

<!-- foundry:platform commands -->
No native Codex commands or skills are available yet.
<!-- /foundry:platform commands -->

## Install

<!-- foundry:platform install -->
Hush for Codex is in development. This branch has no installable plugin package yet. Installation instructions will be added with a supported package.
<!-- /foundry:platform install -->

## Good to know

Correctness comes before silence. A short answer can still omit something you need, and quieter sessions do not always cost less. Check the result and next action, especially when trying a different voice.

<!-- foundry:platform compatibility -->
The shared description states the product’s purpose. It does not establish that these behaviors exist in the unfinished Codex edition.
<!-- /foundry:platform compatibility -->

## The numbers

The comparison asks whether jobs were completed correctly, how often the assistant gave at most one update, and how long its final answers were. These observations do not guarantee the same behavior in your sessions.

<!-- foundry:platform benchmarks -->
<!-- foundry:evidence {"platform":"Codex","status":"pending","reason":"No installable Codex edition or paired benchmark yet."} -->
| Model | Setup | Jobs right | At most one update | Final words |
| --- | --- | --- | --- | --- |
| Not measured | Without plugin | Not measured | Not measured | Not measured |
| Not measured | hush | Not measured | Not measured | Not measured |

No Codex performance claim is available while the package is in development.
<!-- /foundry:platform benchmarks -->

<!-- foundry:hero -->
<p align="center"><img src="assets/hero.svg" alt="Hush original product visualization" width="700"></p>

Original Claude Code benchmark visualization. These measurements describe the recorded Claude sessions, not Codex performance. [Evidence and methodology](https://github.com/V-Songbird/foundry/tree/main/docs/hush).

<details>
<summary>Watch the recorded Claude Code demo</summary>

<p align="center"><img src="assets/demo.svg" alt="Recorded Claude Code demonstration of Hush" width="700"></p>

</details>
<!-- /foundry:hero -->

*Results can vary between runs.*

## Going deeper

<!-- foundry:platform links -->
[Project overview](https://github.com/V-Songbird/hush/tree/main)
<!-- /foundry:platform links -->

[Foundry](https://github.com/V-Songbird/foundry) holds the research, methodology and detailed evidence.

## License

MIT — see [LICENSE](LICENSE).
