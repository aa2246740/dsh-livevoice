import type { LiveServerEvent } from './protocol.js'

export interface LiveTranscript {
  role: 'user' | 'assistant'
  text: string
  turn: number
  final: boolean
}

export interface RoleTranscript {
  text: string
  turn: number
  final: boolean
}

export interface TranscriptState {
  user: RoleTranscript
  assistant: RoleTranscript
}

export interface TranscriptUpdate {
  state: TranscriptState
  emit: LiveTranscript
  present?: LiveTranscript
}

const emptyRole = (): RoleTranscript => ({ text: '', turn: 0, final: true })

export function emptyTranscriptState(): TranscriptState {
  return { user: emptyRole(), assistant: emptyRole() }
}

export function ingestLiveEvent(
  state: TranscriptState,
  event: LiveServerEvent,
): TranscriptUpdate | TranscriptUpdate[] | null {
  switch (event.type) {
    case 'input_transcript.added':
      return applyAdd(state, 'user', event.item.text)
    case 'output_transcript.added': {
      const closed = closeOpenUser(state)
      const next = applyAdd(closed?.state ?? state, 'assistant', event.item.text)
      if (closed && next) return [closed, next]
      return next ?? closed
    }
    case 'turn.created': {
      const closed = event.turn.role === 'assistant' ? closeOpenUser(state) : null
      const next = applyAdd(closed?.state ?? state, event.turn.role, event.turn.transcript)
      if (closed && next) return [closed, next]
      return next ?? closed
    }
    case 'turn.delta':
      return applyAdd(state, openRole(state), event.delta)
    case 'turn.done': {
      const update = applyFinish(state, event.turn.role, event.turn.transcript)
      return update === null ? null : { ...update, present: update.emit }
    }
    default:
      return null
  }
}

function openRole(state: TranscriptState): LiveTranscript['role'] {
  if (!state.user.final) return 'user'
  if (!state.assistant.final) return 'assistant'
  return 'user'
}

function closeOpenUser(state: TranscriptState): TranscriptUpdate | null {
  if (state.user.final || !state.user.text) return null
  return applyFinish(state, 'user', state.user.text)
}

function applyAdd(
  state: TranscriptState,
  role: LiveTranscript['role'],
  text: string,
): TranscriptUpdate | null {
  const normalized = text.trim()
  if (!normalized) return null
  const current = state[role]
  let turn = current.turn
  let nextText: string
  if (!current.text) {
    turn += 1
    nextText = normalized
  } else if (current.final) {
    if (normalized === current.text || current.text.endsWith(normalized)) return null
    turn += 1
    nextText = normalized
  } else if (normalized.startsWith(current.text)) {
    nextText = normalized
  } else if (current.text.endsWith(normalized)) {
    nextText = current.text
  } else {
    nextText = `${current.text} ${normalized}`.replaceAll(/\s+/g, ' ').trim()
  }
  const bucket = { text: nextText, turn, final: false }
  const emit: LiveTranscript = { role, text: nextText, turn, final: false }
  return { state: { ...state, [role]: bucket }, emit }
}

function applyFinish(
  state: TranscriptState,
  role: LiveTranscript['role'],
  text: string,
): TranscriptUpdate | null {
  const current = state[role]
  let turn = current.turn
  if (!current.text) turn += 1
  else if (current.final && text.trim() !== current.text) turn += 1
  const trimmed = text.trim()
  if (!trimmed && !current.text) return null
  const nextText = !current.final && current.text.startsWith(trimmed) && current.text.length > trimmed.length
    ? current.text
    : trimmed || current.text
  const bucket = { text: nextText, turn, final: true }
  const emit: LiveTranscript = { role, text: nextText, turn, final: true }
  return { state: { ...state, [role]: bucket }, emit }
}
