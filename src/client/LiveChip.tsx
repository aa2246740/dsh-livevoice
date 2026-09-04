import { useEffect, useMemo, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import { formatConnectingSubtitle } from './dial.js'
import { isLiveVoiceKey, type LiveVoiceKey } from './locales.js'
import { meterHeights } from './levels.js'
import { type LiveClientSession, type LiveClientState } from './session.js'
import css from './LivePanel.module.css'

export type LiveChipProps = PropsRuntime<'conversation.input.left'>
  & PropsLocale<'liveVoice'>
  & { liveOf: (sessionId: string) => LiveClientSession }

export function LiveChip(props: LiveChipProps) {
  const live = props.liveOf(String(props.sessionId))
  const [state, setState] = useState<LiveClientState>(live.snapshot)
  useEffect(() => live.subscribe(setState), [live])
  useEffect(() => { void live.refreshStatus() }, [live])

  const active = state.phase !== 'idle'
  const label = active ? props.t('chip.ariaActive') : props.t('chip.aria')

  return (
    <div className={css.root} data-live-voice-chip="">
      <Tooltip label={label}>
        <button
          type="button"
          className={css.trigger}
          data-live={active ? '' : undefined}
          data-dial={state.phase === 'connecting' ? '' : undefined}
          data-error={state.phase === 'error' || state.error ? '' : undefined}
          aria-pressed={active}
          aria-label={label}
          onClick={() => { void live.toggle() }}
        >
          <LiveGlyph active={active} />
          <span>{props.t('chip')}</span>
        </button>
      </Tooltip>
    </div>
  )
}

export type LiveDockProps = PropsRuntime<'conversation.input.dock'>
  & PropsLocale<'liveVoice'>
  & { liveOf: (sessionId: string) => LiveClientSession }

export function LiveDock(props: LiveDockProps) {
  const live = props.liveOf(String(props.sessionId))
  const [state, setState] = useState<LiveClientState>(live.snapshot)
  const [, setTick] = useState(0)
  useEffect(() => live.subscribe(setState), [live])
  useEffect(() => {
    if (state.phase !== 'connecting') return
    const timer = window.setInterval(() => setTick(value => value + 1), 1000)
    return () => window.clearInterval(timer)
  }, [state.phase, state.dialStartedAt])
  const bars = useMemo(() => meterHeights(state.inputLevel), [state.inputLevel])
  const phaseKey = (`phase.${state.phase}` as LiveVoiceKey)
  const connecting = state.phase === 'connecting'
  if (state.phase === 'idle' && !state.error) return null
  return (
    <div className={css.dock} data-live-voice-dock="">
      <div
        className={css.bar}
        tabIndex={0}
        data-live-voice-bar=""
        onPointerDown={() => live.retryPlayback()}
      >
        {connecting
          ? <div className={css.ring} aria-hidden="true" />
          : (
            <div className={css.meter} aria-hidden="true">
              {bars.map((height, index) => (
                <span key={index} style={{ height: `${height}%` }} />
              ))}
            </div>
          )}
        <div className={css.copy}>
          <div className={css.phase}>{props.t(phaseKey)}</div>
          {state.error
            ? <div className={css.error}>{state.error}</div>
            : connecting
              ? <div className={css.transcript}>{connectingSubtitle(state, props.t)}</div>
              : state.transcript
                ? <div className={css.transcript}>{state.transcript.text}</div>
                : <div className={css.transcript}>{stageLabel(state.stage, props.t) ?? (state.capture ? `麦克风 ${state.capture}` : props.t('hint'))}</div>}
        </div>
        <div className={css.actions} onPointerDown={event => event.stopPropagation()}>
          {state.phase !== 'idle'
            ? (
              <button type="button" className={css.action} onClick={() => live.toggleMute()}>
                {props.t(state.muted ? 'action.unmute' : 'action.mute')}
              </button>
            )
            : null}
          <button type="button" className={css.action} onClick={() => { void live.toggle() }}>
            {props.t(state.phase === 'idle' ? 'action.start' : 'action.end')}
          </button>
        </div>
      </div>
    </div>
  )
}

function LiveGlyph(props: { active: boolean }) {
  if (props.active) return <span className={css.dot} />
  return (
    <svg className={css.icon} viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.75a2.25 2.25 0 0 0-2.25 2.25v3a2.25 2.25 0 1 0 4.5 0v-3A2.25 2.25 0 0 0 8 1.75Zm-3.75 5.5a.75.75 0 0 0-1.5 0 5.25 5.25 0 0 0 4.5 5.196V14h-1.5a.75.75 0 0 0 0 1.5h4.5a.75.75 0 0 0 0-1.5h-1.5v-1.554A5.25 5.25 0 0 0 13.25 7.25a.75.75 0 0 0-1.5 0 3.75 3.75 0 1 1-7.5 0Z"
      />
    </svg>
  )
}

function stageLabel(stage: string | undefined, t: LiveDockProps['t']): string | undefined {
  if (stage === undefined) return undefined
  return isLiveVoiceKey(stage) ? t(stage) : stage
}

function connectingSubtitle(state: LiveClientState, t: LiveDockProps['t']): string {
  const seconds = Math.max(0, Math.floor((Date.now() - (state.dialStartedAt ?? Date.now())) / 1000))
  return formatConnectingSubtitle({
    stageLabel: stageLabel(state.stage, t),
    wait: t('dial.wait', { seconds }),
    elapsed: t('dial.elapsed', { seconds }),
  })
}


