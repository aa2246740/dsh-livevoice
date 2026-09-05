import { describe, expect, it } from 'vitest'
import { createAssistantMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import { lastAssistantTextForTurn } from '../src/text.ts'

function assistantMessage(turn: number, text: string): SessionEvent {
  return {
    type: 'assistant/message',
    seq: turn,
    time: turn,
    data: {
      turn,
      step: 1,
      message: createAssistantMessage({
        content: [{ type: 'text', text }],
        source: { provider: 'mock', model: 'mock' },
      }),
    },
  }
}

describe('lastAssistantTextForTurn', () => {
  it('ignores assistant text from other turns', () => {
    const events = [assistantMessage(6, 'old'), assistantMessage(7, 'now')]
    expect(lastAssistantTextForTurn(events, 7)).toBe('now')
    expect(lastAssistantTextForTurn(events, 6)).toBe('old')
    expect(lastAssistantTextForTurn(events, 8)).toBe('')
  })

  it('does not mistake tool-call commentary for a final reply', () => {
    const event = {
      type: 'assistant/message',
      seq: 7,
      time: 7,
      data: {
        turn: 7,
        step: 1,
        message: createAssistantMessage({
          content: [
            { type: 'text', text: 'I am still checking.' },
            { type: 'tool-call', id: ToolCallId('fixture-tool'), name: 'fixture', arguments: '{}' },
          ],
          source: { provider: 'mock', model: 'mock' },
        }),
      },
    } satisfies SessionEvent
    expect(lastAssistantTextForTurn([event], 7)).toBe('')
  })
})
