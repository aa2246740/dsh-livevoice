import { useEffect, useState } from 'react'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { LIVE_VOICE_OPTIONS, resolveLiveVoice } from '../voices.js'
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
  useEffect(() => subscribeStoredVoice(() => { setVoice(storedLiveVoice()) }), [])
  return (
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
  )
}
