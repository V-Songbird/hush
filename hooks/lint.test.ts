import { expect, test } from 'claude-code/testing'

import { RULES, asTally, lintMessage, localLinks, settingsOf, tally } from './lint'

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

test('a message in the voice’s shape meets every rule', () => {
  expect(lintMessage(GOOD)).toEqual([])
})

test('a long sentence, a missing rule and a footnote at the end each miss their rule', () => {
  const text = ['**Done.**', 'This sentence keeps going on and on well past the twelve words the voice allows here.', '', '[^1]: A note.'].join('\n')

  expect(lintMessage(text)).toEqual(['rules where set', 'next step where set', 'sentences within limit'])
})

test('a message that does not open on the bold result misses result first', () => {
  expect(lintMessage(GOOD.replace('**The login test passes again.**', 'The login test passes again.'))).toEqual(['result first'])
})

test('each rule follows the reader’s /hush:config settings', () => {
  const long = 'This sentence runs to fifteen words, which twenty allows and twelve does not allow.'
  // next=top: the Next line under the result, one rule after it, footnotes last.
  const top = ['**Done.**', '', '**Siguiente paso:** run it.', '', '---', '', long, '', '[^1]: A note.', '', '&nbsp;'].join('\n')

  expect(lintMessage(top, settingsOf({ next: 'top', sentences: '20' }))).toEqual([])
  expect(lintMessage(top)).toContain('next step where set')

  const bare = ['**Done.**', '', long].join('\n')
  expect(lintMessage(bare, settingsOf({ next: 'off', rules: 'off', sentences: '20' }))).toEqual([])
  // markdown=plain has no rules, whatever the rules knob says, and forbids <kbd>.
  expect(lintMessage(`${bare}\n\nPress <kbd>Ctrl</kbd>.`, settingsOf({ next: 'off', markdown: 'plain', sentences: '20' }))).toEqual(['no raw html'])
  // next=off with rules on keeps the rule under the result, and no Next line.
  expect(lintMessage(['**Done.**', '', '---', '', 'One fact.'].join('\n'), settingsOf({ next: 'off' }))).toEqual([])
  expect(lintMessage(GOOD, settingsOf({ next: 'off' }))).toEqual(['next step where set'])
  // An unknown value is the default, as in Hush's own loader.
  expect(settingsOf({ next: 'sideways', detail: 'short' })).toEqual({ next: 'end', rules: 'on', detail: 'short', markdown: 'rich', sentences: '12' })
})

test('the word budget follows the detail setting and a block follows the sentences setting', () => {
  const words = Array.from({ length: 30 }, () => 'Plain words here.').join(' ')
  const text = ['**Done.**', '', '---', '', 'One fact.', '', words, '', '---', '', '**Next:** read it.'].join('\n')

  expect(lintMessage(text, settingsOf({ detail: 'short' }))).toEqual(['blocks within limit', 'words within limit'])
  expect(lintMessage(text, settingsOf({ detail: 'bare' }))).toEqual(['blocks within limit'])
  expect(lintMessage(text, settingsOf({ detail: 'full', sentences: '20' }))).toEqual(['blocks within limit'])
})

test('only kbd is allowed as html under rich Markdown, and code does not count', () => {
  expect(lintMessage('Press <kbd>Ctrl</kbd> and `<details>`.')).not.toContain('no raw html')
  expect(lintMessage('Open <details>here</details>.')).toContain('no raw html')
})

test('local links lose their line and skip web pages and anchors', () => {
  const text = 'See [a](src/a.js:12), [b](docs/b%20c.md), [w](https://x.dev/a), [t](#terminal/1).'

  expect(localLinks(text)).toEqual(['src/a.js', 'docs/b c.md'])
  expect(lintMessage(text, settingsOf(undefined), 1)).toContain('links resolve')
})

test('the voice has no alert or diagram rule any more', () => {
  expect(RULES.some(rule => /alert|mermaid|proxy/.test(rule))).toBe(false)
})

test('the tally counts met messages and misses per rule, and holds numbers and days only', () => {
  let t = tally(undefined, [], '2026-11-01')
  t = tally(t, ['result first', 'no raw html'], '2026-11-02')
  t = tally(t, ['result first'], '2026-11-03')

  expect(t).toEqual({ messages: 3, met: 1, misses: { 'result first': 2, 'no raw html': 1 }, since: '2026-11-01', last: '2026-11-03' })
  expect(Object.keys(t).sort()).toEqual(['last', 'messages', 'met', 'misses', 'since'])
})

test('a tally read back keeps counts only, and anything else starts a new count', () => {
  const kept = asTally({ messages: 2, met: 1, misses: { 'result first': 1, other: 3, 'no raw html': 'x' }, since: '2026-11-01', last: '2026-11-02', sentence: 'secret' })

  expect(kept).toEqual({ messages: 2, met: 1, misses: { 'result first': 1 }, since: '2026-11-01', last: '2026-11-02' })
  for (const bad of [undefined, null, 'x', {}, { messages: 1, met: 2, since: '2026-11-01', last: '2026-11-01' }, { messages: 1, met: 1, since: 'today', last: '2026-11-01' }]) {
    expect(asTally(bad)).toBeUndefined()
  }
})
