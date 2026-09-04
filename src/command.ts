import type { CommandInvocation, CommandResult } from '@deepseek-ai/dsh-commands'

export function executeLiveCommand(invocation: CommandInvocation): CommandResult {
  const raw = invocation.rawInput.trim().toLowerCase()
  if (raw === 'help') {
    return {
      kind: 'success',
      text: [
        'Live voice uses your ChatGPT / Codex OAuth subscription (not a platform API key).',
        'Press Ctrl+L or click Live in the composer to start a realtime call.',
        'Space mutes while the live bar is focused. Esc or Ctrl+L again ends the call.',
        'Coding work is delegated to this DSH session; the voice model only talks.',
      ].join('\n'),
    }
  }
  return {
    kind: 'success',
    text: 'Open Live from the composer (Ctrl+L). The voice call stays in this session.',
  }
}
