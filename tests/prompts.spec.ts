import { describe, expect, it } from 'vitest'
import { LIVE_INSTRUCTIONS_TEMPLATE } from '../src/prompts.ts'

describe('LIVE_INSTRUCTIONS_TEMPLATE', () => {
  it('asks the live model for a short imperative brief, not raw speech', () => {
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain('short imperative brief')
    expect(LIVE_INSTRUCTIONS_TEMPLATE).toContain('NEVER raw speech')
    expect(LIVE_INSTRUCTIONS_TEMPLATE).not.toContain('complete plain-language request')
  })
})
