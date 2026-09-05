import { describe, expect, it } from 'vitest'
import { LIVE_INSTRUCTIONS_TEMPLATE } from '../src/prompts.ts'

describe('LIVE_INSTRUCTIONS_TEMPLATE', () => {
  it('preserves current wording and separates discussion from change authorization', () => {
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain("user's complete current request in their own wording")
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain('read-only analysis, not modification')
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain('NEVER expands authorization or scope')
    expect(LIVE_INSTRUCTIONS_TEMPLATE).not.toContain('short imperative brief')
    expect(LIVE_INSTRUCTIONS_TEMPLATE).not.toContain('NEVER raw speech')
  })

  it('does not claim the voice and worker runtimes are identical', () => {
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain('run in different contexts')
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain('NEVER claim the backend runtime or model is identical')
  })
})
