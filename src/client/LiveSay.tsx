import type { CommandRowProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import css from './LivePanel.module.css'

export function LiveSay(props: CommandRowProps) {
  const text = props.node.outcome?.text ?? props.node.args ?? ''
  if (!text) return null
  return <div className={css.say} data-live-voice-say="">{text}</div>
}
