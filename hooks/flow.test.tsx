import { expect, test } from 'claude-code/testing'
import type { On } from 'claude-code'
import type { Engine } from 'claude-code/testing'

import { NO_HEADS, withHeads } from './fold'
import { FOLDS_KEPT, SESSIONS_KEPT } from './register'

// Whole replies through the mod: turn.start, the rows the session stores, turn.complete, then a
// row drawn on the desktop. Each beneath hook stands for the engine: its store, its own row.

type Row = { type: 'user' | 'assistant' | 'attachment'; content: unknown[]; door?: string; name?: string; isMeta?: true; agentId?: string }

const say = (text: string, agentId?: string): Row => ({ type: 'assistant', content: [{ type: 'text', text }], agentId })
const call = (id: string, agentId?: string): Row => ({ type: 'assistant', content: [{ type: 'tool_use', id, name: 'Bash', input: {} }], agentId })
const result = (id: string, isError = false): Row => ({ type: 'user', content: [{ type: 'tool_result', tool_use_id: id, content: 'ok', is_error: isError }] })
const work = (id: string) => [call(id), result(id)]

// A fold and a session record in the stored shape.
const KEY = 'folds-4:'
const savedFold = (head: string, more: string[] = []) => ({ head, final: `Final of ${head}`, texts: [head, ...more], risky: [], errors: 0 })
const savedFolds = (folds: ReturnType<typeof savedFold>[]) => ({ folds, loose: withHeads(NO_HEADS, folds.map(fold => fold.final)) })

const kit = ($: Engine, on: On, saved: Record<string, unknown> = {}) => {
  const store = new Map(Object.entries(saved))
  const env = { session: 's1', disable: undefined as string | undefined }
  let n = 0

  on('session.id', () => ({ value: env.session }))
  on('store.get', (_, e) => ({ value: store.get(e.key) }))
  on('store.set', (_, e) => {
    store.set(e.key, JSON.parse(JSON.stringify(e.value)))
    return { value: undefined }
  })
  on('store.delete', (_, e) => {
    store.delete(e.key)
    return { value: undefined }
  })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('env.get', (_, e) => ({ value: e.name === 'HUSH_DISABLE' ? env.disable : undefined }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.append', (_, e, next) => next(e))
  on('turn.start', (_, e) => ({ turnId: e.turnId }) as never)
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', ($, e) => $.ui.resolve(e).Text({ children: `engine: ${e.props.text}` }))

  return {
    store,
    env,
    start: () => $.session.start({ surface: 'desktop', isInteractive: true, cwd: '/work' } as never),
    async turn(rows: Row[], mid?: () => void) {
      const turnId = `t${++n}`
      await $.turn.start({ turnId } as never)
      for (const { agentId, door, ...message } of rows) {
        const role = message.type === 'attachment' ? undefined : message.type
        await $.session.append({ message: { ...message, role }, door: door ?? (message.type === 'assistant' ? 'response' : 'tool-result'), uuid: `u${n}-${Math.random()}`, origin: { kind: 'model', model: 'm' }, agentId } as never)
      }
      mid?.()
      await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId, reason: 'answer' })
    },
    /** Everything a text row draws, as JSON. */
    async whole(text: string) {
      const ui = await $.ui.mount({ plugin: 'hush', component: 'AssistantMessage', surface: 'desktop', props: { text, isFirstOfReply: false } } as never)
      const all = JSON.stringify((await ui.find({ type: 'Box' })) ?? null)
      await ui.unmount()
      return all
    },
    /** What a text row draws: the fold's line, the row hidden, or the row whole. */
    async draw(text: string) {
      const ui = await $.ui.mount({ plugin: 'hush', component: 'AssistantMessage', surface: 'desktop', props: { text, isFirstOfReply: false } } as never)
      const all = JSON.stringify((await ui.find({ type: 'Box' })) ?? null)
      const engine = (await ui.find({ type: 'Text', text: /^engine/ }))?.text
      await ui.unmount()
      const line = /(Show|Hide) \d+ progress messages?/.exec(all)?.[0]
      return line ?? (engine === 'engine: ' ? 'hidden' : engine === `engine: ${text}` ? 'whole' : `? ${all} ${engine}`)
    },
  }
}

// A head written again in a later reply must not strand the earlier fold.
test('a progress text repeated in a later reply never leaves an earlier text hidden with no line', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Checking the tests.'), ...work('a'), say('Fixing it.'), ...work('b'), say('**Final A**')])
  await k.turn([say('Let me look.'), ...work('c'), say('Checking the tests.'), ...work('d'), say('**Final B**')])

  expect(await k.draw('Fixing it.')).toBe('whole')
  expect(await k.draw('Checking the tests.')).toBe('whole')
  expect(await k.draw('Let me look.')).toBe('Show 1 progress message')
  expect(await k.draw('**Final B**')).toBe('whole')
})

// The same result line written before and after a tool call.
test('a final message written twice in one reply is never hidden', async ($, on) => {
  const k = kit($, on)
  const result = 'All 212 tests pass and the release notes are updated.'
  await k.turn([say('Reading.'), ...work('a'), say(result), ...work('w'), say(result)])

  expect(await k.draw(result)).toBe('whole')
  expect(await k.draw('Reading.')).toBe('Show 1 progress message')
})

// A later reply with no fold of its own.
test('a later text equal to an older progress text is drawn whole, and only that text', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Looking.'), ...work('a'), say('Checking the tests.'), ...work('b'), say('Final A.')])
  await k.turn([say('Checking the tests.')])
  await k.turn([say('Starting over.'), ...work('c')])

  expect(await k.draw('Checking the tests.')).toBe('whole')
  expect(await k.draw('Looking.')).toBe('Show 1 progress message')
  expect(await k.draw('Starting over.')).toBe('whole')
})

test('a fold whose first text is written again elsewhere draws every text whole', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Looking.'), ...work('a'), say('Then this.'), ...work('b'), say('Final A.')])
  await k.turn([say('Looking.'), ...work('c')])

  expect(await k.draw('Looking.')).toBe('whole')
  expect(await k.draw('Then this.')).toBe('whole')
})

// A prompt queued while Claude works is answered inside the same turn.
test('a prompt queued mid-turn keeps the answer to the first prompt out of the fold', async ($, on) => {
  const k = kit($, on)
  const queued: Row = { type: 'attachment', name: 'queued_command', door: 'attachment', content: [{ type: 'text', text: 'And the docs?' }] }
  await k.turn([call('a'), result('a'), queued, say('The answer is 42.'), ...work('b'), say('Docs updated.')])
  await k.turn([call('c'), result('c'), { type: 'user', door: 'queue', content: [{ type: 'text', text: 'One more.' }] }, say('Second answer.'), ...work('d'), say('Done too.')])

  expect(await k.draw('The answer is 42.')).toBe('whole')
  expect(await k.draw('Second answer.')).toBe('whole')
})

test('the prompt that starts a turn does not stop its fold', async ($, on) => {
  const k = kit($, on)
  await k.turn([{ type: 'user', door: 'prompt', content: [{ type: 'text', text: 'Fix it.' }] }, say('Looking.'), ...work('a'), say('Done.')])

  expect(await k.draw('Looking.')).toBe('Show 1 progress message')
})

// What the mod gathers, and from whom.
test('a subagent’s rows never join the main reply’s fold', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Main.'), call('a'), say('Sub progress.', 'sub1'), call('s1', 'sub1'), say('Sub final.', 'sub1'), result('a'), say('Final.')])

  expect(await k.draw('Sub progress.')).toBe('whole')
  expect(await k.draw('Sub final.')).toBe('whole')
  expect(await k.draw('Main.')).toBe('Show 1 progress message')
})

test('a Stop hook re-prompt closes the reply before it: each part folds before its own final', async ($, on) => {
  const k = kit($, on)
  const reprompt: Row = { type: 'user', isMeta: true, door: 'hook-context', content: [{ type: 'text', text: 'Stop hook feedback:\n[goal]: not yet' }] }
  await k.turn([say('Try one.'), ...work('a'), say('First final.'), reprompt, say('Try two.'), ...work('b'), say('Second final.')])

  expect(await k.draw('First final.')).toBe('whole')
  expect(await k.draw('Try one.')).toBe('Show 1 progress message')
  expect(await k.draw('Try two.')).toBe('Show 1 progress message')
  expect(await k.draw('Second final.')).toBe('whole')
})

test('a failed tool result counts on the line', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Running.'), call('a'), result('a', true), say('Final.')])

  expect(JSON.stringify(k.store.get(`${KEY}s1`))).toContain('"errors":1')
})

test('HUSH_DISABLE=1 set while a reply is gathered stores nothing for it', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Looking.'), ...work('a'), say('Done.')], () => (k.env.disable = '1'))

  expect([...k.store.keys()]).toEqual([])

  // The next turn, still switched off, gathers nothing: its re-prompt closes no reply.
  const reprompt: Row = { type: 'user', isMeta: true, door: 'hook-context', content: [{ type: 'text', text: 'Stop hook feedback:\n[goal]: not yet' }] }
  await k.turn([say('Again.'), ...work('b'), say('Final.'), reprompt, say('More.')])
  expect([...k.store.keys()]).toEqual([])

  k.env.disable = undefined
  expect(await k.draw('Looking.')).toBe('whole')
  expect(await k.draw('Again.')).toBe('whole')
})

// A plain answer, or a reply that ends on a tool call, writes nothing to the store.
test('replies that fold nothing write nothing', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Hi.')])
  await k.turn([say('Looking.'), ...work('a')])
  await k.turn([...work('b'), say('Only tools before me.')])

  expect([...k.store.keys()]).toEqual([])
})

// Each session sees its own folds, saved or none.
test('a session start restores that session’s folds and drops another session’s', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Looking.'), ...work('a'), say('Done.')])

  k.env.session = 's2'
  await k.start()
  expect(await k.draw('Looking.')).toBe('whole')

  k.env.session = 's1'
  await k.start()
  expect(await k.draw('Looking.')).toBe('Show 1 progress message')
})

// Older shapes (every tool id; a list of loose heads) are discarded, not read.
test('folds saved in an older shape are discarded and their keys removed on the next save', async ($, on) => {
  const old = [{ head: 'text:Now I check the store.', texts: ['Now I check the store.'], tools: ['toolu_a'], errors: 0, warnings: 0 }]
  const older = { folds: [{ head: 'Now I check the store.', final: 'Done.', texts: ['Now I check the store.'], errors: 0, warnings: 0 }], loose: ['Done.'] }
  const k = kit($, on, { 'folds-2:s1': old, 'folds-3:s1': older, 'folds-3:s0': older, 'cards-1:s1': [] })
  await k.start()
  expect(await k.draw('Now I check the store.')).toBe('whole')

  await k.turn([say('Looking.'), ...work('a'), say('Done.')])
  expect([...k.store.keys()]).toEqual(['cards-1:s1', `${KEY}s1`])
  expect(JSON.stringify(k.store.get(`${KEY}s1`))).not.toContain('tools')
})

test('the store keeps the newest sessions’ folds and leaves other keys alone', async ($, on) => {
  const saved: Record<string, unknown> = { 'cards-1:s0': [] }
  for (let i = 0; i < SESSIONS_KEPT + 2; i++) saved[`${KEY}old${i}`] = savedFolds([])
  const k = kit($, on, saved)
  await k.turn([say('Looking.'), ...work('a'), say('Done.')])

  const kept = [...k.store.keys()].filter(key => key.startsWith('folds-'))
  expect(kept.length).toBe(SESSIONS_KEPT)
  expect(kept.at(-1)).toBe(`${KEY}s1`)
  expect(kept[0]).toBe(`${KEY}old${3}`)
  expect(k.store.has('cards-1:s0')).toBe(true)
})

// A session already at the cap, saved, then one more reply: the cap holds, and the dropped fold's
// texts stay drawn whole, so a text it shared with the new fold does not start hiding.
test('a session keeps its newest folds; a dropped fold’s texts stay whole', async ($, on) => {
  const folds = Array.from({ length: FOLDS_KEPT }, (_, i) => savedFold(`Step ${i}.`, i === 0 ? ['Shared.'] : []))
  const k = kit($, on, { [`${KEY}s1`]: savedFolds(folds) })
  await k.start()
  expect(await k.draw('Shared.')).toBe('hidden')

  await k.turn([say('Look.'), ...work('a'), say('Shared.'), ...work('b'), say('Final.')])

  k.env.session = 's2'
  await k.start()
  k.env.session = 's1'
  await k.start()
  expect((k.store.get(`${KEY}s1`) as { folds: unknown[] }).folds.length).toBe(FOLDS_KEPT)
  expect(await k.draw('Step 0.')).toBe('whole')
  expect(await k.draw('Shared.')).toBe('whole')
  expect(await k.draw('Step 1.')).toBe('Show 1 progress message')
  expect(await k.draw('Look.')).toBe('Show 1 progress message')
})

test('a subagent’s text keeps the same words in a main fold drawn whole, and starts no reply', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Look.'), ...work('a'), say('Reading the config file.'), ...work('b'), say('Final.')])
  await k.turn([call('t'), say('Reading the config file.', 'sub1'), say('Sub progress.', 'sub1'), call('s', 'sub1'), say('Sub final.', 'sub1'), result('t'), say('Main final.')])

  expect(await k.draw('Reading the config file.')).toBe('whole')
  expect(await k.draw('Look.')).toBe('Show 1 progress message')
  expect(await k.draw('Sub progress.')).toBe('whole')
})

test('a compaction closes the reply; the texts before it are drawn whole', async ($, on) => {
  const k = kit($, on)
  const compaction: Row = { type: 'user', isMeta: true, door: 'compaction', content: [{ type: 'text', text: 'Summary of the conversation so far.' }] }
  await k.turn([say('Before.'), ...work('a'), say('Also before.'), compaction, say('After.'), ...work('b'), say('Final.')])

  expect(await k.draw('Before.')).toBe('whole')
  expect(await k.draw('Also before.')).toBe('whole')
  expect(await k.draw('After.')).toBe('Show 1 progress message')
})

test('a saved record whose loose heads are damaged is discarded', async ($, on) => {
  const k = kit($, on, { [`${KEY}s1`]: { folds: [savedFold('Looking.')], loose: 'A'.repeat(10) } })
  await k.start()

  expect(await k.draw('Looking.')).toBe('whole')
})

test('a subagent’s words written after the reply’s last save survive a reopen', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Look.'), ...work('a'), say('Reading the config file.'), ...work('b'), say('Final.')])
  await $.session.append({ message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: 'Reading the config file.' }] }, door: 'response', uuid: 'u-sub', origin: { kind: 'model', model: 'm' }, agentId: 'sub1' } as never)
  await $.turn.complete({ answer: '', durationMs: 1, isAborted: false, turnId: 'sub-t1', reason: 'answer', agentId: 'sub1' } as never)

  k.env.session = 's2'
  await k.start()
  k.env.session = 's1'
  await k.start()
  expect(await k.draw('Reading the config file.')).toBe('whole')
  expect(await k.draw('Look.')).toBe('Show 1 progress message')
})

test('a compaction after a queued prompt still keeps the first answer out of the fold', async ($, on) => {
  const k = kit($, on)
  const queued: Row = { type: 'attachment', name: 'queued_command', door: 'attachment', content: [{ type: 'text', text: 'And the docs?' }] }
  const compaction: Row = { type: 'user', isMeta: true, door: 'compaction', content: [{ type: 'text', text: 'Summary of the conversation so far.' }] }
  await k.turn([call('a'), result('a'), queued, compaction, say('The answer is 42.'), ...work('b'), say('Docs updated.')])

  expect(await k.draw('The answer is 42.')).toBe('whole')
})

test('a text written twice in one reply is drawn whole and counted nowhere', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Checking.'), ...work('a'), say('Checking.'), ...work('b'), say('Other.'), ...work('c'), say('Final.')])

  expect(await k.draw('Checking.')).toBe('whole')
  expect(await k.draw('Other.')).toBe('Show 1 progress message')
})

test('the line warns only about the texts it hides', async ($, on) => {
  const k = kit($, on)
  await k.turn([say('Looking.'), ...work('a'), say('The build failed once.'), ...work('b'), say('Final A.')])
  await k.turn([say('The build failed once.')])

  expect(await k.draw('Looking.')).toBe('Show 1 progress message')
  expect(await k.whole('Looking.')).not.toContain('warning')
})
