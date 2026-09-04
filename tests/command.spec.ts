import { describe, expect, it } from 'vitest'
import { executeLiveCommand } from '../src/command.ts'

describe('/live', () => {
  it('prints usage on help', () => {
    const result = executeLiveCommand({ rawInput: ' help ' } as never)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Ctrl+L')
  })

  it('points at the composer control by default', () => {
    const result = executeLiveCommand({ rawInput: '' } as never)
    expect(result.kind).toBe('success')
    expect(result.text).toContain('Ctrl+L')
  })
})
