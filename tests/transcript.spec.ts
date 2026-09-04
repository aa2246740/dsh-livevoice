import { describe, expect, it } from 'vitest'
import { parseLiveServerEvent } from '../src/protocol.ts'
import { emptyTranscriptState, ingestLiveEvent, type TranscriptState, type TranscriptUpdate } from '../src/transcript.ts'

function ingest(
  state: TranscriptState,
  payload: unknown,
): { state: TranscriptState; finals: string[] } {
  const event = parseLiveServerEvent(payload)
  if (event === null) throw new Error('expected a live event')
  const result = ingestLiveEvent(state, event)
  if (result === null) return { state, finals: [] }
  const updates: TranscriptUpdate[] = Array.isArray(result) ? result : [result]
  return {
    state: updates.at(-1)?.state ?? state,
    finals: updates.flatMap(update => update.present ? [`${update.present.role}:${update.present.text}`] : []),
  }
}

describe('live transcript assembly', () => {
  it('does not finalize on turn.created so later words stay on the same utterance', () => {
    let state = emptyTranscriptState()
    const finals: string[] = []
    const steps = [
      { type: 'input_transcript.added', item: { text: ' Yeah' } },
      {
        type: 'turn.created',
        turn: { id: 'turn_1', role: 'user', transcript: ' Yeah', start_ms: 1000, end_ms: 1200 },
      },
      { type: 'turn.delta', delta: ' Yo', turn_id: 'turn_1' },
      { type: 'input_transcript.added', item: { text: ' 23号' } },
    ]
    for (const payload of steps) {
      const next = ingest(state, payload)
      state = next.state
      finals.push(...next.finals)
    }

    expect(finals, 'turn.created must not present the first word as a finished utterance')
      .toEqual([])
    expect(state.user.final).toBe(false)
    expect(state.user.text).toBe('Yeah Yo 23号')
  })

  it('finalizes the user utterance when Codex starts speaking', () => {
    let state = emptyTranscriptState()
    state = ingest(state, { type: 'input_transcript.added', item: { text: '周日哪里吃' } }).state
    state = ingest(state, {
      type: 'turn.created',
      turn: { role: 'user', transcript: '周日哪里吃' },
    }).state
    const after = ingest(state, { type: 'output_transcript.added', item: { text: '你想去哪家？' } })

    expect(after.finals, 'assistant speech must not present the user utterance; only turn.done does')
      .toEqual([])
    expect(after.state.user.final).toBe(true)
    expect(after.state.user.text).toBe('周日哪里吃')
    expect(after.state.assistant.text).toBe('你想去哪家？')
    expect(after.state.assistant.final).toBe(false)
  })

  it('still honors an explicit turn.done', () => {
    let state = emptyTranscriptState()
    state = ingest(state, { type: 'input_transcript.added', item: { text: '有没有结果' } }).state
    const after = ingest(state, {
      type: 'turn.done',
      turn: { role: 'user', transcript: '有没有结果' },
    })
    expect(after.finals).toEqual(['user:有没有结果'])
    expect(after.state.user.final).toBe(true)
  })
})
