export const CODEX_BASE_URL = 'https://chatgpt.com/backend-api'

/** Pinned to the Codex wrapper DSH RC8 already ships. */
export const CODEX_CLIENT_VERSION = '0.147.0'

export const OPENAI_HEADERS = {
  ACCOUNT_ID: 'chatgpt-account-id',
  ORIGINATOR: 'originator',
  VERSION: 'version',
  SCOPED_SESSION_ID: 'session-id',
  THREAD_ID: 'thread-id',
  ATTESTATION: 'x-oai-attestation',
  RESIDENCY: 'x-openai-internal-codex-residency',
} as const

export const JWT_CLAIM_PATH = 'https://api.openai.com/auth' as const

export const SIGNALING_URL = `${CODEX_BASE_URL}/codex/realtime/calls?intent=quicksilver&architecture=avas`

export const CODEX_OAUTH_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const CODEX_OAUTH_TOKEN_URL = 'https://auth.openai.com/oauth/token'

const LIVE_CALL_ID_PATTERN = /^rtc_[\w-]+$/

export function parseLiveCallId(location: string | null): string | undefined {
  if (!location) return undefined
  return location
    .split('?', 1)[0]
    ?.split('/')
    .find(segment => LIVE_CALL_ID_PATTERN.test(segment))
}

export function buildLiveSidebandUrl(callId: string): string {
  const url = new URL(`https://api.openai.com/v1/live/${encodeURIComponent(callId)}`)
  url.protocol = 'wss:'
  return url.toString()
}

function decodeJwtPayload(accessToken: string): Record<string, unknown> | undefined {
  try {
    const parts = accessToken.split('.')
    if (parts.length !== 3) return undefined
    const decoded = Buffer.from(parts[1] ?? '', 'base64url').toString('utf8')
    const payload = JSON.parse(decoded) as unknown
    if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return undefined
    return payload as Record<string, unknown>
  } catch {
    return undefined
  }
}

export function getCodexAccountId(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken)
  const auth = payload?.[JWT_CLAIM_PATH]
  if (typeof auth !== 'object' || auth === null) return undefined
  const accountId = (auth as { chatgpt_account_id?: unknown }).chatgpt_account_id
  return typeof accountId === 'string' && accountId.length > 0 ? accountId : undefined
}

export function getCodexResidency(accessToken: string): string | undefined {
  const payload = decodeJwtPayload(accessToken)
  const auth = payload?.[JWT_CLAIM_PATH]
  if (typeof auth !== 'object' || auth === null) return undefined
  const record = auth as { chatgpt_data_residency?: unknown; chatgpt_compute_residency?: unknown }
  for (const claim of [record.chatgpt_data_residency, record.chatgpt_compute_residency]) {
    if (typeof claim !== 'string') continue
    const residency = claim.trim()
    if (residency.length > 0) return residency
  }
  return undefined
}

export function jwtExpiryMs(accessToken: string): number | undefined {
  const payload = decodeJwtPayload(accessToken)
  const exp = payload?.exp
  if (typeof exp !== 'number' || !Number.isFinite(exp) || exp <= 0) return undefined
  return exp * 1000
}
