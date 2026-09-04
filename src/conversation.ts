import { CommandId } from '@deepseek-ai/dsh-commands'
import type {} from '@deepseek-ai/dsh-commands/types'
import type { Session, SessionEvent } from '@deepseek-ai/dsh-session'
import { LIVE_HEAR_COMMAND, LIVE_SAY_COMMAND } from './ids.js'

export interface TranscriptSession {
  readonly events: readonly SessionEvent[]
  append: Session['append']
}

export function compactLiveText(text: string): string {
  return text.replaceAll(/\s+/g, '')
}

export function presentFinalTranscript(
  session: TranscriptSession,
  input: { role: 'user' | 'assistant'; text: string; backendWorking?: boolean },
): boolean {
  const text = input.text.trim()
  if (!text) return true
  const name = input.role === 'user' ? LIVE_HEAR_COMMAND : LIVE_SAY_COMMAND
  if (input.role === 'assistant' && input.backendWorking === true) return true
  if (isDuplicateLiveCommand(session.events, name, text)) return true
  appendLiveCommand({ session, name, text })
  return true
}

function isDuplicateLiveCommand(
  events: readonly SessionEvent[],
  name: string,
  text: string,
): boolean {
  const previous = lastLiveCommandText(events, name)
  if (previous === undefined) return false
  return compactLiveText(previous) === compactLiveText(text)
}

function lastLiveCommandText(events: readonly SessionEvent[], name: string): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event.type !== 'command/run' || event.data.name !== name) continue
    return typeof event.data.args === 'string' ? event.data.args : undefined
  }
  return undefined
}

function appendLiveCommand(input: {
  session: TranscriptSession
  name: string
  text: string
}): void {
  const commandId = CommandId(crypto.randomUUID())
  input.session.append('command/run', {
    commandId,
    name: input.name,
    args: input.text,
    source: { kind: 'user' },
  })
  input.session.append('command/done', {
    commandId,
    kind: 'success',
    text: input.text,
  })
}
