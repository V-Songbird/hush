<div align="center">
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="assets/banner-dark.png" />
    <img src="assets/banner-light.png" alt="hush" width="900" />
  </picture>
  <h1>hush</h1>
  <p><strong>You asked for a change. Read what changed.</strong></p>
</div>

<p align="center"><strong>Available on</strong></p>
<p align="center">
  <img src="assets/edition-codex.svg" alt="Codex" width="80" height="80" />&emsp;&emsp;<a href="https://github.com/V-Songbird/hush/tree/Claude"><img src="assets/edition-claude.svg" alt="Claude" width="80" height="80" /></a><br />
  <del>Codex</del>&emsp;&emsp;&emsp;&emsp;<a href="https://github.com/V-Songbird/hush/tree/Claude">Claude</a>
</p>
<p align="center"><small>Codex is not currently installable.</small></p>

<p align="center"><a href="#get-started"><strong>Get started</strong></a> · <a href="#what-is-this">What is this?</a> · <a href="#how-it-works">How it works</a> · <a href="#what-you-can-do">What you can do</a> · <a href="#evidence-and-benchmarks">Evidence</a></p>





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

## Get started

Choose the assistant you use. Its edition page has the installation steps,
commands and compatibility notes for your setup.

| Your assistant | Status | Next step |
| --- | --- | --- |
| Claude Code | Available | [Install and get started](https://github.com/V-Songbird/hush/tree/Claude) |
| Codex | Not currently installable | [Read the edition status](https://github.com/V-Songbird/hush/tree/Codex) |

## Good to know

Correctness comes before silence. A short answer can still omit something you need, and quieter sessions do not always cost less. Check the result and next action, especially when trying a different voice.

## Evidence and benchmarks

<!-- foundry:hero -->
<p align="center"><img src="assets/hero.svg" alt="Hush original product visualization" width="700"></p>

Original Claude Code benchmark visualization. These measurements describe the recorded Claude sessions, not Codex performance. [Evidence and methodology](https://github.com/V-Songbird/foundry/tree/main/docs/hush).

<details>
<summary>Watch the recorded Claude Code demo</summary>

<p align="center"><img src="assets/demo.svg" alt="Recorded Claude Code demonstration of Hush" width="700"></p>

</details>
<!-- /foundry:hero -->

Measurements belong to the model and setup that produced them. Each edition
keeps its own results, limitations and any measurements still missing:

- [Claude Code results and limitations](https://github.com/V-Songbird/hush/tree/Claude#the-numbers)
- [Codex evidence and measurement status](https://github.com/V-Songbird/hush/tree/Codex#the-numbers)

## Going deeper

[Research and validation](https://github.com/V-Songbird/foundry/tree/main/docs/hush) · [Benchmark instruments and retained evidence](https://github.com/V-Songbird/foundry/tree/main/benchmarks/hush) · [Foundry](https://github.com/V-Songbird/foundry)

## License

MIT — see [LICENSE](LICENSE).
