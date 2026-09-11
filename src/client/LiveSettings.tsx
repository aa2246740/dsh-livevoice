import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LIVE_VOICE_OPTIONS, resolveLiveVoice } from '../voices.js'
import { fetchLiveStatus, type LiveStatus } from './api.js'
import { isLiveVoiceKey } from './locales.js'
import {
  chooseStoredVoice,
  storedLiveVoice,
  subscribeStoredVoice,
} from './session.js'
import css from './LivePanel.module.css'

export type LiveVoiceSettingsProps =
  PropsRuntime<'settings.general.item'>
  & PropsLocale<'liveVoice'>

export function LiveVoiceSettings(props: LiveVoiceSettingsProps) {
  const [voice, setVoice] = useState(storedLiveVoice)
  const [status, setStatus] = useState<LiveStatus | undefined>()
  useEffect(() => subscribeStoredVoice(() => { setVoice(storedLiveVoice()) }), [])
  useEffect(() => {
    void fetchLiveStatus().then(setStatus).catch(() => setStatus(undefined))
  }, [])
  return (
    <>
      <div className={css.settingsRow}>
        <div className={css.settingsText}>
          <div className={css.settingsTitle}>{props.t('settings.account.title')}</div>
          <div className={css.settingsBlurb}>{accountSummary(status, props.t)}</div>
          <div className={css.settingsBlurb}>{props.t('settings.account.hint')}</div>
        </div>
      </div>
      <div className={css.settingsRow}>
        <div className={css.settingsText}>
          <div className={css.settingsTitle}>{props.t('settings.voice.title')}</div>
          <div className={css.settingsBlurb}>{props.t('settings.voice.hint')}</div>
        </div>
        <select
          aria-label={props.t('voice')}
          className={css.settingsSelect}
          value={voice}
          onChange={event => {
            chooseStoredVoice(resolveLiveVoice(event.target.value))
          }}
        >
          {LIVE_VOICE_OPTIONS.map(option => (
            <option key={option.value} value={option.value}>{option.label}</option>
          ))}
        </select>
      </div>
    </>
  )
}

function accountSummary(
  status: LiveStatus | undefined,
  t: LiveVoiceSettingsProps['t'],
): string {
  if (status === undefined) return t('settings.account.hint')
  if (status.source === 'none') return t('settings.account.missing')
  const sourceKey = `source.${status.source}`
  const parts = [
    isLiveVoiceKey(sourceKey) ? t(sourceKey) : undefined,
    status.accountHint ? t('status.account', { hint: status.accountHint }) : undefined,
    status.expired ? t('status.expired') : undefined,
  ].filter((part): part is string => part !== undefined)
  return parts.length > 0 ? parts.join(' · ') : t('settings.account.hint')
}
