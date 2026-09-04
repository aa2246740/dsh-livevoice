import { describe, expect, it } from 'vitest'
import { meterHeights, shouldGateEcho, smoothLevel } from '../src/client/levels.ts'

describe('echo gate', () => {
  it('drops quiet mic samples while the speaker is active', () => {
    expect(shouldGateEcho(0.02, 0.2)).toBe(true)
  })

  it('lets barge-in through', () => {
    expect(shouldGateEcho(0.3, 0.2)).toBe(false)
  })

  it('passes mic audio when the speaker is idle', () => {
    expect(shouldGateEcho(0.02, 0)).toBe(false)
  })
})

describe('meter heights', () => {
  it('stays flat when the mic is silent so idle cannot look like capture', () => {
    expect(meterHeights(0)).toEqual([0, 0, 0, 0, 0, 0, 0])
    expect(meterHeights(0.005)).toEqual([0, 0, 0, 0, 0, 0, 0])
  })

  it('raises bars for quiet-but-real speech energy', () => {
    expect(meterHeights(0.02).some(height => height > 0)).toBe(true)
  })

  it('raises the center bars when there is real energy', () => {
    const bars = meterHeights(0.5)
    expect(bars[3]).toBeGreaterThan(bars[0] ?? 0)
    expect(bars.every(height => height > 0)).toBe(true)
  })
})

describe('level smoothing', () => {
  it('attacks faster than it releases', () => {
    const up = smoothLevel(0.1, 0.9)
    const down = smoothLevel(0.9, 0.1)
    expect(up - 0.1).toBeGreaterThan(0.9 - down)
    expect(up).toBeLessThan(0.9)
    expect(down).toBeGreaterThan(0.1)
  })
})
