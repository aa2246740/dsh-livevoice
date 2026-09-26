import { afterEach, expect, it, vi } from 'vitest'
import { enclosingMacApp, missingAudioEntitlement } from '../src/microphone-host.js'
import { captureMicrophone } from '../src/client/webrtc.js'
import { MicrophoneAccessError } from '../src/client/microphone-error.js'
import { testMicrophone } from '../src/client/MicrophoneRecovery.js'

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })
function media(getUserMedia: ReturnType<typeof vi.fn>) {
  vi.stubGlobal('window', { setTimeout, clearTimeout })
  vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } })
}
it('inspects the enclosing App only, not an arbitrary global installation', () => {
  expect(enclosingMacApp('/Users/user/Applications/DeepSeek Harness.app/Contents/Resources/runtime/node')).toBe('/Users/user/Applications/DeepSeek Harness.app')
  expect(enclosingMacApp('/usr/local/bin/node')).toBeUndefined()
})
it('distinguishes a missing signing entitlement from user denial or unknown signatures', () => {
  expect(missingAudioEntitlement('flags=0x10000(runtime)', '[Dict]')).toBe(true)
  expect(missingAudioEntitlement('flags=0x10000(runtime)', '<key>com.apple.security.device.audio-input</key><true/>')).toBe(false)
  expect(missingAudioEntitlement('flags=0x10000(runtime)', '[Key] com.apple.security.device.audio-input\n[Value]\n[Bool] true')).toBe(false)
  expect(missingAudioEntitlement('flags=0x10000(runtime)', '<key>com.apple.security.device.audio-input</key><false/>')).toBe(true)
  expect(missingAudioEntitlement('flags=0x10000(runtime)', '<key>com.apple.security.device.audio-input</key><false/><key>other</key><true/>')).toBe(true)
  expect(missingAudioEntitlement('', '')).toBe(false)
})
it('does not blame the user or prescribe a restart on NotAllowedError', async () => {
  media(vi.fn().mockRejectedValue(new DOMException('Permission denied', 'NotAllowedError')))
  await expect(captureMicrophone()).rejects.toBeInstanceOf(MicrophoneAccessError)
})
it('permission-only test stops every track and never contacts a model', async () => {
  const stop = vi.fn(), fetch = vi.fn()
  const track = { readyState: 'live', muted: false, stop }
  media(vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }))
  vi.stubGlobal('fetch', fetch)
  await testMicrophone()
  expect(stop).toHaveBeenCalledOnce()
  expect(fetch).not.toHaveBeenCalled()
})
it('stops muted tracks even when local detection fails', async () => {
  const stop = vi.fn(), track = { readyState: 'live', muted: true, stop }
  media(vi.fn().mockResolvedValue({ getTracks: () => [track], getAudioTracks: () => [track] }))
  await expect(testMicrophone()).rejects.toThrow('没有提供可用音轨')
  expect(stop).toHaveBeenCalledOnce()
})
it('stops late microphone capture after the permission view is dismissed', async () => {
  const capture = Promise.withResolvers<MediaStream>(), stop = vi.fn()
  media(vi.fn().mockReturnValue(capture.promise))
  const abort = new AbortController(), request = captureMicrophone(abort.signal)
  abort.abort()
  await expect(request).rejects.toThrow('cancelled')
  capture.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream)
  await Promise.resolve(); await Promise.resolve()
  expect(stop).toHaveBeenCalledOnce()
})
