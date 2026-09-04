import { describe, expect, it } from 'vitest'
import { errorMessage } from '../src/http.ts'

describe('errorMessage', () => {
  it('appends the fetch cause when undici only says fetch failed', () => {
    const error = new Error('fetch failed')
    error.cause = new Error('connect ECONNREFUSED 127.0.0.1:45678')
    expect(errorMessage(error)).toBe('fetch failed: connect ECONNREFUSED 127.0.0.1:45678')
  })

  it('does not duplicate a cause already in the message', () => {
    const error = new Error('fetch failed: timeout')
    error.cause = new Error('timeout')
    expect(errorMessage(error)).toBe('fetch failed: timeout')
  })
})
