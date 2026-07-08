<div align="center">
  <img src="assets/logo.svg" alt="hush" width="240" />
  <h1>hush</h1>
  <p><strong>Makes Claude quieter and your sessions cheaper — less narration, less noise, one clear answer at the end.</strong></p>
</div>

---

## What is this?

You know the pattern: "Let me start by looking at…", "Now I'll check…", a 400-line wall of build output, and finally the one thing you actually wanted to know. All of it costs money — every word in a session is billed — and buries the useful part.

hush trims it at the source. Claude works quietly, tidies up noisy command output and bulky log files before they pile up, and gives you **one clear answer at the end**. Code, error messages, and anything you ask it to explain stay complete — hush never shortens the parts that matter.

## Why you'd want it

- **Cheaper sessions.** It shrinks the two biggest sources of bulk — noisy output and narration — so long sessions cost less.
- **Easier to read.** The answer sits at the top of one final message, not buried in a play-by-play.
- **Nothing important is lost.** Failing command output, code, diffs, and security warnings are kept whole.
- **Zero setup.** Install it and it's on. Tune it later only if you want to.

## Install

Inside Claude Code, run:

```
/plugin marketplace add V-Songbird/claude-plugins
/plugin install hush
```

The quiet style takes effect at your next session. There's nothing to invoke — hush just works in the background.

## Benchmarks

We put hush up against plain Claude Code and the popular "just be brief" plugin — the same real coding jobs, phrased the way a developer actually types them, three setups, and the real bill read straight from the API.

<p align="center"><img src="assets/bench-chatter.svg" alt="Words of play-by-play while fixing a real bug: no plugin 108 words, the brief plugin 46, hush 23" width="540"></p>

**Claude stops narrating and just works.** On real fix-the-bug jobs, plain Claude says about a hundred words of play-by-play before you get the answer. hush cuts that to a fifth — half of what the brief plugin manages — and puts everything that matters in one clean final message.

**Answers get about 16% shorter without turning into broken grammar.** The brief plugin trims the same amount by mangling everything it says. hush matches the trim while keeping normal English, exact error messages, and untouched code.

<p align="center"><img src="assets/bench-logs.svg" alt="Digging a root cause out of a huge log: hush is 13% cheaper than no plugin" width="540"></p>

**Noise gets cheaper.** When the job involves a bulky log or a chatty build, hush trims the noise before it lands on your bill — 13% cheaper on our log-digging job, with every warning and error line kept verbatim.

And the part that matters most: **nothing broke.** Every job came out correct in every setup — including one the no-plugin run fumbled.

*One honest note on cost:* on short everyday tasks, no plugin of this kind makes sessions much cheaper — a session's fixed overhead dwarfs what any of them can trim, the brief plugin included. hush's everyday win is what you *read*, not what you pay; the savings show up where noise dominates.

*How we tested: same jobs, three setups, several runs each in fresh throwaway workspaces, on the smaller, cheaper model; costs from the API, not estimates. Reproduce it yourself — see [benchmarks/](benchmarks/).*

## Compress a memory file (optional)

`/hush:hush-compress <path>` shrinks a `CLAUDE.md` or notes file into a tighter form, so every future session that loads it costs a little less. It **never touches your original** — it writes a copy alongside it (`CLAUDE.md` → `CLAUDE.hush.md`) for you to review and swap in yourself.

## Under the hood

If you're curious, hush just works quietly in the background — nothing is re-sent every turn to run up your bill — and it's all there to read in the plugin's files. Pairs naturally with [razor](../razor): razor cuts the code and the cost, hush cuts the noise — and measured together, they add no overhead to each other.

## Settings

Most people never touch these, but a few environment variables tune the caps or turn parts off:

| Variable | What it does |
| --- | --- |
| `HUSH_DISABLE=1` | Turns the hooks off |
| `HUSH_CAP_PASS=60` | Lines kept from successful command output |
| `HUSH_CAP_FAIL=250` | Lines kept from failing output |
| `HUSH_NARRATION_BUDGET=120` | Words of narration before a gentle nudge |

## License

MIT — see [LICENSE](./LICENSE).
