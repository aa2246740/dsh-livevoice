import type { ContentBlock } from '@deepseek-ai/dsh-llm'
import type { SessionEvent } from '@deepseek-ai/dsh-session'

export function textFromBlocks(content: readonly ContentBlock[]): string {
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && block.text.trim().length > 0) parts.push(block.text)
  }
  return parts.join('\n').trim()
}

export function hasToolCalls(content: readonly ContentBlock[]): boolean {
  return content.some(block => block.type === 'tool-call')
}

export function lastAssistantTextForTurn(events: readonly SessionEvent[], turn: number): string {
  let text = ''
  for (const event of events) {
    if (event.type !== 'assistant/message' || event.data.turn !== turn) continue
    if (hasToolCalls(event.data.message.content)) continue
    const next = textFromBlocks(event.data.message.content)
    if (next) text = next
  }
  return text
}
