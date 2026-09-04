import { describe, expect, it } from 'vitest'
import { applyRemotePlayback } from '../src/client/playback.ts'

describe('remote playback', () => {
  it('puts the speaker at full volume instead of leaving a muted unlock element', () => {
    const stream = { id: 'remote' } as MediaStream
    const audio = { srcObject: null as MediaProvider | null, muted: true, volume: 0, autoplay: false }
    applyRemotePlayback(audio, stream)
    expect(audio.srcObject).toBe(stream)
    expect(audio.muted).toBe(false)
    expect(audio.volume).toBe(1)
    expect(audio.autoplay).toBe(true)
  })
})
