import { describe, expect, it } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { livePhaseForSpeech, liveWorkRoute, openTurnNumber } from '../src/work.ts'

function turnStart(turn: number): SessionEvent {
  return {
    type: 'turn/start',
    seq: 0,
    time: 0,
    data: { turn },
  }
}

function turnEnd(turn: number): SessionEvent {
  return {
    type: 'turn/end',
    seq: 1,
    time: 1,
    data: { turn, reason: { kind: 'completed' } },
  }
}

describe('liveWorkRoute', () => {
  it('queues a later turn while idle', () => {
    expect(liveWorkRoute('idle')).toBe('followup')
  })

  it('steers the open turn while running', () => {
    expect(liveWorkRoute('running')).toBe('steer')
  })
})

describe('openTurnNumber', () => {
  it('is undefined on an empty log', () => {
    expect(openTurnNumber([])).toBeUndefined()
  })

  it('clears after matching start then end', () => {
    expect(openTurnNumber([turnStart(1), turnEnd(1)])).toBeUndefined()
  })

  it('returns the still-open turn', () => {
    expect(openTurnNumber([turnStart(1)])).toBe(1)
  })
})

describe('livePhaseForSpeech', () => {
  it('does not change phase while the backend is working', () => {
    expect(livePhaseForSpeech({ backendWorking: true, role: 'assistant', final: true })).toBeUndefined()
  })

  it('marks streaming assistant speech as speaking', () => {
    expect(livePhaseForSpeech({ backendWorking: false, role: 'assistant', final: false })).toBe('speaking')
  })

  it('returns to listening when assistant speech is final', () => {
    expect(livePhaseForSpeech({ backendWorking: false, role: 'assistant', final: true })).toBe('listening')
  })

  it('ignores user speech', () => {
    expect(livePhaseForSpeech({ backendWorking: false, role: 'user', final: true })).toBeUndefined()
  })
})
