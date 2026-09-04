import {
  CODEX_CLIENT_VERSION,
  getCodexAccountId,
  getCodexResidency,
  OPENAI_HEADERS,
} from './catalog.js'
import { LIVE_ORIGINATOR } from './ids.js'
import type { CodexAccess } from './auth.js'

export function liveSessionHeaders(
  access: CodexAccess,
  sessionId: string,
  realtimeSessionId: string,
): Record<string, string> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${access.accessToken}`,
    'OpenAI-Alpha': 'quicksilver=v2',
    'User-Agent': `Codex Desktop/${CODEX_CLIENT_VERSION}`,
    'x-session-id': realtimeSessionId,
    [OPENAI_HEADERS.ORIGINATOR]: LIVE_ORIGINATOR,
    [OPENAI_HEADERS.VERSION]: CODEX_CLIENT_VERSION,
    [OPENAI_HEADERS.SCOPED_SESSION_ID]: sessionId,
    [OPENAI_HEADERS.THREAD_ID]: sessionId,
  }
  const accountId = access.accountId ?? getCodexAccountId(access.accessToken)
  if (accountId) headers[OPENAI_HEADERS.ACCOUNT_ID] = accountId
  const residency = getCodexResidency(access.accessToken)
  if (residency) headers[OPENAI_HEADERS.RESIDENCY] = residency
  return headers
}
