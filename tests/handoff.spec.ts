import { describe, expect, it } from 'vitest'
import {
  briefLiveDelegation,
  parseRealtimeDelegation,
  renderRealtimeDelegation,
  renderWorkerHandoff,
  WORKER_HANDOFF_PREFACE,
  type RealtimeDelegation,
} from '../src/handoff.ts'

const brief: RealtimeDelegation = {
  input: 'Build a retro horse-running demo in the current repo.',
  transcriptDelta: [
    { role: 'user', text: '我想要那种复古的死磕编码的感觉' },
    { role: 'assistant', text: '好，我帮你开一个方向。' },
    { role: 'user', text: '一匹马在跑' },
  ],
}

describe('renderRealtimeDelegation', () => {
  it('wraps a brief and transcript as the Codex envelope', () => {
    expect(renderRealtimeDelegation(brief)).toBe(
      [
        '<realtime_delegation>',
        '  <input>Build a retro horse-running demo in the current repo.</input>',
        '  <transcript_delta>user: 我想要那种复古的死磕编码的感觉',
        'assistant: 好，我帮你开一个方向。',
        'user: 一匹马在跑</transcript_delta>',
        '</realtime_delegation>',
      ].join('\n'),
    )
  })

  it('returns undefined for empty or whitespace-only input', () => {
    expect(renderRealtimeDelegation({ input: '', transcriptDelta: [] })).toBeUndefined()
    expect(renderRealtimeDelegation({ input: '   \n', transcriptDelta: brief.transcriptDelta })).toBeUndefined()
  })

  it('escapes XML in the brief and in transcript lines', () => {
    const rendered = renderRealtimeDelegation({
      input: 'Use <script> & "quotes" and \'apos\'',
      transcriptDelta: [{ role: 'user', text: 'a < b & c' }],
    })
    expect(rendered).toContain('<input>Use &lt;script&gt; &amp; &quot;quotes&quot; and &apos;apos&apos;</input>')
    expect(rendered).toContain('user: a &lt; b &amp; c')
  })
})

describe('parseRealtimeDelegation', () => {
  it('roundtrips a brief and mixed-role transcript', () => {
    const rendered = renderRealtimeDelegation(brief)
    expect(rendered).toBeTypeOf('string')
    expect(parseRealtimeDelegation(rendered ?? '')).toEqual(brief)
  })

  it('roundtrips XML special characters', () => {
    const original: RealtimeDelegation = {
      input: 'Use <script> & "quotes" and \'apos\'',
      transcriptDelta: [{ role: 'user', text: 'a < b & c' }],
    }
    const rendered = renderRealtimeDelegation(original)
    expect(parseRealtimeDelegation(rendered ?? '')).toEqual(original)
  })

  it('returns undefined for empty input or non-envelope text', () => {
    expect(parseRealtimeDelegation('')).toBeUndefined()
    expect(parseRealtimeDelegation('<realtime_delegation>\n  <input>  </input>\n  <transcript_delta></transcript_delta>\n</realtime_delegation>')).toBeUndefined()
    expect(parseRealtimeDelegation('这个demo,我应该把,随便做点啥好看的就行')).toBeUndefined()
  })

  it('trims surrounding whitespace before parsing', () => {
    const rendered = renderRealtimeDelegation({ input: 'Run the tests', transcriptDelta: [] })
    expect(parseRealtimeDelegation(`\n${rendered}\n`)).toEqual({
      input: 'Run the tests',
      transcriptDelta: [],
    })
  })
})

describe('renderWorkerHandoff', () => {
  it('puts a GLM-readable legend in front of the envelope', () => {
    const rendered = renderWorkerHandoff(brief)
    const envelope = renderRealtimeDelegation(brief)
    expect(rendered).toBe(`${WORKER_HANDOFF_PREFACE}\n\n${envelope}`)
    expect(renderWorkerHandoff({ input: '  ', transcriptDelta: [] })).toBeUndefined()
  })
})

describe('briefLiveDelegation', () => {
  const oral = '就是我们在做的这个。东西啊,那个- 这个产品啊,这个页面。你让那个agent继续搞吗'

  it('preserves a complete colloquial question instead of regex-rewriting its meaning', () => {
    const input = briefLiveDelegation({ liveText: oral, lastUserSpeech: oral })
    expect(input).toBe(oral)
  })

  it('drops only provably pure greetings', () => {
    expect(briefLiveDelegation({ liveText: 'Hi' })).toBeUndefined()
    expect(briefLiveDelegation({ liveText: '您好！' })).toBeUndefined()
    expect(briefLiveDelegation({ liveText: '你好，看看当前任务进度' })).toBe('你好，看看当前任务进度')
  })

  it('passes through an already-clean imperative brief', () => {
    const clean = 'Build a jittery Y2K-coded horse-running demo in the current workspace.'
    expect(briefLiveDelegation({ liveText: clean })).toBe(clean)
  })

  it('keeps a fragment intact so recent transcript can resolve it downstream', () => {
    expect(briefLiveDelegation({ liveText: '就按刚才第二个方案' })).toBe('就按刚才第二个方案')
  })

  it('allows a read-only status request to reach the worker', () => {
    expect(briefLiveDelegation({
      liveText: '开工了吗?正在做吗?项目叫啥',
      lastUserSpeech: '开工了吗?正在做 吗?那个 项目 叫啥',
    })).toBe('开工了吗?正在做吗?项目叫啥')
  })

  it('keeps hypotheticals distinct from explicit change requests', () => {
    expect(briefLiveDelegation({ liveText: '假如让你优化会怎么做' })).toBe('假如让你优化会怎么做')
    expect(briefLiveDelegation({ liveText: '现在优化' })).toBe('现在优化')
  })

  it('puts the exact current request in <input> and recent speech in context', () => {
    const input = briefLiveDelegation({ liveText: oral, lastUserSpeech: oral })
    if (input === undefined) throw new Error('expected a brief')
    const rendered = renderRealtimeDelegation({
      input,
      transcriptDelta: [{ role: 'user', text: oral }],
    })
    const parsed = parseRealtimeDelegation(rendered ?? '')
    expect(parsed?.input).toBe(input)
    expect(parsed?.input).toBe(oral)
    expect(parsed?.transcriptDelta).toEqual([{ role: 'user', text: oral }])
  })

  it('tells the worker that context resolves fragments without expanding authorization', () => {
    expect(WORKER_HANDOFF_PREFACE).toContain('resolve references or fragments')
    expect(WORKER_HANDOFF_PREFACE).toContain('Context does not expand scope')
    expect(WORKER_HANDOFF_PREFACE).toContain('authorize explanation only')
    expect(WORKER_HANDOFF_PREFACE).toContain('Read-only status questions are valid requests')
  })
})
