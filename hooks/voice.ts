import type { PromptComposeInput } from 'claude-code'

// Tells Claude that this session draws the forms the voice keeps for the mod. The rule itself
// lives in `output-styles/hush.md` ("Forms the desktop mod draws"): it holds only where this
// section appears, so a session whose mod is absent, refused, switched off or drawing for
// another surface keeps the voice's ban. The output style is not a `prompt.compose` section,
// so the voice cannot be rewritten in place; this marker carries no rule of its own.
export const DESKTOP_HEADING = '# Forms this desktop session draws'

export const DESKTOP_SECTION = [
  DESKTOP_HEADING,
  'In this session, Hush’s mod draws fenced `mermaid` blocks and GitHub alerts. Follow the voice’s rules for those forms, in its part "Forms the desktop mod draws".',
].join('\n\n')

// The /hush:config `markdown` setting's values, default first: a copy of
// `hooks/style-settings.js` KNOBS.markdown, since a hooks module cannot require CommonJS;
// tests/desktop_mod.test.js keeps the two equal.
const MARKDOWN = ['rich', 'basic', 'plain'] as const

export type Markdown = (typeof MARKDOWN)[number]

/** The saved `markdown` setting, or its default when the file holds none this version knows. */
export function markdownOf(saved: unknown): Markdown {
  const value = typeof saved === 'object' && saved !== null ? (saved as Record<string, unknown>).markdown : undefined

  return (MARKDOWN as readonly unknown[]).includes(value) ? (value as Markdown) : MARKDOWN[0]
}

// The desktop alone draws these forms: a terminal beside it, or a run that draws nothing
// (an empty list, as under -p), keeps the ban. The desktop app's sessions carry `print`
// (probe, 2026-11-02), so only `bare` and `analysis` mean nothing is shown. The reader's
// /hush:config Markdown setting wins: only `rich` takes these forms.
export function teachesDesktop(e: Pick<PromptComposeInput, 'surfaces' | 'traits' | 'outputStyle'>, markdown: Markdown): boolean {
  const isHush = e.outputStyle !== null && /^hush(:|$)/i.test(e.outputStyle.name)
  const isDesktopOnly = e.surfaces.length > 0 && e.surfaces.every(s => s === 'desktop')
  const draws = !e.traits.includes('bare') && !e.traits.includes('analysis')

  return isHush && isDesktopOnly && draws && markdown === 'rich'
}
