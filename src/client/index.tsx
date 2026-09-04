import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LIVE_HEAR_COMMAND, LIVE_SAY_COMMAND } from '../ids.js'
import { LiveChip, LiveDock } from './LiveChip.js'
import { LiveVoiceSettings } from './LiveSettings.js'
import { LiveHear } from './LiveHear.js'
import { LiveSay } from './LiveSay.js'
import { en, zh, type LiveVoiceKey } from './locales.js'
import { LiveClientSession } from './session.js'

const NS = 'liveVoice'
const sessions = new Map<string, LiveClientSession>()

export const name = 'dsh-livevoice-client'
export const inject = ['slots', 'locale']

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    liveVoice: LiveVoiceKey
  }
}

function sessionOf(sessionId: SessionId | string): LiveClientSession {
  const id = String(sessionId)
  const existing = sessions.get(id)
  if (existing) return existing
  const created = new LiveClientSession(id)
  sessions.set(id, created)
  return created
}

export function apply(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dsh-livevoice: dictionaries')

  ctx.effect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const live = [...sessions.values()].find(item => item.snapshot.phase !== 'idle')
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l' && !event.altKey) {
        const sessionId = currentSessionId()
        if (!sessionId) return
        event.preventDefault()
        void sessionOf(sessionId).toggle()
        return
      }
      if (!live) return
      if (event.key === 'Escape') {
        event.preventDefault()
        void live.toggle()
        return
      }
      if (event.key === ' ' && !isTypingTarget(event.target)) {
        const barFocused = document.activeElement?.closest('[data-live-voice-bar=""]') !== null
        if (!barFocused) return
        event.preventDefault()
        live.toggleMute()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, 'dsh-livevoice: keys')

  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item',
    id: 'dsh-livevoice',
    order: 35,
    locale: NS,
  }, LiveVoiceSettings))

  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left',
    id: 'live',
    order: 30,
    label: () => ctx.locale.bind(NS)('chip'),
    locale: NS,
    inject: () => ({ liveOf: sessionOf }),
  }, LiveChip))

  ctx.slots.inject('conversation.input.dock', () => ctx.slots.register({
    name: 'conversation.input.dock',
    id: 'live',
    order: 20,
    priority: -80,
    locale: NS,
    inject: () => ({ liveOf: sessionOf }),
  }, LiveDock))

  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: LIVE_SAY_COMMAND,
    locale: NS,
  }, LiveSay))

  ctx.slots.inject('conversation.chat.commandview', () => ctx.slots.register({
    name: 'conversation.chat.commandview',
    key: LIVE_HEAR_COMMAND,
    locale: NS,
  }, LiveHear))
}

function currentSessionId(): string | undefined {
  const path = window.location.pathname
  const match = path.match(/\/sessions\/([^/]+)/)
  if (match?.[1]) return decodeURIComponent(match[1])
  const selected = document.querySelector('[data-session-id]')
  const fromDom = selected?.getAttribute('data-session-id')
  if (fromDom) return fromDom
  return sessions.keys().next().value
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return target.closest('input, textarea, [contenteditable="true"]') !== null
}
