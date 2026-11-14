import { expect, test } from 'claude-code/testing'

import { EMPTY, lintMessage, localLinks, report, settingsOf, tally, upgrade, usesForms } from './lint'
import { EN, ES } from './register'

const GOOD = [
  '**The login test passes again.**',
  '',
  '---',
  '',
  '`verifyToken` read the expiry as text. So every token looked expired.',
  '',
  '```js',
  'const a = "a very long line of code that would break every sentence rule if it were prose, and it is not"',
  '```',
  '',
  '| Check | Result |',
  '|---|---|',
  '| `npm test` | 212 of 212, a cell that is a table row and not a sentence of prose at all |',
  '',
  '---',
  '',
  '**Next:** open [auth.js:58](src/auth.js:58) and read the change.',
].join('\n')

test('a message in the voice’s shape passes every rule', () => {
  const lint = lintMessage(GOOD)

  expect(lint.failed).toEqual([])
  // The Next line: "**Next:** open auth.js:58 and read the change."
  expect(lint.longestSentence).toBe(7)
})

test('a long sentence, a missing rule and a footnote at the end each fail their rule', () => {
  const text = [
    '**Done.**',
    'This sentence keeps going on and on well past the twelve words the voice allows here.',
    '',
    '[^1]: A note.',
  ].join('\n')

  expect(lintMessage(text).failed).toEqual(['rules where set', 'next step where set', 'sentences within limit'])
})

test('each rule follows the reader’s /hush:config settings', () => {
  const long = 'This sentence runs to fifteen words, which twenty allows and twelve does not allow.'
  const top = ['**Done.**', '', '**Siguiente paso:** run it.', '', '---', '', long, '', '[^1]: A note.', '', '&nbsp;'].join('\n')

  expect(lintMessage(top, settingsOf({ next: 'top', sentences: '20' })).failed).toEqual([])
  expect(lintMessage(top).failed).toContain('next step where set')

  const bare = ['**Done.**', '', long].join('\n')
  expect(lintMessage(bare, settingsOf({ next: 'off', rules: 'off', sentences: '20' })).failed).toEqual([])
  // markdown=plain has no rules, whatever the rules knob says, and forbids <kbd>.
  expect(lintMessage(`${bare}\n\nPress <kbd>Ctrl</kbd>.`, settingsOf({ next: 'off', markdown: 'plain', sentences: '20' })).failed).toEqual(['no raw html'])
  // An unknown value is the default, as in Hush's own loader.
  expect(settingsOf({ next: 'sideways', detail: 'short' })).toEqual({ next: 'end', rules: 'on', detail: 'short', markdown: 'rich', sentences: '12' })
})

test('only kbd is allowed as html, and code does not count', () => {
  expect(lintMessage('Press <kbd>Ctrl</kbd> and `<details>`.').failed).not.toContain('no raw html')
  expect(lintMessage('Open <details>here</details>.').failed).toContain('no raw html')
})

test('an alert’s words stay off the word count, but its sentences are still checked', () => {
  const words = Array.from({ length: 30 }, () => 'Risk words here.').join(' ')
  const text = ['**Done.**', '', '---', '', 'One fact.', '', `> [!WARNING]\n> ${words}`, '', '---', '', '**Next:** read it.'].join('\n')
  const lint = lintMessage(text, settingsOf({ detail: 'short' }))

  expect(lint.words).toBe(6)
  expect(lint.failed).toEqual(['blocks within limit'])
  // Only WARNING and CAUTION carry risks and blockers; a NOTE counts like prose.
  expect(lintMessage(text.replace('WARNING', 'NOTE'), settingsOf({ detail: 'short' })).words).toBe(96)
  expect(usesForms(text)).toEqual({ mermaid: false, alert: true })
})

// A message in the desktop shape: a blocker under the first rule, prose, risks as the last block.
const shaped = (caution: string, between: string, warning: string) =>
  ['**Blocked.**', '', '---', '', caution, '', between, '', warning, '', '---', '', '**Next:** read it.'].filter((line, i, all) => line !== '' || all[i - 1] !== '').join('\n')
const CAUTION = '> [!CAUTION]\n> The deploy key is missing.'
const WARNING = '> [!WARNING]\n> I did not run the suite.'
const ALERT_RULES = ['alerts within limit', 'alerts apart', 'alert types allowed', 'alerts hold a risk (proxy)']
const alertFailures = (text: string, allowed?: readonly ('note' | 'tip' | 'important' | 'warning' | 'caution')[]) =>
  lintMessage(text, settingsOf(undefined), 0, allowed).failed.filter(rule => ALERT_RULES.includes(rule))

test('one caution and one warning, apart and holding risks, pass every alert rule', () => {
  expect(alertFailures(shaped(CAUTION, 'One fact.', WARNING))).toEqual([])
})

test('a third alert, or two of one type, fail the limit', () => {
  expect(alertFailures(shaped(CAUTION, `One fact.\n\n${WARNING}\n\nMore.`, WARNING))).toEqual(['alerts within limit'])
  expect(alertFailures(shaped(WARNING, 'One fact.', WARNING))).toEqual(['alerts within limit'])
})

test('two alerts with only a blank line between fail as side by side', () => {
  expect(alertFailures(shaped(CAUTION, '', WARNING))).toEqual(['alerts apart'])
})

test('a type the section did not allow fails, and without the section none is allowed', () => {
  expect(alertFailures(shaped('> [!TIP]\n> A faster way.', 'One fact.', WARNING))).toEqual(['alert types allowed'])
  expect(alertFailures(shaped(CAUTION, 'One fact.', WARNING), [])).toEqual(['alert types allowed'])
})

test('an empty alert, or one holding the next step, holds no risk', () => {
  expect(alertFailures(shaped('> [!CAUTION]', 'One fact.', WARNING))).toEqual(['alerts hold a risk (proxy)'])
  expect(alertFailures(shaped(CAUTION, 'One fact.', '> [!TIP]\n> **Next:** read it.'), ['warning', 'caution', 'tip'])).toEqual(['alerts hold a risk (proxy)'])
})

test('an alert inside a code fence is no alert', () => {
  expect(alertFailures(shaped(CAUTION, '```md\n> [!TIP]\n> x\n```', WARNING))).toEqual([])
})

test('a next step that points back by place is flagged; one that names the thing passes', () => {
  const back = GOOD.replace('open [auth.js:58](src/auth.js:58) and read the change.', 'look at section C of my previous message.')
  const named = GOOD.replace('open [auth.js:58](src/auth.js:58) and read the change.', 'look at the Warning alert about the cache copy.')

  expect(lintMessage(back).failed).toEqual(['next stands alone (proxy)'])
  expect(lintMessage(back.replace('**Next:**', '**Siguiente paso:**').replace('section C of my previous message', 'la sección C del mensaje anterior')).failed).toEqual(['next stands alone (proxy)'])
  expect(lintMessage(named).failed).toEqual([])
  // Only the next-step line counts: the same words in the body are no pointer to act on.
  expect(lintMessage(GOOD.replace('read the expiry as text.', 'read the expiry, as my previous message said.')).failed).toEqual([])
})

test('local links lose their line and skip web pages and anchors', () => {
  const text = 'See [a](src/a.js:12), [b](docs/b%20c.md), [w](https://x.dev/a), [t](#terminal/1).'

  expect(localLinks(text)).toEqual(['src/a.js', 'docs/b c.md'])
  expect(lintMessage(text, settingsOf(undefined), 1).failed).toContain('links resolve')
})

test('a tally from an earlier version keeps its counts under the new names', () => {
  const old = { messages: 2, failures: { 'sentences ≤ 12 words': 1, 'sentences within limit': 1 }, words: 0, outputTokens: 0, recent: [{ at: 't', words: 0, tokens: 0, failed: ['sentences ≤ 12 words'] }] }
  const t = upgrade(old as never)

  expect(t.failures).toEqual({ 'sentences within limit': 2 })
  expect(t.recent[0]?.failed).toEqual(['sentences within limit'])
})

test('totals count each failed rule and keep the last 50 messages', () => {
  let t = EMPTY

  for (let i = 0; i < 60; i++) {
    t = tally(t, lintMessage(i % 2 === 0 ? GOOD : 'plain'), 100, `t${i}`)
  }

  expect(t.messages).toBe(60)
  expect(t.failures['result first']).toBe(30)
  expect(t.recent.length).toBe(50)
  expect(report(t, 'Final messages', EN.report)).toContain('| result first | 50% |')
  // Only the shown names follow the language; the stored tally keeps the English rule names.
  expect(report(t, 'Mensajes finales', ES.report)).toContain('| resultado primero | 50% |')
  expect(report(t, 'Mensajes finales', ES.report)).toContain('| Regla | Cumple |')
  expect(report(EMPTY, 'Mensajes finales', ES.report)).toBe('Mensajes finales: ninguno revisado aún.')
})
