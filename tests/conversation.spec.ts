import { describe, expect, it } from 'vitest'
import { Session, SessionId, type SessionEvent } from '@deepseek-ai/dsh-session'
import { presentFinalTranscript, type TranscriptSession } from '../src/conversation.ts'
import { LIVE_HEAR_COMMAND, LIVE_SAY_COMMAND } from '../src/ids.ts'
import { parseLiveServerEvent } from '../src/protocol.ts'
import { emptyTranscriptState, ingestLiveEvent, type TranscriptState } from '../src/transcript.ts'

function sessionLog(seed: SessionEvent[] = []): TranscriptSession & { readonly log: SessionEvent[] } {
  const log = [...seed]
  return {
    log,
    snapshotEvents() {
      return log
    },
    append(type, data, ...opts) {
      const event = {
        type,
        data,
        seq: log.length,
        time: log.length + 1,
        ...opts[0],
      } as SessionEvent
      log.push(event)
      return event as ReturnType<Session['append']>
    },
  }
}

function presentFromLive(
  session: TranscriptSession,
  state: TranscriptState,
  payload: unknown,
): TranscriptState {
  const event = parseLiveServerEvent(payload)
  if (event === null) throw new Error('expected a live event')
  const result = ingestLiveEvent(state, event)
  if (result === null) return state
  const updates = Array.isArray(result) ? result : [result]
  for (const update of updates) {
    if (!update.present) continue
    presentFinalTranscript(session, { role: update.present.role, text: update.present.text })
  }
  return updates.at(-1)?.state ?? state
}

function expectLiveCommand(log: readonly SessionEvent[], name: string, text: string): void {
  expect(log.map(event => event.type)).toEqual(['command/run', 'command/done'])
  const run = log[0]
  if (run?.type !== 'command/run') throw new Error('expected command/run')
  expect(run.data.name).toBe(name)
  expect(run.data.args).toBe(text)
  const done = log[1]
  if (done?.type !== 'command/done') throw new Error('expected command/done')
  expect(done.data.commandId).toBe(run.data.commandId)
  expect(done.data.kind).toBe('success')
  expect(done.data.text).toBe(text)
}

describe('presentFinalTranscript', () => {
  it('writes a hear command for a finished user utterance, not user/message', () => {
    const session = sessionLog()
    expect(presentFinalTranscript(session, { role: 'user', text: '好了,不用介绍了' })).toBe(true)

    expect(session.log.some(event => event.type === 'user/message')).toBe(false)
    expectLiveCommand(session.log, LIVE_HEAR_COMMAND, '好了,不用介绍了')
  })

  it('does not write three messages if called once', () => {
    const session = sessionLog()
    presentFinalTranscript(session, { role: 'user', text: '好了,不用介绍了' })
    expect(session.log).toHaveLength(2)
  })

  it('records live assistant speech as a log-only command card', () => {
    const session = sessionLog()
    expect(presentFinalTranscript(session, { role: 'assistant', text: 'hi there' })).toBe(true)
    expectLiveCommand(session.log, LIVE_SAY_COMMAND, 'hi there')
  })

  it('does not invent an AgentLoop turn for live assistant text', () => {
    const session = sessionLog()
    session.append('turn/start', { turn: 1 })

    expect(presentFinalTranscript(session, { role: 'assistant', text: 'later' })).toBe(true)
    expect(session.log.map(event => event.type)).toEqual(['turn/start', 'command/run', 'command/done'])
    const run = session.log[1]
    if (run?.type !== 'command/run') throw new Error('expected command/run')
    expect(run.data.name).toBe(LIVE_SAY_COMMAND)
  })

  it('records a hear command during an open turn without throwing', () => {
    const session = sessionLog()
    session.append('turn/start', { turn: 1 })
    expect(() => presentFinalTranscript(session, { role: 'user', text: 'casual' })).not.toThrow()
    expect(session.log.map(event => event.type)).toEqual(['turn/start', 'command/run', 'command/done'])
    const run = session.log[1]
    if (run?.type !== 'command/run') throw new Error('expected command/run')
    expect(run.data.name).toBe(LIVE_HEAR_COMMAND)
    expect(run.data.args).toBe('casual')
    expect(session.log.some(event => event.type === 'user/message')).toBe(false)
  })

  it('keeps hear commands out of deriveMessages during an open turn', () => {
    const session = Session.create(SessionId('live-hear-open-turn'))
    session.append('turn/start', { turn: 1 })
    expect(presentFinalTranscript(session, { role: 'user', text: 'casual' })).toBe(true)
    expect(session.deriveMessages()).toEqual([])
  })

  it('does not append a hear command for ASR fragments, only the assembled utterance after turn.done', () => {
    const session = sessionLog()
    let state = emptyTranscriptState()
    const fragments = [
      { type: 'input_transcript.added', item: { text: ' Yeah' } },
      {
        type: 'turn.created',
        turn: { id: 'turn_1', role: 'user', transcript: ' Yeah', start_ms: 1000, end_ms: 1200 },
      },
      { type: 'turn.delta', delta: ' Yo', turn_id: 'turn_1' },
      { type: 'input_transcript.added', item: { text: ' 23号' } },
    ]
    for (const payload of fragments) {
      state = presentFromLive(session, state, payload)
    }
    expect(session.log.map(event => event.type)).toEqual([])

    presentFromLive(session, state, {
      type: 'turn.done',
      turn: { role: 'user', transcript: 'Yeah Yo 23号' },
    })
    expectLiveCommand(session.log, LIVE_HEAR_COMMAND, 'Yeah Yo 23号')
  })

  it('does not write a hear command until turn.done, even when the assistant starts speaking', () => {
    const session = sessionLog()
    let state = emptyTranscriptState()
    state = presentFromLive(session, state, { type: 'input_transcript.added', item: { text: '周日哪里吃' } })
    state = presentFromLive(session, state, {
      type: 'turn.created',
      turn: { role: 'user', transcript: '周日哪里吃' },
    })
    expect(session.log.map(event => event.type)).toEqual([])

    state = presentFromLive(session, state, { type: 'output_transcript.added', item: { text: '你想去哪家？' } })
    expect(session.log.map(event => event.type)).toEqual([])

    presentFromLive(session, state, {
      type: 'turn.done',
      turn: { role: 'user', transcript: '周日哪里吃' },
    })
    expectLiveCommand(session.log, LIVE_HEAR_COMMAND, '周日哪里吃')
  })

  it('presents the turn.done transcript, not the spaced ASR fragment', () => {
    const session = sessionLog()
    let state = emptyTranscriptState()
    state = presentFromLive(session, state, { type: 'input_transcript.added', item: { text: '给' } })
    state = presentFromLive(session, state, { type: 'input_transcript.added', item: { text: ' 我' } })
    state = presentFromLive(session, state, { type: 'input_transcript.added', item: { text: ' 做个' } })
    state = presentFromLive(session, state, { type: 'input_transcript.added', item: { text: ' Flappy Bird' } })
    state = presentFromLive(session, state, { type: 'output_transcript.added', item: { text: '好的' } })
    expect(session.log.filter(event => event.type === 'command/run')).toHaveLength(0)

    presentFromLive(session, state, {
      type: 'turn.done',
      turn: { role: 'user', transcript: '给我做个 Flappy Bird' },
    })
    expect(session.log.filter(event => event.type === 'command/run')).toHaveLength(1)
    const run = session.log.find(event => event.type === 'command/run')
    if (run?.type !== 'command/run') throw new Error('expected command/run')
    expect(run.data.name).toBe(LIVE_HEAR_COMMAND)
    expect(run.data.args).toBe('给我做个 Flappy Bird')
  })

  it('skips a second identical hear', () => {
    const session = sessionLog()
    presentFinalTranscript(session, { role: 'user', text: '你好' })
    presentFinalTranscript(session, { role: 'user', text: '你好' })
    expect(session.log.filter(event => event.type === 'command/run')).toHaveLength(1)
  })

  it('keeps live say out of the chat log while the backend is working', () => {
    const session = sessionLog()
    presentFinalTranscript(session, { role: 'user', text: '看一下新闻', backendWorking: true })
    presentFinalTranscript(session, { role: 'assistant', text: '好的,我看一下。', backendWorking: true })
    expect(session.log.filter(event => event.type === 'command/run')).toHaveLength(1)
    const run = session.log[0]
    if (run?.type !== 'command/run') throw new Error('expected command/run')
    expect(run.data.name).toBe(LIVE_HEAR_COMMAND)
  })

  it('still records live say when the backend is idle', () => {
    const session = sessionLog()
    presentFinalTranscript(session, { role: 'assistant', text: '你好呀' })
    expectLiveCommand(session.log, LIVE_SAY_COMMAND, '你好呀')
  })
})
