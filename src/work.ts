import type { SessionEvent } from '@deepseek-ai/dsh-session'

export type LiveWorkRoute = 'followup' | 'steer'

export function liveWorkRoute(status: 'idle' | 'running'): LiveWorkRoute {
  return status === 'running' ? 'steer' : 'followup'
}

export function openTurnNumber(events: readonly SessionEvent[]): number | undefined {
  let open: number | undefined
  for (const event of events) {
    if (event.type === 'turn/start') open = event.data.turn
    else if (event.type === 'turn/end') open = undefined
  }
  return open
}

export function livePhaseForSpeech(input: {
  backendWorking: boolean
  role: 'user' | 'assistant'
  final: boolean
}): 'speaking' | 'listening' | undefined {
  if (input.backendWorking) return undefined
  if (input.role !== 'assistant') return undefined
  return input.final ? 'listening' : 'speaking'
}
