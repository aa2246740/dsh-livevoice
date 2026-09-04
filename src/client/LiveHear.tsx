import type { CommandRowProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import css from './LivePanel.module.css'

export function LiveHear(props: CommandRowProps) {
  const text = props.node.outcome?.text ?? props.node.args ?? ''
  if (!text) return null
  return <div className={css.hear} data-live-voice-hear="">{text}</div>
}
