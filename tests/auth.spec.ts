import { describe, expect, it, vi } from 'vitest'
import {
  CodexAuthError,
  pickCodexAccess,
  selectStoredCodexAccess,
  type CodexAccess,
} from '../src/auth.ts'

function access(overrides: Partial<CodexAccess> & Pick<CodexAccess, 'source'>): CodexAccess {
  return {
    accessToken: `${overrides.source}-token`,
    refreshToken: `${overrides.source}-refresh`,
    accountId: 'acct-1234abcd',
    expiresAt: Date.now() + 60 * 60 * 1000,
    ...overrides,
  }
}

describe('pickCodexAccess', () => {
  const now = 1_000_000

  it('uses the first candidate that does not need refresh', async () => {
    const refresh = vi.fn()
    const chosen = await pickCodexAccess([
      access({ source: 'dsh-oauth-login', expiresAt: now + 60 * 60 * 1000 }),
      access({ source: 'codex-cli' }),
    ], refresh, now)
    expect(chosen.source).toBe('dsh-oauth-login')
    expect(refresh).not.toHaveBeenCalled()
  })

  it('falls through to the next candidate when refresh fails on an expired login', async () => {
    const refresh = vi.fn(async (current: CodexAccess) => {
      if (current.source === 'dsh-oauth-login') throw new CodexAuthError('refresh failed')
      return current
    })
    const chosen = await pickCodexAccess([
      access({ source: 'dsh-oauth-login', expiresAt: now - 1 }),
      access({ source: 'codex-cli', expiresAt: now + 60 * 60 * 1000 }),
    ], refresh, now)
    expect(chosen.source).toBe('codex-cli')
    expect(refresh).toHaveBeenCalledOnce()
  })

  it('keeps a soon-to-expire login when refresh fails but the token is still valid', async () => {
    const refresh = vi.fn(async () => {
      throw new CodexAuthError('refresh failed')
    })
    const first = access({ source: 'dsh-oauth-login', expiresAt: now + 5 * 60 * 1000 })
    const chosen = await pickCodexAccess([
      first,
      access({ source: 'codex-cli' }),
    ], refresh, now)
    expect(chosen).toBe(first)
  })

  it('skips an expired login that refreshes to another expired token', async () => {
    const refresh = vi.fn(async (current: CodexAccess) => ({
      ...current,
      accessToken: 'still-expired',
      expiresAt: now - 1,
    }))
    const chosen = await pickCodexAccess([
      access({ source: 'dsh-oauth-login', expiresAt: now - 1 }),
      access({ source: 'codex-cli', expiresAt: now + 60 * 60 * 1000 }),
    ], refresh, now)
    expect(chosen.source).toBe('codex-cli')
  })

  it('throws the last refresh error when every candidate is expired', async () => {
    const refresh = vi.fn(async () => {
      throw new CodexAuthError('all dead')
    })
    await expect(pickCodexAccess([
      access({ source: 'dsh-oauth-login', expiresAt: now - 1 }),
      access({ source: 'codex-cli', expiresAt: now - 2 }),
    ], refresh, now)).rejects.toThrow('all dead')
  })
})

describe('selectStoredCodexAccess', () => {
  const now = 1_000_000

  it('prefers the first non-expired candidate for status', () => {
    const chosen = selectStoredCodexAccess([
      access({ source: 'dsh-oauth-login', expiresAt: now - 1 }),
      access({ source: 'codex-cli', expiresAt: now + 10 }),
    ], now)
    expect(chosen?.source).toBe('codex-cli')
  })
})
