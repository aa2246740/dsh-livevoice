import { readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { fetch } from 'undici'
import {
  CODEX_OAUTH_CLIENT_ID,
  CODEX_OAUTH_TOKEN_URL,
  getCodexAccountId,
  jwtExpiryMs,
} from './catalog.js'
import { LLM_CREDENTIAL_SCOPE, LIVE_PROVIDER, OAUTH_STORE_FILENAME } from './ids.js'
import type { LiveProxy } from './proxy.js'

export type CodexAuthSource = 'dsh-oauth-login' | 'dsh-llm' | 'codex-cli'

export interface CodexAccess {
  readonly accessToken: string
  readonly refreshToken: string | undefined
  readonly accountId: string | undefined
  readonly expiresAt: number | undefined
  readonly source: CodexAuthSource
}

export class CodexAuthError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CodexAuthError'
  }
}

const REFRESH_SOON_MS = 15 * 60 * 1000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function oauthFromPiCredential(value: unknown, source: CodexAuthSource): CodexAccess | undefined {
  if (!isRecord(value) || value.type !== 'oauth') return undefined
  if (typeof value.access !== 'string' || value.access.length === 0) return undefined
  const refresh = typeof value.refresh === 'string' && value.refresh.length > 0 ? value.refresh : undefined
  const expires = typeof value.expires === 'number' && Number.isFinite(value.expires) ? value.expires : jwtExpiryMs(value.access)
  const accountId = typeof value.accountId === 'string' && value.accountId.length > 0
    ? value.accountId
    : getCodexAccountId(value.access)
  return {
    accessToken: value.access,
    refreshToken: refresh,
    accountId,
    expiresAt: expires,
    source,
  }
}

async function readOAuthLoginStore(dshHome: string): Promise<CodexAccess | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(dshHome, OAUTH_STORE_FILENAME), 'utf8')) as unknown
    if (!isRecord(raw) || !isRecord(raw.credentials)) return undefined
    return oauthFromPiCredential(raw.credentials[LIVE_PROVIDER], 'dsh-oauth-login')
  } catch {
    return undefined
  }
}

async function writeOAuthLoginStore(dshHome: string, access: CodexAccess): Promise<void> {
  const filename = join(dshHome, OAUTH_STORE_FILENAME)
  const raw = JSON.parse(await readFile(filename, 'utf8')) as Record<string, unknown>
  if (!isRecord(raw.credentials)) return
  const previous = isRecord(raw.credentials[LIVE_PROVIDER]) ? raw.credentials[LIVE_PROVIDER] : {}
  raw.credentials[LIVE_PROVIDER] = {
    ...previous,
    type: 'oauth',
    access: access.accessToken,
    refresh: access.refreshToken ?? '',
    expires: access.expiresAt ?? Date.now() + 6 * 60 * 60 * 1000,
    ...access.accountId === undefined ? {} : { accountId: access.accountId },
  }
  await writeFile(filename, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 })
}

interface CredentialRecordStore {
  readRecord?(key: string): Promise<{ kind?: string; payload?: unknown } | undefined>
  modifyRecord?(
    key: string,
    mutate: (current: { kind?: string; payload?: unknown } | undefined) => Promise<{ kind: string; payload: unknown }>,
  ): Promise<unknown>
}

function credentialStore(ctx: Context): CredentialRecordStore | undefined {
  const credentials = ctx.get('credentials') as CredentialRecordStore | undefined
  if (credentials === undefined || typeof credentials.readRecord !== 'function') return undefined
  return credentials
}

async function readLlmCredential(ctx: Context): Promise<CodexAccess | undefined> {
  const credentials = credentialStore(ctx)
  if (credentials?.readRecord === undefined) return undefined
  try {
    const record = await credentials.readRecord(`${LLM_CREDENTIAL_SCOPE}/${LIVE_PROVIDER}`)
    if (record?.kind === 'grant') return oauthFromPiCredential(record.payload, 'dsh-llm')
    return undefined
  } catch {
    return undefined
  }
}

async function writeLlmCredential(ctx: Context, access: CodexAccess): Promise<void> {
  const credentials = credentialStore(ctx)
  if (credentials?.modifyRecord === undefined) return
  await credentials.modifyRecord(`${LLM_CREDENTIAL_SCOPE}/${LIVE_PROVIDER}`, async (current) => {
    const payload = current?.kind === 'grant' && isRecord(current.payload) ? current.payload : {}
    return {
      kind: 'grant',
      payload: {
        ...payload,
        type: 'oauth',
        access: access.accessToken,
        refresh: access.refreshToken ?? '',
        expires: access.expiresAt ?? Date.now() + 6 * 60 * 60 * 1000,
        ...access.accountId === undefined ? {} : { accountId: access.accountId },
      },
    }
  })
}

async function readCodexCliAuth(): Promise<CodexAccess | undefined> {
  try {
    const raw = JSON.parse(await readFile(join(homedir(), '.codex', 'auth.json'), 'utf8')) as unknown
    if (!isRecord(raw) || !isRecord(raw.tokens)) return undefined
    const tokens = raw.tokens
    const accessToken = typeof tokens.access_token === 'string' ? tokens.access_token : undefined
    if (!accessToken) return undefined
    const refreshToken = typeof tokens.refresh_token === 'string' ? tokens.refresh_token : undefined
    const accountId = typeof tokens.account_id === 'string'
      ? tokens.account_id
      : getCodexAccountId(accessToken)
    return {
      accessToken,
      refreshToken,
      accountId,
      expiresAt: jwtExpiryMs(accessToken),
      source: 'codex-cli',
    }
  } catch {
    return undefined
  }
}

function needsRefresh(access: CodexAccess, now = Date.now()): boolean {
  if (access.expiresAt === undefined) return false
  return now >= access.expiresAt - REFRESH_SOON_MS
}

export async function refreshCodexAccess(
  access: CodexAccess,
  proxy: LiveProxy,
): Promise<CodexAccess> {
  if (!access.refreshToken) return access
  const body = new URLSearchParams({
    client_id: CODEX_OAUTH_CLIENT_ID,
    grant_type: 'refresh_token',
    refresh_token: access.refreshToken,
  })
  const response = await fetch(CODEX_OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    dispatcher: proxy.dispatcher(),
  })
  const text = await response.text()
  if (!response.ok) {
    throw new CodexAuthError(`Codex OAuth refresh failed (${response.status}): ${text.slice(0, 300)}`)
  }
  const parsed = JSON.parse(text) as Record<string, unknown>
  const accessToken = typeof parsed.access_token === 'string' ? parsed.access_token : undefined
  if (!accessToken) throw new CodexAuthError('Codex OAuth refresh returned no access token')
  const refreshToken = typeof parsed.refresh_token === 'string' ? parsed.refresh_token : access.refreshToken
  const expiresIn = typeof parsed.expires_in === 'number' ? parsed.expires_in : undefined
  return {
    accessToken,
    refreshToken,
    accountId: access.accountId ?? getCodexAccountId(accessToken),
    expiresAt: expiresIn === undefined ? jwtExpiryMs(accessToken) : Date.now() + expiresIn * 1000,
    source: access.source,
  }
}

async function persistAccess(ctx: Context, dshHome: string, access: CodexAccess): Promise<void> {
  if (access.source === 'dsh-oauth-login') {
    await writeOAuthLoginStore(dshHome, access)
    return
  }
  if (access.source === 'dsh-llm') {
    await writeLlmCredential(ctx, access)
  }
}

export async function resolveCodexAccess(
  ctx: Context,
  proxy: LiveProxy,
  dshHome = join(homedir(), '.dsh'),
): Promise<CodexAccess> {
  const candidates = [
    await readOAuthLoginStore(dshHome),
    await readLlmCredential(ctx),
    await readCodexCliAuth(),
  ].filter((value): value is CodexAccess => value !== undefined)

  if (candidates.length === 0) {
    throw new CodexAuthError(
      'No Codex OAuth credential is available for a live call. Sign in to ChatGPT Codex in DSH Settings, use dsh-oauth-login, or run `codex login`.',
    )
  }

  let access = candidates[0]!
  if (needsRefresh(access)) {
    try {
      access = await refreshCodexAccess(access, proxy)
      await persistAccess(ctx, dshHome, access)
    } catch (error) {
      if (candidates.length === 1) throw error
    }
  }
  return access
}

export async function describeCodexAuth(
  ctx: Context,
  dshHome = join(homedir(), '.dsh'),
): Promise<{ ready: boolean; source: CodexAuthSource | 'none'; expiresAt?: number }> {
  const stored = await readOAuthLoginStore(dshHome)
    ?? await readLlmCredential(ctx)
    ?? await readCodexCliAuth()
  if (stored === undefined) return { ready: false, source: 'none' }
  return {
    ready: true,
    source: stored.source,
    ...stored.expiresAt === undefined ? {} : { expiresAt: stored.expiresAt },
  }
}
