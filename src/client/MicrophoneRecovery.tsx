import { useEffect, useRef, useState } from 'react'
import { LIVE_MICROPHONE_SETTINGS_PATH } from '../ids.js'
import { captureMicrophone } from './webrtc.js'
import css from './LivePanel.module.css'

// Permission-only retry: never create a peer, call the server, or transmit audio.
export async function testMicrophone(signal?: AbortSignal): Promise<void> {
  const stream = await captureMicrophone(signal)
  try {
    if (!stream.getAudioTracks().some(track => track.readyState === 'live' && !track.muted)) {
      throw new Error('已获准，但麦克风没有提供可用音轨。请检查输入设备。')
    }
  } finally { stream.getTracks().forEach(track => track.stop()) }
}
export function MicrophoneRecovery(props: { hostIssue?: string }) {
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  const pending = useRef<AbortController | null>(null)
  useEffect(() => () => { pending.current?.abort(); pending.current = null }, [])
  const mac = /Mac/i.test(navigator.platform)
  const desktop = window.location.protocol === 'dsh-app:'
  const missing = desktop && props.hostIssue === 'missing-audio-entitlement'
  return <div className={css.recovery}>
    <div className={css.error} role="status">
      {missing
        ? '当前 DSH 客户端的签名缺少录音权限声明，macOS 不会弹出授权窗口，设置里也可能没有此 App。需要安装补齐录音权限的客户端；重试或重启无法补齐。'
        : desktop
          ? '在系统设置「隐私与安全性 → 麦克风」中查找当前客户端（DSH Studio 或 DeepSeek Harness）。若列表中没有它且从未弹窗，可能是 App 签名缺少录音权限，需要更新 App。'
          : '请允许当前网站使用麦克风，并检查浏览器的系统麦克风权限。'}
    </div>
    <div className={css.actions}>
      {desktop && mac ? <button className={css.action} type="button" onClick={async () => {
        try {
          const response = await fetch(LIVE_MICROPHONE_SETTINGS_PATH, {
            method: 'POST', headers: { 'x-dsh-livevoice-action': 'microphone-settings' },
          })
          if (!response.ok) throw new Error('请手动打开系统设置 → 隐私与安全性 → 麦克风。')
          setNotice('已打开麦克风设置。允许后可点「检测麦克风」。')
        } catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
      }}>打开麦克风设置</button> : null}
      <button className={css.action} type="button" disabled={busy || missing} onClick={async () => {
        const abort = new AbortController(); pending.current = abort; setBusy(true)
        try { await testMicrophone(abort.signal); setNotice('麦克风可用，检测已结束。点击「重试」开始通话。') }
        catch (error) { setNotice(error instanceof Error ? error.message : String(error)) }
        finally { if (pending.current === abort) { pending.current = null; setBusy(false) } }
      }}>{busy ? '等待麦克风授权…' : '检测麦克风（不连接模型）'}</button>
    </div>
    {notice ? <div className={css.meta} role="status">{notice}</div> : null}
  </div>
}
