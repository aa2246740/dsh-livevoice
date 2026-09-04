import { describe, expect, it } from 'vitest'
import { formatConnectingSubtitle } from '../src/client/dial.ts'

describe('formatConnectingSubtitle', () => {
  it('uses the wait copy when no stage is known yet', () => {
    expect(formatConnectingSubtitle({
      wait: '正在拨号 · 2秒',
      elapsed: '2秒',
    })).toBe('正在拨号 · 2秒')
  })

  it('keeps the elapsed suffix in the same locale as the stage', () => {
    expect(formatConnectingSubtitle({
      stageLabel: '正在拿起麦克风…',
      wait: '正在拨号 · 2秒',
      elapsed: '2秒',
    })).toBe('正在拿起麦克风… · 2秒')
    expect(formatConnectingSubtitle({
      stageLabel: 'Picking up the mic…',
      wait: 'Calling Codex · 2s',
      elapsed: '2s',
    })).toBe('Picking up the mic… · 2s')
  })
})
