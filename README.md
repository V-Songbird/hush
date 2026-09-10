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

## Get started

Choose the assistant you use. Its edition page has the installation steps,
commands and compatibility notes for your setup.

| Your assistant | Status | Next step |
| --- | --- | --- |
| Claude Code | Available | [Install and get started](https://github.com/V-Songbird/hush/tree/Claude) |
| Codex | Not currently installable | [Read the edition status](https://github.com/V-Songbird/hush/tree/Codex) |

## Good to know

Correctness comes before silence. A short answer can omit a useful detail, and quieter sessions do not always cost less. Ask for depth when you need it, and check the result before acting.

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
