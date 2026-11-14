# Ported Mermaid renderer

The files in this folder come from [skins](https://github.com/hellosverre/claude-skins) 0.5.16,
commit cf0d39f, under the MIT licence in `LICENSE-skins` (Copyright (c) 2026 hellosverre).

Copied unchanged: `mermaid*.ts`, `svg-chart*.ts`, `svg-kit.ts`, `markdown.ts`, except three
lines, all for contrast on the desktop's light page. In `svg-chart.ts`, `SHAPE_SLOT` draws every
flowchart shape in the neutral `muted` colour and a node's outline is drawn at opacity .85, not
.6. In `svg-kit.ts`, the card outline is drawn at opacity .2, not .16: the app's own
`border-strong` token. Later changes carry the reader's language into every drawn word
(`ChartWords`), and draw neutral ink with the app's own text colour: the card's group sets
`fill="currentColor"` in place of a sheet rule on `text`, and muted text, lines and
arrowheads take `currentColor` at the `MUTED` and `MUTED_LINE` opacities in `svg-kit.ts`,
as attributes, in place of a copied grey.
Replaced with small stand-ins: `skin.ts` (colour names only) and `chart-art.ts` (the three
Gantt helpers `svg-chart-plan.ts` reads, without the terminal cell art).

## Dropping the renderer

The desktop app has its own Mermaid component behind a flag. If it ships, this renderer can go
without touching the alerts or the fold. Remove:

- every file here except `markdown.ts`, whose `hardBreaks` the prose and alerts use, and
  `LICENSE-skins`, which stays beside `markdown.ts`;
- `../mermaid.test.ts`;
- the `chart` part in `../reply.ts` and its branch in `../register.tsx`;
- `LIGHT`, `DARK`, `themedChart` and the `chart` entries of `EN` and `ES` in `../register.tsx`;
- the chart colours in `../../mod-colors.allow.json`;
- the Mermaid paragraph and widget rows of `../../output-styles/hush.md`, and the word
  `mermaid` in `DESKTOP_SECTION` (`../voice.ts`).
